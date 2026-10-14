import { randomUUID } from "node:crypto";
import { insertMovement } from "@/modules/cash/commands";
import { runCashCommand, type CashCommandOutcome } from "@/modules/cash/run-cash-command";
import type { SessionContext } from "@/modules/identity/session";
import type { Tx } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";
import { formatMoney, money } from "@/shared/money/money";
import type { ContractDeps } from "./contracts";

/**
 * Pagos y reversos (02 §3.1–3.2, ADR 0008). Comandos financieros sobre `runCashCommand`: una transacción,
 * bloqueo de la caja, idempotencia y auditoría. El pago de un Admin entra a la Caja Mayor como `COBRO`; su
 * reverso es un `REVERSO` vinculado. Todo es de solo agregado: ni el pago ni sus aplicaciones se editan;
 * el saldo de cuotas y cargos se deriva de las aplicaciones de los pagos no reversados.
 */

type LoanRow = {
  id: string;
  status: "ACTIVO" | "ANULADO" | "REFINANCIADO";
  contract_number: string;
};

/** Préstamo del negocio de la sesión, bloqueado hasta confirmar: serializa pagos y reversos del mismo préstamo. */
export async function lockLoan(tx: Tx, businessId: string, loanId: string): Promise<LoanRow> {
  const { rows } = await tx.query<LoanRow>(
    `select l.id, l.status, k.number as contract_number
       from public.loans l join public.contracts k on k.id = l.contract_id
      where l.id = $1 and l.business_id = $2
      for update of l`,
    [loanId, businessId],
  );
  const loan = rows[0];
  if (!loan) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
  return loan;
}

export function assertLoanActive(
  loan: LoanRow,
  action: "pagos" | "reversos" | "cargos de mora" | "refinanciaciones" = "pagos",
): void {
  if (loan.status !== "ACTIVO") {
    const why = loan.status === "REFINANCIADO" ? "fue refinanciado" : "está anulado";
    throw new AppError("LOAN_NOT_ACTIVE", `Este préstamo ${why}: ya no recibe ${action}`, 409);
  }
}

type PendingInstallment = { id: string; number: number; amount: number; applied: number };

export async function installmentsWithApplied(
  tx: Tx,
  loanId: string,
): Promise<PendingInstallment[]> {
  const { rows } = await tx.query<{ id: string; number: number; amount: string; applied: string }>(
    `select i.id, i.number, i.amount::text, private.installment_applied(i.id)::text as applied
       from public.installments i where i.loan_id = $1 order by i.number`,
    [loanId],
  );
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    amount: money(row.amount),
    applied: money(row.applied),
  }));
}

/** Cargos de mora no anulados con saldo pendiente (02 §3.4): un préstamo no está pagado con alguno. */
export async function activeChargeBalance(tx: Tx, loanId: string): Promise<number> {
  const { rows } = await tx.query<{ balance: string }>(
    `select coalesce(sum(c.amount - private.charge_applied(c.id)), 0)::text as balance
       from public.late_fee_charges c
      where c.loan_id = $1 and not exists (select 1 from public.late_fee_voids v where v.charge_id = c.id)`,
    [loanId],
  );
  return money(rows[0]!.balance);
}

/** El préstamo es de un cliente con asignación activa a este cobrador; si no, «no existe» (no se revela). */
async function assertInPortfolio(tx: Tx, loanId: string, collectorId: string): Promise<void> {
  const { rowCount } = await tx.query(
    `select 1
       from public.loans l
       join public.contracts k on k.id = l.contract_id
       join public.client_assignments a on a.client_id = k.client_id and a.status = 'ACTIVA'
      where l.id = $1 and a.collector_id = $2`,
    [loanId, collectorId],
  );
  if ((rowCount ?? 0) === 0) throw new AppError("LOAN_NOT_FOUND", "El préstamo no existe", 404);
}

export type PaymentApplicationView = {
  /** Cuota a la que se aplicó (número de orden), o `null` si fue un pago de cargo de mora. */
  installmentNumber: number | null;
  applied: number;
  /** Saldo que le queda a esa cuota (o al cargo) después del pago. */
  pendingAfter: number;
};

export type RegisteredPayment = {
  paymentId: string;
  movementId: string;
  amount: number;
  kind: "CUOTAS" | "CARGO_MORA";
  applications: PaymentApplicationView[];
  /** Saldo de la Caja Mayor después del cobro. */
  balance: number;
  /** Saldo pendiente de las cuotas del préstamo después del pago. */
  loanPendingBalance: number;
  /** `true` si el préstamo quedó pagado: cuotas y cargos de mora activos en cero. */
  loanPaid: boolean;
};

export type RegisterPaymentInput = {
  idempotencyKey: IdempotencyKey;
  loanId: string;
  amount: number;
  /** Si se indica, es un pago explícito contra ese cargo de mora (02 §3.1); si no, un pago de cuotas. */
  lateFeeChargeId?: string;
  note?: string;
};

/**
 * Registra un pago. Un pago de cuotas se aplica a la cuota pendiente más antigua, cubre hasta su saldo y
 * el excedente pasa a la siguiente en orden cronológico; nunca se traslada un faltante a la última cuota ni
 * se cambia el calendario (02 §3.2). No puede superar el saldo pendiente de las cuotas, ni haber saldo a
 * favor. Un pago de cargo de mora no puede superar el saldo de ese cargo.
 */
export function registerPayment(
  deps: ContractDeps,
  actor: SessionContext,
  input: RegisterPaymentInput,
): Promise<CashCommandOutcome<RegisteredPayment>> {
  return runRegisterPayment(deps, actor, input, "ADMIN_NEGOCIO");
}

/**
 * El cobrador registra un cobro (02 §3.1, §8, ADR 0009): entra como un `COBRO` a su jornada `ABIERTA` (no a la
 * Caja Mayor), en la misma transacción que reduce la deuda, y solo sobre clientes de su cartera (asignación
 * activa). Un cliente ajeno es «no encontrado»: no se revela su existencia.
 */
export function registerCollectorPayment(
  deps: ContractDeps,
  actor: SessionContext,
  input: RegisterPaymentInput,
): Promise<CashCommandOutcome<RegisteredPayment>> {
  return runRegisterPayment(deps, actor, input, "COBRADOR");
}

function runRegisterPayment(
  deps: ContractDeps,
  actor: SessionContext,
  input: RegisterPaymentInput,
  role: "ADMIN_NEGOCIO" | "COBRADOR",
): Promise<CashCommandOutcome<RegisteredPayment>> {
  // Defensa en profundidad: el servicio no confía en que la ruta ya validó el importe.
  money(input.amount);
  if (input.amount <= 0)
    throw new AppError("INVALID_MONEY", "El importe debe ser mayor que cero", 400);
  const { idempotencyKey, ...content } = input;
  return runCashCommand<RegisteredPayment>(deps, {
    name: "RegistrarPago",
    role,
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      let sessionId: string | null = null;
      if (role === "COBRADOR") {
        const open = await tx.query<{ id: string }>(
          "select id from public.cash_sessions where collector_id = $1 and status = 'ABIERTA'",
          [context.collectorId],
        );
        sessionId = open.rows[0]?.id ?? null;
        if (!sessionId) {
          throw new AppError("NO_OPEN_SESSION", "Abre tu jornada antes de registrar un cobro", 409);
        }
      }
      const loan = await lockLoan(tx, context.businessId, input.loanId);
      if (role === "COBRADOR") await assertInPortfolio(tx, input.loanId, context.collectorId!);
      assertLoanActive(loan);

      const paymentId = randomUUID();
      const planned: {
        installmentId: string | null;
        chargeId: string | null;
        number: number | null;
        amount: number;
        pendingAfter: number;
      }[] = [];

      if (input.lateFeeChargeId) {
        const charge = await tx.query<{ amount: string; applied: string; voided: boolean }>(
          `select c.amount::text, private.charge_applied(c.id)::text as applied,
                  exists (select 1 from public.late_fee_voids v where v.charge_id = c.id) as voided
             from public.late_fee_charges c where c.id = $1 and c.loan_id = $2 and c.business_id = $3`,
          [input.lateFeeChargeId, input.loanId, context.businessId],
        );
        const row = charge.rows[0];
        if (!row) throw new AppError("LATE_FEE_NOT_FOUND", "El cargo de mora no existe", 404);
        if (row.voided) throw new AppError("LATE_FEE_VOIDED", "El cargo de mora está anulado", 409);
        const pending = money(row.amount) - money(row.applied);
        if (pending <= 0)
          throw new AppError("LATE_FEE_PAID", "Este cargo de mora ya está pagado", 409);
        if (input.amount > pending) {
          throw new AppError(
            "PAYMENT_EXCEEDS_BALANCE",
            `El pago supera el saldo del cargo de mora, que es de ${formatMoney(money(pending))}`,
            409,
          );
        }
        planned.push({
          installmentId: null,
          chargeId: input.lateFeeChargeId,
          number: null,
          amount: input.amount,
          pendingAfter: pending - input.amount,
        });
      } else {
        const installments = await installmentsWithApplied(tx, input.loanId);
        const totalPending = installments.reduce((sum, i) => sum + (i.amount - i.applied), 0);
        if (totalPending <= 0)
          throw new AppError("LOAN_PAID", "Este préstamo no tiene cuotas pendientes", 409);
        if (input.amount > totalPending) {
          throw new AppError(
            "PAYMENT_EXCEEDS_BALANCE",
            `El pago supera el saldo pendiente de las cuotas, que es de ${formatMoney(money(totalPending))}`,
            409,
          );
        }
        // Cuota pendiente más antigua primero; el excedente pasa a la siguiente (02 §3.2).
        let remaining = input.amount;
        for (const installment of installments) {
          if (remaining === 0) break;
          const pending = installment.amount - installment.applied;
          if (pending <= 0) continue;
          const applied = Math.min(remaining, pending);
          planned.push({
            installmentId: installment.id,
            chargeId: null,
            number: installment.number,
            amount: applied,
            pendingAfter: pending - applied,
          });
          remaining -= applied;
        }
      }

      const movement = await insertMovement(tx, context, {
        type: "COBRO",
        direction: "ENTRADA",
        amount: input.amount,
        note: input.note,
        reference: { type: "payment", id: paymentId },
        sessionId,
      });
      await tx.query(
        `insert into public.payments (id, business_id, loan_id, kind, late_fee_charge_id, amount, movement_id, note, registered_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          paymentId,
          context.businessId,
          input.loanId,
          input.lateFeeChargeId ? "CARGO_MORA" : "CUOTAS",
          input.lateFeeChargeId ?? null,
          input.amount,
          movement.id,
          input.note ?? null,
          context.actorId,
        ],
      );
      for (const [index, part] of planned.entries()) {
        await tx.query(
          `insert into public.payment_applications (business_id, payment_id, installment_id, late_fee_charge_id, amount, position)
           values ($1, $2, $3, $4, $5, $6)`,
          [
            context.businessId,
            paymentId,
            part.installmentId,
            part.chargeId,
            part.amount,
            index + 1,
          ],
        );
      }

      const after = await installmentsWithApplied(tx, input.loanId);
      const loanPendingBalance = after.reduce((sum, i) => sum + (i.amount - i.applied), 0);
      const loanPaid =
        loanPendingBalance === 0 && (await activeChargeBalance(tx, input.loanId)) === 0;
      const kind = input.lateFeeChargeId ? "CARGO_MORA" : "CUOTAS";

      const applications: PaymentApplicationView[] = planned.map((part) => ({
        installmentNumber: part.number,
        applied: part.amount,
        pendingAfter: part.pendingAfter,
      }));
      return {
        result: {
          paymentId,
          movementId: movement.id,
          amount: input.amount,
          kind,
          applications,
          balance: movement.balance,
          loanPendingBalance,
          loanPaid,
        },
        audit: [
          {
            action: "PagoRegistrado",
            entityType: "payment",
            entityId: paymentId,
            summary: { loanId: input.loanId, amount: input.amount, kind, movementId: movement.id },
          },
          {
            action: "PagoAplicado",
            entityType: "payment",
            entityId: paymentId,
            summary: { applications },
          },
          ...planned
            .filter((part) => part.pendingAfter === 0 && part.installmentId)
            .map((part) => ({
              action: "CuotaPagada",
              entityType: "installment",
              entityId: part.installmentId!,
              summary: { loanId: input.loanId, number: part.number, paymentId },
            })),
          ...(input.lateFeeChargeId && planned[0]!.pendingAfter === 0
            ? [
                {
                  action: "CargoMoraPagado",
                  entityType: "late_fee_charge",
                  entityId: input.lateFeeChargeId,
                  summary: { loanId: input.loanId, paymentId },
                },
              ]
            : []),
          ...(loanPaid
            ? [
                {
                  action: "PrestamoPagado",
                  entityType: "loan",
                  entityId: input.loanId,
                  summary: { contractNumber: loan.contract_number, paymentId },
                },
              ]
            : []),
        ],
      };
    },
  });
}

export type ReversedPayment = {
  reversalId: string;
  paymentId: string;
  /** Movimiento que compensa el cobro en la Caja Mayor. */
  movementId: string;
  amount: number;
  balance: number;
  loanPendingBalance: number;
};

/**
 * Reversa un pago (02 §3.1, ADR 0008): solo el más reciente no reversado del préstamo. El pago y sus
 * aplicaciones permanecen; el reverso es un hecho nuevo con motivo que deja de contarlas y compensa el
 * cobro en la caja con un `REVERSO` vinculado. Como toda salida de la Caja Mayor, no puede dejar el saldo
 * negativo: si la caja ya no tiene el dinero, se rechaza.
 */
export function reversePayment(
  deps: ContractDeps,
  actor: SessionContext,
  input: { idempotencyKey: IdempotencyKey; paymentId: string; reason: string },
): Promise<CashCommandOutcome<ReversedPayment>> {
  const { idempotencyKey, ...content } = input;
  return runCashCommand<ReversedPayment>(deps, {
    name: "ReversarPago",
    actor,
    idempotencyKey,
    input: content,
    execute: async (tx, context) => {
      const found = await tx.query<{
        id: string;
        loan_id: string;
        amount: string;
        movement_id: string;
        seq: string;
      }>(
        "select id, loan_id, amount::text, movement_id, seq::text from public.payments where id = $1 and business_id = $2",
        [input.paymentId, context.businessId],
      );
      const payment = found.rows[0];
      if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "El pago no existe", 404);

      const loan = await lockLoan(tx, context.businessId, payment.loan_id);
      assertLoanActive(loan, "reversos");

      const state = await tx.query<{ reversed: boolean; later: string }>(
        `select exists (select 1 from public.payment_reversals r where r.payment_id = $1) as reversed,
                (select count(*) from public.payments later
                  where later.loan_id = $2 and later.seq > $3::bigint
                    and not exists (select 1 from public.payment_reversals r where r.payment_id = later.id))::text as later`,
        [payment.id, payment.loan_id, payment.seq],
      );
      if (state.rows[0]!.reversed) {
        throw new AppError("PAYMENT_ALREADY_REVERSED", "Este pago ya fue reversado", 409);
      }
      if (Number(state.rows[0]!.later) > 0) {
        throw new AppError(
          "PAYMENT_NOT_LATEST",
          "Solo se reversa el pago más reciente del préstamo: reversa antes los pagos posteriores",
          409,
        );
      }

      const amount = money(payment.amount);
      // El cobro de una jornada se reversa en su Caja Menor mientras esté ABIERTA o PENDIENTE; si ya se
      // liquidó, la corrección va a la Caja Mayor y la jornada no cambia (ADR 0009).
      const origin = await tx.query<{ session_id: string | null; session_status: string | null }>(
        `select m.session_id, s.status as session_status
           from public.cash_movements m left join public.cash_sessions s on s.id = m.session_id
          where m.id = $1`,
        [payment.movement_id],
      );
      const sessionId =
        origin.rows[0]!.session_status === "ABIERTA" ||
        origin.rows[0]!.session_status === "PENDIENTE_LIQUIDACION"
          ? origin.rows[0]!.session_id
          : null;
      const reversal = await insertMovement(tx, context, {
        type: "REVERSO",
        direction: "SALIDA",
        amount,
        reason: `Reverso del pago: ${input.reason}`,
        reverses: payment.movement_id,
        reference: { type: "payment", id: payment.id },
        sessionId,
      });
      const reversalId = (
        await tx.query<{ id: string }>(
          `insert into public.payment_reversals (business_id, payment_id, reason, movement_id, reversed_by)
           values ($1, $2, $3, $4, $5) returning id`,
          [context.businessId, payment.id, input.reason, reversal.id, context.actorId],
        )
      ).rows[0]!.id;

      const after = await installmentsWithApplied(tx, payment.loan_id);
      return {
        result: {
          reversalId,
          paymentId: payment.id,
          movementId: reversal.id,
          amount,
          balance: reversal.balance,
          loanPendingBalance: after.reduce((sum, i) => sum + (i.amount - i.applied), 0),
        },
        audit: [
          {
            action: "PagoReversado",
            entityType: "payment",
            entityId: payment.id,
            summary: {
              loanId: payment.loan_id,
              amount,
              reason: input.reason,
              reversalId,
              movementId: reversal.id,
            },
          },
        ],
      };
    },
  });
}
