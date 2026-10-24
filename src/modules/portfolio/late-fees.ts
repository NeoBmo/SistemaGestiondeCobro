import { randomUUID } from "node:crypto";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { money } from "@/shared/money/money";
import type { ContractDeps } from "./contracts";
import {
  activeChargeBalance,
  assertLoanActive,
  installmentsWithApplied,
  lockLoan,
} from "./payments";

/**
 * Cargos de mora (02 §3.4). Son una penalización **decidida a mano** por el Admin: ninguna fórmula ni
 * proceso los crea, y la mora de una cuota sigue siendo un cálculo derivado sin efecto en dinero. Se pagan
 * solo con un pago explícito contra el cargo (`registerPayment` con `lateFeeChargeId`) y se anulan con
 * motivo, sin pagos vigentes. No mueven la caja: son comandos con idempotencia y auditoría sobre
 * `runCashCommand` por consistencia con el resto de la cartera.
 *
 * La mora es por atraso: el cargo exige una cuota ya vencida (la indicada o, si es sobre el préstamo,
 * alguna). «Vencida» es `vencimiento < hoy` en la zona horaria del negocio, igual que la mora derivada.
 */

export type CreatedLateFee = {
  chargeId: string;
  loanId: string;
  installmentNumber: number | null;
  amount: number;
};

export function createLateFee(
  deps: ContractDeps,
  actor: SessionContext,
  input: {
    idempotencyKey: IdempotencyKey;
    loanId: string;
    installmentId?: string;
    amount: number;
    reason: string;
  },
  now: () => Date = () => new Date(),
): Promise<CashCommandOutcome<CreatedLateFee>> {
  // Se valida el importe antes de autorizar: la ruta ya autorizó antes de llegar aquí (un llamador interno
  // sin permiso verá este error antes que el 403).
  money(input.amount);
  if (input.amount <= 0)
    throw new AppError("INVALID_MONEY", "El importe debe ser mayor que cero", 400);
  const { idempotencyKey, ...content } = input;
  return runCashCommand<CreatedLateFee>(deps, {
    name: "CrearCargoMora",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const loan = await lockLoan(tx, context.businessId, input.loanId);
      assertLoanActive(loan, "cargos de mora");

      const today = await businessToday(tx, context.businessId, now());
      let installmentNumber: number | null = null;
      if (input.installmentId) {
        const found = await tx.query<{ number: number; overdue: boolean }>(
          `select number, due_on < $4::date as overdue
             from public.installments where id = $1 and loan_id = $2 and business_id = $3`,
          [input.installmentId, input.loanId, context.businessId, today],
        );
        if (!found.rows[0]) {
          throw new AppError("INSTALLMENT_NOT_FOUND", "La cuota no pertenece a este préstamo", 404);
        }
        installmentNumber = found.rows[0].number;
        if (!found.rows[0].overdue) {
          throw new AppError(
            "INSTALLMENT_NOT_OVERDUE",
            `La cuota ${installmentNumber} todavía no está vencida: el cargo de mora es solo por atraso`,
            409,
          );
        }
      } else {
        const overdue = await tx.query(
          `select 1 from public.installments
            where loan_id = $1 and business_id = $2 and due_on < $3::date limit 1`,
          [input.loanId, context.businessId, today],
        );
        if ((overdue.rowCount ?? 0) === 0) {
          throw new AppError(
            "LOAN_NOT_OVERDUE",
            "El préstamo no tiene cuotas vencidas: el cargo de mora es solo por atraso",
            409,
          );
        }
      }

      const chargeId = randomUUID();
      await tx.query(
        `insert into public.late_fee_charges (id, business_id, loan_id, installment_id, amount, reason, created_by)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [
          chargeId,
          context.businessId,
          input.loanId,
          input.installmentId ?? null,
          input.amount,
          input.reason,
          context.actorId,
        ],
      );
      return {
        result: { chargeId, loanId: input.loanId, installmentNumber, amount: input.amount },
        audit: [
          {
            action: "CargoMoraCreado",
            entityType: "late_fee_charge",
            entityId: chargeId,
            summary: {
              loanId: input.loanId,
              installmentNumber,
              amount: input.amount,
              reason: input.reason,
            },
          },
        ],
      };
    },
  });
}

export type VoidedLateFee = {
  chargeId: string;
  loanId: string;
  amount: number;
  /** `true` si al anular el cargo el préstamo quedó pagado: cuotas y cargos activos en cero. */
  loanPaid: boolean;
};

/** Anula un cargo con motivo. Solo si no tiene pagos vigentes: primero se reversan (ADR 0008). */
export function voidLateFee(
  deps: ContractDeps,
  actor: SessionContext,
  input: { idempotencyKey: IdempotencyKey; chargeId: string; reason: string },
): Promise<CashCommandOutcome<VoidedLateFee>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<VoidedLateFee>(deps, {
    name: "AnularCargoMora",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const owner = await tx.query<{ loan_id: string }>(
        "select loan_id from public.late_fee_charges where id = $1 and business_id = $2",
        [input.chargeId, context.businessId],
      );
      if (!owner.rows[0])
        throw new AppError("LATE_FEE_NOT_FOUND", "El cargo de mora no existe", 404);
      // Primero el préstamo, luego el estado del cargo: así lo leído no cambia hasta confirmar.
      const loan = await lockLoan(tx, context.businessId, owner.rows[0].loan_id);
      const found = await tx.query<{ loan_id: string; amount: string; voided: boolean }>(
        `select c.loan_id, c.amount::text,
                exists (select 1 from public.late_fee_voids v where v.charge_id = c.id) as voided
           from public.late_fee_charges c where c.id = $1 and c.business_id = $2`,
        [input.chargeId, context.businessId],
      );
      const charge = found.rows[0]!;
      if (charge.voided)
        throw new AppError("LATE_FEE_VOIDED", "El cargo de mora ya está anulado", 409);

      const applied = await tx.query<{ applied: string }>(
        "select private.charge_applied($1)::text as applied",
        [input.chargeId],
      );
      if (money(applied.rows[0]!.applied) > 0) {
        throw new AppError(
          "LATE_FEE_HAS_PAYMENTS",
          "El cargo de mora tiene pagos vigentes: reversa primero sus pagos para poder anularlo",
          409,
        );
      }

      await tx.query(
        `insert into public.late_fee_voids (business_id, charge_id, reason, voided_by)
         values ($1, $2, $3, $4)`,
        [context.businessId, input.chargeId, input.reason, context.actorId],
      );
      const amount = money(charge.amount);
      // El cargo anulado tenía saldo (sin pagos vigentes), así que el préstamo no estaba pagado: si ahora
      // queda sin saldo, este es su cierre y se audita igual que el primero (02 §3.4).
      const loanPaid = await isLoanPaid(tx, charge.loan_id);
      return {
        result: { chargeId: input.chargeId, loanId: charge.loan_id, amount, loanPaid },
        audit: [
          {
            action: "CargoMoraAnulado",
            entityType: "late_fee_charge",
            entityId: input.chargeId,
            summary: { loanId: charge.loan_id, amount, reason: input.reason },
          },
          ...(loanPaid
            ? [
                {
                  action: "PrestamoPagado",
                  entityType: "loan",
                  entityId: charge.loan_id,
                  summary: { contractNumber: loan.contract_number, voidedChargeId: input.chargeId },
                },
              ]
            : []),
        ],
      };
    },
  });
}

/** Fecha de hoy en la zona horaria del negocio: la que decide si una cuota ya venció. */
async function businessToday(tx: Tx, businessId: string, instant: Date) {
  const zone = await tx.query<{ time_zone: string }>(
    "select time_zone from public.businesses where id = $1",
    [businessId],
  );
  return localDateIn(instant, zone.rows[0]!.time_zone);
}

/** Cuotas y cargos de mora activos en cero: el préstamo está `PAGADO` (estado derivado, 02 §2.3). */
async function isLoanPaid(tx: Tx, loanId: string): Promise<boolean> {
  const installments = await installmentsWithApplied(tx, loanId);
  const pending = installments.reduce((sum, i) => sum + (i.amount - i.applied), 0);
  return pending === 0 && (await activeChargeBalance(tx, loanId)) === 0;
}
