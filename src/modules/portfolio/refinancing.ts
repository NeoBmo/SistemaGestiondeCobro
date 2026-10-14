import { insertMovement } from "@/modules/cash/commands";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { formatMoney, money } from "@/shared/money/money";
import { assertFirstDueNotBeforeDisbursement, type ContractDeps } from "./contracts";
import { calculateLoan, type LoanPlan } from "./loan-calculation";
import type { RefinanceInput, RefinanceTermsInput } from "./loan-validation";
import {
  activeChargeBalance,
  assertLoanActive,
  installmentsWithApplied,
  lockLoan,
} from "./payments";

/**
 * Refinanciación (02 §3.5, ADR 0008): sustituye un préstamo ACTIVO por uno nuevo y trazable.
 *  1. El saldo refinanciado es solo el saldo pendiente de las cuotas; si el préstamo tiene cargos de mora
 *     activos con saldo se rechaza hasta que se paguen o se anulen.
 *  2. `nuevo principal = saldo pendiente + monto adicional entregado`, con interés, cuotas, frecuencia y
 *     primera fecha propios.
 *  3. El préstamo anterior queda `REFINANCIADO` (su deuda se cancela **sin mover efectivo**) y no se edita:
 *     sus cuotas y pagos permanecen.
 *  4. Solo el monto adicional (si lo hay) sale de la Caja Mayor, como un desembolso separado.
 * Todo en una transacción bajo el bloqueo de la caja, idempotente y auditado.
 */

type PreviousLoan = {
  clientId: string;
  contractNumber: string;
  pending: number;
};

/** Lee y valida el préstamo anterior (bloqueado): activo, con saldo y sin cargos de mora activos. */
async function loadPreviousLoan(tx: Tx, businessId: string, loanId: string): Promise<PreviousLoan> {
  const loan = await lockLoan(tx, businessId, loanId);
  assertLoanActive(loan, "refinanciaciones");

  const owner = await tx.query<{ client_id: string }>(
    `select k.client_id from public.loans l join public.contracts k on k.id = l.contract_id where l.id = $1`,
    [loanId],
  );
  const installments = await installmentsWithApplied(tx, loanId);
  const pending = installments.reduce((sum, i) => sum + (i.amount - i.applied), 0);
  if (pending <= 0) {
    throw new AppError("LOAN_PAID", "Este préstamo no tiene saldo pendiente que refinanciar", 409);
  }
  const fees = await activeChargeBalance(tx, loanId);
  if (fees > 0) {
    throw new AppError(
      "REFINANCE_WITH_LATE_FEES",
      `El préstamo tiene cargos de mora activos por ${formatMoney(money(fees))}: págalos o anúlalos antes de refinanciar`,
      409,
    );
  }
  return { clientId: owner.rows[0]!.client_id, contractNumber: loan.contract_number, pending };
}

function planFor(previous: PreviousLoan, terms: RefinanceTermsInput): LoanPlan {
  return calculateLoan({
    principal: previous.pending + terms.additionalAmount,
    interestBps: terms.interestBps,
    frequency: terms.frequency,
    installmentCount: terms.installmentCount,
    firstDueOn: terms.firstDueOn,
  });
}

export type RefinancePreview = {
  previousContractNumber: string;
  /** Saldo pendiente de las cuotas del préstamo anterior: lo que se refinancia. */
  refinancedBalance: number;
  additionalAmount: number;
  plan: {
    principal: number;
    interest: number;
    total: number;
    installments: { number: number; dueOn: IsoDate; amount: number }[];
  };
  disbursedOn: IsoDate;
  cashBalance: number;
  /** Solo el monto adicional sale de la caja. */
  sufficientFunds: boolean;
};

/** Calcula la refinanciación sin guardar nada. */
export async function previewRefinancing(
  deps: ContractDeps,
  actor: SessionContext,
  loanId: string,
  terms: RefinanceTermsInput,
  now: () => Date = () => new Date(),
): Promise<RefinancePreview> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "VistaPreviaRefinanciacion");
  if (!actor.businessTimeZone)
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);

  // Lectura sin bloqueo: es solo una vista previa; el comando vuelve a validar bajo bloqueo.
  const db = deps.db as unknown as Tx;
  const previous = await loadPreviewPrevious(db, businessId, loanId);
  const disbursedOn = localDateIn(now(), actor.businessTimeZone);
  assertFirstDueNotBeforeDisbursement(terms.firstDueOn, disbursedOn);
  const plan = planFor(previous, terms);

  const balance = await db.query<{ balance: string }>(
    `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance
       from public.cash_movements where business_id = $1 and session_id is null`,
    [businessId],
  );
  const cashBalance = money(balance.rows[0]!.balance);
  return {
    previousContractNumber: previous.contractNumber,
    refinancedBalance: previous.pending,
    additionalAmount: terms.additionalAmount,
    plan: {
      principal: plan.principal,
      interest: plan.interest,
      total: plan.total,
      installments: plan.installments.map(({ number, dueOn, amount }) => ({
        number,
        dueOn,
        amount,
      })),
    },
    disbursedOn,
    cashBalance,
    sufficientFunds: cashBalance >= terms.additionalAmount,
  };
}

/** Igual que `loadPreviousLoan` pero sin bloquear (vista previa). */
async function loadPreviewPrevious(
  db: Tx,
  businessId: string,
  loanId: string,
): Promise<PreviousLoan> {
  const found = await db.query<{ status: string; contract_number: string; client_id: string }>(
    `select l.status, k.number as contract_number, k.client_id
       from public.loans l join public.contracts k on k.id = l.contract_id
      where l.id = $1 and l.business_id = $2`,
    [loanId, businessId],
  );
  const loan = found.rows[0];
  if (!loan) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
  assertLoanActive(
    { id: loanId, status: loan.status as "ACTIVO", contract_number: loan.contract_number },
    "refinanciaciones",
  );
  const installments = await installmentsWithApplied(db, loanId);
  const pending = installments.reduce((sum, i) => sum + (i.amount - i.applied), 0);
  if (pending <= 0)
    throw new AppError("LOAN_PAID", "Este préstamo no tiene saldo pendiente que refinanciar", 409);
  const fees = await activeChargeBalance(db, loanId);
  if (fees > 0) {
    throw new AppError(
      "REFINANCE_WITH_LATE_FEES",
      `El préstamo tiene cargos de mora activos por ${formatMoney(money(fees))}: págalos o anúlalos antes de refinanciar`,
      409,
    );
  }
  return { clientId: loan.client_id, contractNumber: loan.contract_number, pending };
}

export type Refinanced = {
  refinancingId: string;
  previousLoanId: string;
  newLoanId: string;
  newContractNumber: string;
  refinancedBalance: number;
  additionalAmount: number;
  principal: number;
  total: number;
  /** Saldo de la Caja Mayor después del desembolso adicional (sin cambios si no hay adicional). */
  balance: number;
};

export function refinanceLoan(
  deps: ContractDeps,
  actor: SessionContext,
  input: RefinanceInput & { idempotencyKey: IdempotencyKey; loanId: string },
  now: () => Date = () => new Date(),
): Promise<CashCommandOutcome<Refinanced>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<Refinanced>(deps, {
    name: "RefinanciarPrestamo",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const previous = await loadPreviousLoan(tx, context.businessId, input.loanId);
      if (!actor.businessTimeZone)
        throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
      const disbursedOn = localDateIn(now(), actor.businessTimeZone);
      assertFirstDueNotBeforeDisbursement(input.firstDueOn, disbursedOn);
      const plan = planFor(previous, input);

      const number = (
        await tx.query<{ number: string }>("select private.next_contract_number($1) as number", [
          context.businessId,
        ])
      ).rows[0]!.number;
      const contractId = (
        await tx.query<{ id: string }>(
          `insert into public.contracts (business_id, client_id, number, origin, comment, created_by)
           values ($1, $2, $3, 'NUEVO', $4, $5) returning id`,
          [context.businessId, previous.clientId, number, input.note ?? null, context.actorId],
        )
      ).rows[0]!.id;
      const newLoanId = (
        await tx.query<{ id: string }>(
          `insert into public.loans
             (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
              scheduled_amount, disbursed_on, first_due_on, frequency, installment_count, previous_loan_id, created_by)
           values ($1, $2, $3, $4, $5, $6, $6, $7, $8, $9, $10, $11, $12) returning id`,
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
            input.loanId,
            context.actorId,
          ],
        )
      ).rows[0]!.id;
      await tx.query(
        `insert into public.installments (business_id, loan_id, number, due_on, amount)
         select $1, $2, number, due_on, amount
           from unnest($3::int[], $4::date[], $5::bigint[]) as t(number, due_on, amount)`,
        [
          context.businessId,
          newLoanId,
          plan.installments.map((installment) => installment.number),
          plan.installments.map((installment) => installment.dueOn),
          plan.installments.map((installment) => installment.amount),
        ],
      );

      // Solo el monto adicional sale de la caja; el saldo refinanciado no mueve efectivo.
      let balance: number;
      let disbursementId: string | null = null;
      if (input.additionalAmount > 0) {
        const disbursement = await insertMovement(tx, context, {
          type: "DESEMBOLSO_PRESTAMO",
          direction: "SALIDA",
          amount: input.additionalAmount,
          reference: { type: "loan", id: newLoanId },
          note: `Monto adicional de la refinanciación de ${previous.contractNumber}`,
        });
        disbursementId = disbursement.id;
        balance = disbursement.balance;
      } else {
        const sum = await tx.query<{ balance: string }>(
          `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance
             from public.cash_movements where cashbox_id = $1 and session_id is null`,
          [context.cashboxId],
        );
        balance = money(sum.rows[0]!.balance);
      }

      const refinancingId = (
        await tx.query<{ id: string }>(
          `insert into public.refinancings
             (business_id, previous_loan_id, new_loan_id, refinanced_balance, additional_amount, note, created_by)
           values ($1, $2, $3, $4, $5, $6, $7) returning id`,
          [
            context.businessId,
            input.loanId,
            newLoanId,
            previous.pending,
            input.additionalAmount,
            input.note ?? null,
            context.actorId,
          ],
        )
      ).rows[0]!.id;
      await tx.query("update public.loans set status = 'REFINANCIADO' where id = $1", [
        input.loanId,
      ]);

      return {
        result: {
          refinancingId,
          previousLoanId: input.loanId,
          newLoanId,
          newContractNumber: number,
          refinancedBalance: previous.pending,
          additionalAmount: input.additionalAmount,
          principal: plan.principal,
          total: plan.total,
          balance,
        },
        audit: [
          {
            action: "RefinanciacionCreada",
            entityType: "refinancing",
            entityId: refinancingId,
            summary: {
              previousLoanId: input.loanId,
              newLoanId,
              refinancedBalance: previous.pending,
              additionalAmount: input.additionalAmount,
              principal: plan.principal,
              total: plan.total,
            },
          },
          {
            action: "SaldoAnteriorRefinanciado",
            entityType: "loan",
            entityId: input.loanId,
            summary: {
              contractNumber: previous.contractNumber,
              refinancedBalance: previous.pending,
              newLoanId,
            },
          },
          {
            action: "PrestamoRefinanciado",
            entityType: "loan",
            entityId: input.loanId,
            summary: { newLoanId },
          },
          {
            action: "ContratoCreado",
            entityType: "contract",
            entityId: contractId,
            summary: {
              number,
              clientId: previous.clientId,
              origin: "NUEVO",
              refinances: input.loanId,
            },
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
            entityId: newLoanId,
            summary: {
              contractId,
              principal: plan.principal,
              interestBps: input.interestBps,
              interest: plan.interest,
              total: plan.total,
              frequency: input.frequency,
              firstDueOn: input.firstDueOn,
              previousLoanId: input.loanId,
            },
          },
          {
            action: "CuotasGeneradas",
            entityType: "loan",
            entityId: newLoanId,
            summary: {
              count: plan.installments.length,
              firstDueOn: plan.installments[0]!.dueOn,
              lastDueOn: plan.installments.at(-1)!.dueOn,
              total: plan.total,
            },
          },
          ...(disbursementId
            ? [
                {
                  action: "MontoAdicionalDesembolsado",
                  entityType: "loan",
                  entityId: newLoanId,
                  summary: {
                    amount: input.additionalAmount,
                    movementId: disbursementId,
                    disbursedOn,
                  },
                },
              ]
            : []),
        ],
      };
    },
  });
}
