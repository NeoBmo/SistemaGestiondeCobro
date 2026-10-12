import { randomUUID } from "node:crypto";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import type { SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { money } from "@/shared/money/money";
import type { ContractDeps } from "./contracts";
import { assertLoanActive, lockLoan } from "./payments";

/**
 * Cargos de mora (02 §3.4). Son una penalización **decidida a mano** por el Admin: ninguna fórmula ni
 * proceso los crea, y la mora de una cuota sigue siendo un cálculo derivado sin efecto en dinero. Se pagan
 * solo con un pago explícito contra el cargo (`registerPayment` con `lateFeeChargeId`) y se anulan con
 * motivo, sin pagos vigentes. No mueven la caja: son comandos con idempotencia y auditoría sobre
 * `runCashCommand` por consistencia con el resto de la cartera.
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

      let installmentNumber: number | null = null;
      if (input.installmentId) {
        const found = await tx.query<{ number: number }>(
          "select number from public.installments where id = $1 and loan_id = $2 and business_id = $3",
          [input.installmentId, input.loanId, context.businessId],
        );
        if (!found.rows[0]) {
          throw new AppError("INSTALLMENT_NOT_FOUND", "La cuota no pertenece a este préstamo", 404);
        }
        installmentNumber = found.rows[0].number;
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

export type VoidedLateFee = { chargeId: string; loanId: string; amount: number };

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
      await lockLoan(tx, context.businessId, owner.rows[0].loan_id);
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
      return {
        result: { chargeId: input.chargeId, loanId: charge.loan_id, amount },
        audit: [
          {
            action: "CargoMoraAnulado",
            entityType: "late_fee_charge",
            entityId: input.chargeId,
            summary: { loanId: charge.loan_id, amount, reason: input.reason },
          },
        ],
      };
    },
  });
}
