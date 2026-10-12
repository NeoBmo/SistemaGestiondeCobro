import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { money, type Money } from "@/shared/money/money";
import { daysLate, deriveInstallmentStatus, type InstallmentStatus } from "./installment-status";

type Db = Pick<Pool, "query">;

export type LoanInstallmentView = {
  number: number;
  dueOn: IsoDate;
  amount: Money;
  /** Lo aplicado por pagos no reversados. */
  appliedAmount: Money;
  /** Saldo pendiente: valor esperado − aplicado (cero si el préstamo está anulado o refinanciado). */
  pendingAmount: Money;
  status: InstallmentStatus;
  daysLate: number;
};

export type LoanPaymentView = {
  id: string;
  kind: "CUOTAS" | "CARGO_MORA";
  amount: Money;
  note: string | null;
  registeredByName: string;
  createdAt: Date;
  /** Cuotas (o cargo) a las que se aplicó, en orden. */
  applications: { installmentNumber: number | null; amount: Money }[];
  reversal: { reason: string; reversedByName: string; createdAt: Date } | null;
  /** Solo el último pago no reversado de un préstamo activo se puede reversar (ADR 0008). */
  canReverse: boolean;
};

export type LateFeeView = {
  id: string;
  amount: Money;
  appliedAmount: Money;
  pendingAmount: Money;
  reason: string;
  installmentNumber: number | null;
  createdAt: Date;
  status: "ACTIVO" | "PAGADO" | "ANULADO";
  voidReason: string | null;
};

/** Estado del préstamo para el usuario: `PAGADO` se deriva (cuotas y cargos activos en cero, 02 §2.3). */
export type LoanDerivedStatus = "ACTIVO" | "PAGADO" | "REFINANCIADO" | "ANULADO";

export type LoanDetail = {
  loanId: string;
  contractId: string;
  contractNumber: string;
  contractComment: string | null;
  loanStatus: "ACTIVO" | "ANULADO" | "REFINANCIADO";
  /** Estado derivado: ACTIVO, PAGADO, REFINANCIADO o ANULADO. */
  status: LoanDerivedStatus;
  origin: "NUEVO" | "IMPORTADO";
  client: { id: string; name: string };
  principal: Money;
  interestBps: number;
  interest: Money;
  total: Money;
  scheduledAmount: Money;
  /** Importado: lo pagado antes de entrar al sistema (solo referencia); `null` en un préstamo nuevo. */
  historicalPaid: Money | null;
  frequency: "DIARIA" | "SEMANAL" | "MENSUAL";
  installmentCount: number;
  disbursedOn: IsoDate;
  firstDueOn: IsoDate;
  createdAt: Date;
  voidedAt: Date | null;
  voidReason: string | null;
  installments: LoanInstallmentView[];
  /** Saldo pendiente: lo programado menos lo pagado (sin pagos todavía). */
  pendingBalance: Money;
  /** Suma de las cuotas con vencimiento anterior a hoy. */
  overdueBalance: Money;
  nextDue: { number: number; dueOn: IsoDate; amount: Money } | null;
  payments: LoanPaymentView[];
  lateFees: LateFeeView[];
  /** Saldo de los cargos de mora activos (no anulados). */
  lateFeeBalance: Money;
  /** Préstamo al que sustituyó esta refinanciación, o el que lo sustituyó a él. */
  refinancing: { previousLoanId: string | null; nextLoanId: string | null };
};

type LoanRow = {
  loan_id: string;
  contract_id: string;
  contract_number: string;
  contract_comment: string | null;
  loan_status: "ACTIVO" | "ANULADO" | "REFINANCIADO";
  origin: "NUEVO" | "IMPORTADO";
  client_id: string;
  client_name: string;
  principal_amount: string;
  interest_bps: number;
  interest_amount: string;
  total_amount: string;
  scheduled_amount: string;
  historical_paid_amount: string | null;
  frequency: "DIARIA" | "SEMANAL" | "MENSUAL";
  installment_count: number;
  disbursed_on: string;
  first_due_on: string;
  created_at: Date;
  voided_at: Date | null;
  void_reason: string | null;
  time_zone: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Préstamo con su contrato, su cliente y su calendario, dentro del negocio de la sesión; `null` si no
 * existe (o es de otro negocio). Los estados de las cuotas se derivan con «hoy» en la zona del negocio.
 */
export async function getLoanDetail(
  db: Db,
  actor: SessionContext,
  loanId: string,
  now: Date = new Date(),
): Promise<LoanDetail | null> {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  const businessId = actor.businessId;
  if (!businessId) throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  if (!UUID.test(loanId)) return null;

  const found = await db.query<LoanRow>(
    `select l.id as loan_id, k.id as contract_id, k.number as contract_number, k.comment as contract_comment,
            l.status as loan_status, k.origin, c.id as client_id, c.name as client_name,
            l.principal_amount::text, l.interest_bps, l.interest_amount::text, l.total_amount::text,
            l.scheduled_amount::text, l.historical_paid_amount::text, l.frequency, l.installment_count, l.disbursed_on::text,
            l.first_due_on::text, l.created_at, k.voided_at, k.void_reason, b.time_zone
       from public.loans l
       join public.contracts k on k.id = l.contract_id
       join public.clients c on c.id = k.client_id
       join public.businesses b on b.id = l.business_id
      where l.id = $1 and l.business_id = $2`,
    [loanId, businessId],
  );
  const row = found.rows[0];
  if (!row) return null;

  const rows = await db.query<{ number: number; due_on: string; amount: string; applied: string }>(
    `select i.number, i.due_on::text, i.amount::text, private.installment_applied(i.id)::text as applied
       from public.installments i where i.loan_id = $1 and i.business_id = $2 order by i.number`,
    [loanId, businessId],
  );
  const today = localDateIn(now, row.time_zone);
  const active = row.loan_status === "ACTIVO";
  const installments: LoanInstallmentView[] = rows.rows.map((installment) => {
    const dueOn = isoDate(installment.due_on);
    const amount = money(installment.amount);
    const appliedAmount = money(installment.applied);
    // Un préstamo anulado o refinanciado no tiene deuda: sus cuotas no están pendientes (02 §2.2, §3.5).
    const pendingAmount = active ? money(amount - appliedAmount) : money(0);
    return {
      number: installment.number,
      dueOn,
      amount,
      appliedAmount,
      pendingAmount,
      status: deriveInstallmentStatus({ dueOn, pendingAmount, appliedAmount }, today),
      daysLate: pendingAmount > 0 ? daysLate(dueOn, today) : 0,
    };
  });

  const paymentRows = await db.query<{
    id: string;
    seq: string;
    kind: "CUOTAS" | "CARGO_MORA";
    amount: string;
    note: string | null;
    registered_by_name: string;
    created_at: Date;
    reversal_reason: string | null;
    reversed_by_name: string | null;
    reversal_at: Date | null;
    applications: { number: number | null; amount: string }[];
  }>(
    `select p.id, p.seq::text, p.kind, p.amount::text, p.note, u.display_name as registered_by_name, p.created_at,
            r.reason as reversal_reason, ru.display_name as reversed_by_name, r.created_at as reversal_at,
            coalesce((select json_agg(json_build_object('number', i.number, 'amount', a.amount::text) order by a.position)
                        from public.payment_applications a
                        left join public.installments i on i.id = a.installment_id
                       where a.payment_id = p.id), '[]'::json) as applications
       from public.payments p
       join public.profiles u on u.id = p.registered_by
       left join public.payment_reversals r on r.payment_id = p.id
       left join public.profiles ru on ru.id = r.reversed_by
      where p.loan_id = $1 and p.business_id = $2
      order by p.seq desc`,
    [loanId, businessId],
  );
  const latestOpen =
    paymentRows.rows.find((payment) => payment.reversal_reason === null)?.id ?? null;
  const payments: LoanPaymentView[] = paymentRows.rows.map((payment) => ({
    id: payment.id,
    kind: payment.kind,
    amount: money(payment.amount),
    note: payment.note,
    registeredByName: payment.registered_by_name,
    createdAt: payment.created_at,
    applications: payment.applications.map((part) => ({
      installmentNumber: part.number,
      amount: money(part.amount),
    })),
    reversal:
      payment.reversal_reason === null
        ? null
        : {
            reason: payment.reversal_reason,
            reversedByName: payment.reversed_by_name ?? "",
            createdAt: payment.reversal_at!,
          },
    canReverse: active && payment.id === latestOpen,
  }));

  const feeRows = await db.query<{
    id: string;
    amount: string;
    applied: string;
    reason: string;
    installment_number: number | null;
    created_at: Date;
    void_reason: string | null;
  }>(
    `select c.id, c.amount::text, private.charge_applied(c.id)::text as applied, c.reason, i.number as installment_number,
            c.created_at, v.reason as void_reason
       from public.late_fee_charges c
       left join public.installments i on i.id = c.installment_id
       left join public.late_fee_voids v on v.charge_id = c.id
      where c.loan_id = $1 and c.business_id = $2
      order by c.created_at, c.id`,
    [loanId, businessId],
  );
  const lateFees: LateFeeView[] = feeRows.rows.map((fee) => {
    const amount = money(fee.amount);
    const appliedAmount = money(fee.applied);
    const voided = fee.void_reason !== null;
    return {
      id: fee.id,
      amount,
      appliedAmount,
      pendingAmount: voided || !active ? money(0) : money(amount - appliedAmount),
      reason: fee.reason,
      installmentNumber: fee.installment_number,
      createdAt: fee.created_at,
      status: voided ? "ANULADO" : amount - appliedAmount === 0 ? "PAGADO" : "ACTIVO",
      voidReason: fee.void_reason,
    };
  });
  const lateFeeBalance = money(lateFees.reduce((sum, fee) => sum + fee.pendingAmount, 0));

  const links = await db.query<{ previous_loan_id: string | null; next_loan_id: string | null }>(
    `select (select previous_loan_id from public.refinancings where new_loan_id = $1) as previous_loan_id,
            (select new_loan_id from public.refinancings where previous_loan_id = $1) as next_loan_id`,
    [loanId],
  );

  const pending = installments.filter((installment) => installment.pendingAmount > 0);
  const next = pending.find((installment) => installment.dueOn >= today) ?? null;
  return {
    loanId: row.loan_id,
    contractId: row.contract_id,
    contractNumber: row.contract_number,
    contractComment: row.contract_comment,
    loanStatus: row.loan_status,
    status:
      row.loan_status === "ACTIVO" &&
      installments.every((i) => i.pendingAmount === 0) &&
      lateFeeBalance === 0
        ? "PAGADO"
        : row.loan_status,
    origin: row.origin,
    client: { id: row.client_id, name: row.client_name },
    principal: money(row.principal_amount),
    interestBps: row.interest_bps,
    interest: money(row.interest_amount),
    total: money(row.total_amount),
    scheduledAmount: money(row.scheduled_amount),
    historicalPaid: row.historical_paid_amount === null ? null : money(row.historical_paid_amount),
    frequency: row.frequency,
    installmentCount: row.installment_count,
    disbursedOn: isoDate(row.disbursed_on),
    firstDueOn: isoDate(row.first_due_on),
    createdAt: row.created_at,
    voidedAt: row.voided_at,
    voidReason: row.void_reason,
    installments,
    pendingBalance: money(pending.reduce((sum, installment) => sum + installment.pendingAmount, 0)),
    overdueBalance: money(
      pending
        .filter((installment) => installment.status === "VENCIDA")
        .reduce((sum, installment) => sum + installment.pendingAmount, 0),
    ),
    nextDue: next ? { number: next.number, dueOn: next.dueOn, amount: next.pendingAmount } : null,
    payments,
    lateFees,
    lateFeeBalance,
    refinancing: {
      previousLoanId: links.rows[0]?.previous_loan_id ?? null,
      nextLoanId: links.rows[0]?.next_loan_id ?? null,
    },
  };
}
