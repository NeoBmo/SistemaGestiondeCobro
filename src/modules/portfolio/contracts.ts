import type { Pool } from "pg";
import { insertMovement } from "@/modules/cash/commands";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { money } from "@/shared/money/money";
import { calculateLoan, type LoanPlan } from "./loan-calculation";
import type { ConfirmContractInput, LoanTermsInput } from "./loan-validation";

/**
 * Contrato y préstamo nuevos (02 §2.2–2.4, ADR 0007). El flujo es de un solo paso: una vista previa que
 * no guarda nada y la confirmación, que crea en **una** transacción el contrato `CONFIRMADO` (con su
 * número), el préstamo, las cuotas y el desembolso de Caja Mayor. Es un comando financiero: pasa por
 * `runCashCommand` (bloqueo de la caja, idempotencia, auditoría), así que el desembolso no puede dejar
 * el saldo negativo ni aplicarse dos veces.
 */

export type ContractDeps = { db: Pick<Pool, "connect" | "query"> };

export type LoanPreview = {
  plan: {
    principal: number;
    interest: number;
    total: number;
    installments: { number: number; dueOn: IsoDate; amount: number }[];
  };
  /** Fecha del desembolso: hoy en la zona horaria del negocio. */
  disbursedOn: IsoDate;
  /** Saldo actual de la Caja Mayor y si alcanza para desembolsar el principal. */
  cashBalance: number;
  sufficientFunds: boolean;
};

const toPlain = (plan: LoanPlan): LoanPreview["plan"] => ({
  principal: plan.principal,
  interest: plan.interest,
  total: plan.total,
  installments: plan.installments.map(({ number, dueOn, amount }) => ({ number, dueOn, amount })),
});

function businessTimeZone(actor: SessionContext): string {
  if (!actor.businessTimeZone) {
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  }
  return actor.businessTimeZone;
}

/** El primer cobro no puede ser anterior al desembolso (también lo exige la base de datos). */
function assertFirstDueNotBeforeDisbursement(firstDueOn: IsoDate, disbursedOn: IsoDate) {
  if (firstDueOn < disbursedOn) {
    throw new AppError(
      "FIRST_DUE_BEFORE_DISBURSEMENT",
      "La primera fecha de cobro no puede ser anterior a hoy, el día del desembolso",
      400,
    );
  }
}

async function assertClientInBusiness(
  db: Pick<Tx, "query">,
  businessId: string,
  clientId: string,
): Promise<void> {
  const found = await db.query("select 1 from public.clients where id = $1 and business_id = $2", [
    clientId,
    businessId,
  ]);
  if ((found.rowCount ?? 0) === 0) {
    throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
  }
}

/** Calcula el préstamo sin guardar nada: lo que verá el Admin antes de confirmar. */
export async function previewLoan(
  deps: ContractDeps,
  actor: SessionContext,
  terms: LoanTermsInput,
  now: () => Date = () => new Date(),
): Promise<LoanPreview> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "VistaPreviaPrestamo");
  await assertClientInBusiness(deps.db, businessId, terms.clientId);

  const disbursedOn = localDateIn(now(), businessTimeZone(actor));
  assertFirstDueNotBeforeDisbursement(terms.firstDueOn, disbursedOn);
  const plan = calculateLoan({
    principal: terms.principal,
    interestBps: terms.interestBps,
    frequency: terms.frequency,
    installmentCount: terms.installmentCount,
    firstDueOn: terms.firstDueOn,
  });

  const { rows } = await deps.db.query<{ balance: string }>(
    `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance
       from public.cash_movements where business_id = $1`,
    [businessId],
  );
  const cashBalance = money(rows[0]!.balance);
  return {
    plan: toPlain(plan),
    disbursedOn,
    cashBalance,
    sufficientFunds: cashBalance >= plan.principal,
  };
}

export type ConfirmedContract = {
  contractId: string;
  contractNumber: string;
  loanId: string;
  movementId: string;
  principal: number;
  interest: number;
  total: number;
  installmentCount: number;
  disbursedOn: IsoDate;
  /** Saldo de la Caja Mayor después del desembolso. */
  balance: number;
};

/**
 * Confirma el contrato: crea contrato, préstamo, cuotas y desembolso, todo o nada. Desembolsar es una
 * salida de Caja Mayor: si el saldo no alcanza se rechaza (409) sin dejar nada.
 */
export function confirmContract(
  deps: ContractDeps,
  actor: SessionContext,
  input: ConfirmContractInput & { idempotencyKey: IdempotencyKey },
  now: () => Date = () => new Date(),
): Promise<CashCommandOutcome<ConfirmedContract>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<ConfirmedContract>(deps, {
    name: "ConfirmarContrato",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      await assertClientInBusiness(tx, context.businessId, input.clientId);

      const disbursedOn = localDateIn(now(), businessTimeZone(actor));
      assertFirstDueNotBeforeDisbursement(input.firstDueOn, disbursedOn);
      const plan = calculateLoan({
        principal: input.principal,
        interestBps: input.interestBps,
        frequency: input.frequency,
        installmentCount: input.installmentCount,
        firstDueOn: input.firstDueOn,
      });

      // El número se pide dentro de esta transacción: si algo falla se revierte y no se consume.
      const number = (
        await tx.query<{ number: string }>("select private.next_contract_number($1) as number", [
          context.businessId,
        ])
      ).rows[0]!.number;
      const contract = await tx.query<{ id: string }>(
        `insert into public.contracts (business_id, client_id, number, origin, comment, created_by)
         values ($1, $2, $3, 'NUEVO', $4, $5) returning id`,
        [context.businessId, input.clientId, number, input.comment ?? null, context.actorId],
      );
      const contractId = contract.rows[0]!.id;

      const loan = await tx.query<{ id: string }>(
        `insert into public.loans
           (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
            scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, created_by)
         values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11) returning id`,
        [
          context.businessId,
          contractId,
          plan.principal,
          input.interestBps,
          plan.interest,
          plan.total,
          disbursedOn,
          input.firstDueOn,
          input.frequency,
          plan.installments.length,
          context.actorId,
        ],
      );
      const loanId = loan.rows[0]!.id;

      await tx.query(
        `insert into public.installments (business_id, loan_id, number, due_on, amount)
         select $1, $2, number, due_on, amount
           from unnest($3::int[], $4::date[], $5::bigint[]) as t(number, due_on, amount)`,
        [
          context.businessId,
          loanId,
          plan.installments.map((installment) => installment.number),
          plan.installments.map((installment) => installment.dueOn),
          plan.installments.map((installment) => installment.amount),
        ],
      );

      // Desembolso: salida de Caja Mayor; si no alcanza el saldo, `insertMovement` lanza 409.
      const disbursement = await insertMovement(tx, context, {
        type: "DESEMBOLSO_PRESTAMO",
        direction: "SALIDA",
        amount: plan.principal,
        reference: { type: "loan", id: loanId },
      });

      return {
        result: {
          contractId,
          contractNumber: number,
          loanId,
          movementId: disbursement.id,
          principal: plan.principal,
          interest: plan.interest,
          total: plan.total,
          installmentCount: plan.installments.length,
          disbursedOn,
          balance: disbursement.balance,
        },
        audit: [
          {
            action: "ContratoCreado",
            entityType: "contract",
            entityId: contractId,
            summary: { number, clientId: input.clientId, origin: "NUEVO" },
          },
          {
            action: "ContratoConfirmado",
            entityType: "contract",
            entityId: contractId,
            summary: { number },
          },
          {
            action: "PrestamoCreado",
            entityType: "loan",
            entityId: loanId,
            summary: {
              contractId,
              principal: plan.principal,
              interestBps: input.interestBps,
              interest: plan.interest,
              total: plan.total,
              frequency: input.frequency,
              firstDueOn: input.firstDueOn,
            },
          },
          {
            action: "CuotasGeneradas",
            entityType: "loan",
            entityId: loanId,
            summary: {
              count: plan.installments.length,
              firstDueOn: plan.installments[0]!.dueOn,
              lastDueOn: plan.installments.at(-1)!.dueOn,
              total: plan.total,
            },
          },
          {
            action: "PrestamoDesembolsado",
            entityType: "loan",
            entityId: loanId,
            summary: { amount: plan.principal, movementId: disbursement.id, disbursedOn },
          },
        ],
      };
    },
  });
}

export type AnnulledContract = {
  contractId: string;
  contractNumber: string;
  loanId: string;
  /** Movimiento que revierte el desembolso; `null` si el préstamo no tuvo desembolso (importado). */
  reversalMovementId: string | null;
  /** Saldo de la Caja Mayor después de devolver el desembolso. */
  balance: number;
};

/**
 * Anula un contrato y su préstamo (02 §2.2): exige motivo y deja el desembolso revertido de forma
 * explícita con un `REVERSO` vinculado (nunca se borra ni se edita el movimiento original). Todo en una
 * transacción bajo el bloqueo de la caja; el contrato y el préstamo cambian juntos (la base lo exige).
 *
 * Solo se anula si el préstamo no tiene pagos ni liquidaciones posteriores: en F3 todavía no existen,
 * así que basta con que esté ACTIVO. **F4 debe añadir aquí la comprobación de pagos** (05-PENDIENTES).
 */
export function annulContract(
  deps: ContractDeps,
  actor: SessionContext,
  input: { idempotencyKey: IdempotencyKey; loanId: string; reason: string },
): Promise<CashCommandOutcome<AnnulledContract>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<AnnulledContract>(deps, {
    name: "AnularContrato",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      // Siempre dentro del negocio de la sesión: un préstamo de otro negocio es «no encontrado».
      const found = await tx.query<{
        contract_id: string;
        number: string;
        status: "ACTIVO" | "ANULADO";
      }>(
        `select k.id as contract_id, k.number, l.status
           from public.loans l join public.contracts k on k.id = l.contract_id
          where l.id = $1 and l.business_id = $2
          for update of l, k`,
        [input.loanId, context.businessId],
      );
      const loan = found.rows[0];
      if (!loan) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
      if (loan.status !== "ACTIVO") {
        throw new AppError("CONTRACT_ALREADY_VOIDED", "Este contrato ya está anulado", 409);
      }

      // Desembolso inicial a revertir (un préstamo importado no lo tiene, 02 §6.1).
      const disbursement = await tx.query<{ id: string; amount: string }>(
        `select id, amount::text from public.cash_movements
          where business_id = $1 and type = 'DESEMBOLSO_PRESTAMO'
            and reference_type = 'loan' and reference_id = $2`,
        [context.businessId, input.loanId],
      );
      let reversalMovementId: string | null = null;
      let balance: number | null = null;
      const original = disbursement.rows[0];
      if (original) {
        const reversal = await insertMovement(tx, context, {
          type: "REVERSO",
          direction: "ENTRADA",
          amount: money(original.amount),
          reason: `Anulación del contrato ${loan.number}: ${input.reason}`,
          reverses: original.id,
          reference: { type: "loan", id: input.loanId },
        });
        reversalMovementId = reversal.id;
        balance = reversal.balance;
      }
      if (balance === null) {
        const sum = await tx.query<{ balance: string }>(
          `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance
             from public.cash_movements where cashbox_id = $1`,
          [context.cashboxId],
        );
        balance = money(sum.rows[0]!.balance);
      }

      await tx.query(
        `update public.contracts
            set status = 'ANULADO', voided_at = now(), voided_by = $2, void_reason = $3
          where id = $1`,
        [loan.contract_id, context.actorId, input.reason],
      );
      await tx.query("update public.loans set status = 'ANULADO' where id = $1", [input.loanId]);

      return {
        result: {
          contractId: loan.contract_id,
          contractNumber: loan.number,
          loanId: input.loanId,
          reversalMovementId,
          balance,
        },
        audit: [
          {
            action: "ContratoAnulado",
            entityType: "contract",
            entityId: loan.contract_id,
            summary: { number: loan.number, reason: input.reason },
          },
          {
            action: "PrestamoAnulado",
            entityType: "loan",
            entityId: input.loanId,
            summary: { contractId: loan.contract_id, reversalMovementId },
          },
          ...(reversalMovementId
            ? [
                {
                  action: "ReversoRegistrado",
                  entityType: "cash_movement",
                  entityId: reversalMovementId,
                  summary: {
                    reversedMovementId: original!.id,
                    reversedType: "DESEMBOLSO_PRESTAMO",
                    amount: money(original!.amount),
                    reason: `Anulación del contrato ${loan.number}`,
                  },
                },
              ]
            : []),
        ],
      };
    },
  });
}
