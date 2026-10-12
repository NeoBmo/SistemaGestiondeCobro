import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import type { ContractDeps } from "./contracts";
import { calculateImportedLoan, type ImportedLoanPlan } from "./loan-calculation";
import type { ImportLoanInput, ImportLoanTermsInput } from "./loan-validation";

/**
 * Importación de cartera previa (02 §6.1, ADR 0007): un contrato con `origen = IMPORTADO` y su préstamo,
 * cargados uno a uno con los datos históricos. **No crea pagos, desembolsos ni movimientos en ninguna
 * caja**; lo ya pagado queda como dato de referencia y el calendario guarda solo las cuotas que faltan.
 * Sigue siendo un comando con idempotencia y auditoría, pero no toca la Caja Mayor.
 */

export type ImportPreview = {
  plan: {
    principal: number;
    interest: number;
    total: number;
    scheduled: number;
    installments: { number: number; dueOn: IsoDate; amount: number }[];
  };
  historicalPaid: number | null;
  /** Cuotas cuyo vencimiento ya pasó (mora anterior): se mostrarán vencidas. */
  overdueInstallments: number;
  /**
   * total pactado − pagado histórico − saldo pendiente. Es solo informativo: si no es cero, los datos
   * históricos no cuadran entre sí (p. ej. hubo abonos de interés o descuentos) y el admin decide.
   */
  difference: number | null;
};

const toPlain = (plan: ImportedLoanPlan): ImportPreview["plan"] => ({
  principal: plan.principal,
  interest: plan.interest,
  total: plan.total,
  scheduled: plan.scheduled,
  installments: plan.installments.map(({ number, dueOn, amount }) => ({ number, dueOn, amount })),
});

async function assertClientInBusiness(db: Pick<Tx, "query">, businessId: string, clientId: string) {
  const found = await db.query("select 1 from public.clients where id = $1 and business_id = $2", [
    clientId,
    businessId,
  ]);
  if ((found.rowCount ?? 0) === 0)
    throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);
}

function planFor(input: ImportLoanTermsInput, today: IsoDate): ImportedLoanPlan {
  if (input.originalDate > today) {
    throw new AppError(
      "IMPORT_DATE_IN_FUTURE",
      "La fecha original del préstamo no puede ser posterior a hoy",
      400,
    );
  }
  if (input.nextDueOn < input.originalDate) {
    throw new AppError(
      "NEXT_DUE_BEFORE_ORIGINAL",
      "La próxima fecha de cobro no puede ser anterior a la fecha original del préstamo",
      400,
    );
  }
  return calculateImportedLoan({
    principal: input.principal,
    interestBps: input.interestBps,
    frequency: input.frequency,
    installmentCount: input.installmentCount,
    firstDueOn: input.nextDueOn,
    pendingBalance: input.pendingBalance,
  });
}

function timeZoneOf(actor: SessionContext): string {
  if (!actor.businessTimeZone)
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  return actor.businessTimeZone;
}

/** Calcula el préstamo importado sin guardar nada: lo que verá el Admin antes de confirmar. */
export async function previewImportedLoan(
  deps: ContractDeps,
  actor: SessionContext,
  input: ImportLoanTermsInput,
  now: () => Date = () => new Date(),
): Promise<ImportPreview> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "VistaPreviaImportacion");
  await assertClientInBusiness(deps.db, businessId, input.clientId);
  const today = localDateIn(now(), timeZoneOf(actor));
  const plan = planFor(input, today);

  return {
    plan: toPlain(plan),
    historicalPaid: input.historicalPaid ?? null,
    overdueInstallments: plan.installments.filter((installment) => installment.dueOn < today)
      .length,
    difference:
      input.historicalPaid === undefined
        ? null
        : plan.total - input.historicalPaid - plan.scheduled,
  };
}

export type ImportedContract = {
  contractId: string;
  contractNumber: string;
  loanId: string;
  total: number;
  scheduled: number;
  installmentCount: number;
};

export function importLoan(
  deps: ContractDeps,
  actor: SessionContext,
  input: ImportLoanInput & { idempotencyKey: IdempotencyKey },
  now: () => Date = () => new Date(),
): Promise<CashCommandOutcome<ImportedContract>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<ImportedContract>(deps, {
    name: "ImportarPrestamo",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      await assertClientInBusiness(tx, context.businessId, input.clientId);
      const plan = planFor(input, localDateIn(now(), timeZoneOf(actor)));

      const number = (
        await tx.query<{ number: string }>("select private.next_contract_number($1) as number", [
          context.businessId,
        ])
      ).rows[0]!.number;
      const contractId = (
        await tx.query<{ id: string }>(
          `insert into public.contracts (business_id, client_id, number, origin, comment, created_by)
           values ($1, $2, $3, 'IMPORTADO', $4, $5) returning id`,
          [context.businessId, input.clientId, number, input.comment ?? null, context.actorId],
        )
      ).rows[0]!.id;

      const loanId = (
        await tx.query<{ id: string }>(
          `insert into public.loans
             (business_id, contract_id, principal_amount, interest_bps, interest_amount, total_amount,
              scheduled_amount, historical_paid_amount, disbursed_on, first_due_on, frequency,
              installment_count, created_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) returning id`,
          [
            context.businessId,
            contractId,
            plan.principal,
            input.interestBps,
            plan.interest,
            plan.total,
            plan.scheduled,
            input.historicalPaid ?? null,
            input.originalDate,
            input.nextDueOn,
            input.frequency,
            plan.installments.length,
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
          loanId,
          plan.installments.map((installment) => installment.number),
          plan.installments.map((installment) => installment.dueOn),
          plan.installments.map((installment) => installment.amount),
        ],
      );

      return {
        result: {
          contractId,
          contractNumber: number,
          loanId,
          total: plan.total,
          scheduled: plan.scheduled,
          installmentCount: plan.installments.length,
        },
        // Sin `PrestamoDesembolsado`: una importación no mueve ninguna caja.
        audit: [
          {
            action: "ContratoCreado",
            entityType: "contract",
            entityId: contractId,
            summary: { number, clientId: input.clientId, origin: "IMPORTADO" },
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
              origin: "IMPORTADO",
              originalDate: input.originalDate,
              principal: plan.principal,
              interestBps: input.interestBps,
              total: plan.total,
              historicalPaid: input.historicalPaid ?? null,
              pendingBalance: plan.scheduled,
              frequency: input.frequency,
              nextDueOn: input.nextDueOn,
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
              total: plan.scheduled,
            },
          },
        ],
      };
    },
  });
}
