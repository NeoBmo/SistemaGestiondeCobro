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
  /** Saldo pendiente: en F3 todavía no hay pagos, así que es el valor completo. */
  pendingAmount: Money;
  status: InstallmentStatus;
  daysLate: number;
};

export type LoanDetail = {
  loanId: string;
  contractId: string;
  contractNumber: string;
  contractComment: string | null;
  loanStatus: "ACTIVO" | "ANULADO";
  origin: "NUEVO" | "IMPORTADO";
  client: { id: string; name: string };
  principal: Money;
  interestBps: number;
  interest: Money;
  total: Money;
  scheduledAmount: Money;
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
};

type LoanRow = {
  loan_id: string;
  contract_id: string;
  contract_number: string;
  contract_comment: string | null;
  loan_status: "ACTIVO" | "ANULADO";
  origin: "NUEVO" | "IMPORTADO";
  client_id: string;
  client_name: string;
  principal_amount: string;
  interest_bps: number;
  interest_amount: string;
  total_amount: string;
  scheduled_amount: string;
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
            l.scheduled_amount::text, l.frequency, l.installment_count, l.disbursed_on::text,
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

  const rows = await db.query<{ number: number; due_on: string; amount: string }>(
    `select number, due_on::text, amount::text from public.installments
      where loan_id = $1 and business_id = $2 order by number`,
    [loanId, businessId],
  );
  const today = localDateIn(now, row.time_zone);
  const installments: LoanInstallmentView[] = rows.rows.map((installment) => {
    const dueOn = isoDate(installment.due_on);
    const amount = money(installment.amount);
    // Un préstamo anulado no tiene deuda: sus cuotas no están pendientes (02 §2.2).
    const pendingAmount = row.loan_status === "ANULADO" ? money(0) : amount;
    return {
      number: installment.number,
      dueOn,
      amount,
      pendingAmount,
      status: deriveInstallmentStatus({ dueOn, pendingAmount }, today),
      daysLate: pendingAmount > 0 ? daysLate(dueOn, today) : 0,
    };
  });

  const pending = installments.filter((installment) => installment.pendingAmount > 0);
  const next = pending.find((installment) => installment.dueOn >= today) ?? null;
  return {
    loanId: row.loan_id,
    contractId: row.contract_id,
    contractNumber: row.contract_number,
    contractComment: row.contract_comment,
    loanStatus: row.loan_status,
    origin: row.origin,
    client: { id: row.client_id, name: row.client_name },
    principal: money(row.principal_amount),
    interestBps: row.interest_bps,
    interest: money(row.interest_amount),
    total: money(row.total_amount),
    scheduledAmount: money(row.scheduled_amount),
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
  };
}
