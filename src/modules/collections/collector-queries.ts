import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import {
  deriveInstallmentStatus,
  daysLate,
  type InstallmentStatus,
} from "@/modules/portfolio/installment-status";
import { isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";

/**
 * Lecturas del Cobrador (02 §8: solo su cartera, su caja y sus eventos). Todas parten de su propio registro
 * de cobrador (sesión → usuario → cobrador activo) y de sus asignaciones **activas**: un cliente que le
 * reasignaron a otro deja de existir para él (ADR 0009).
 */

type Db = Pick<Pool, "query">;

type CollectorRow = { id: string; name: string; business_id: string; time_zone: string };

async function loadCollector(db: Db, actor: SessionContext): Promise<CollectorRow | null> {
  authorizeSession(actor, { roles: ["COBRADOR"] });
  if (!actor.businessId)
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  const { rows } = await db.query<CollectorRow>(
    `select c.id, c.name, c.business_id, b.time_zone
       from public.collectors c join public.businesses b on b.id = c.business_id
      where c.user_id = $1 and c.business_id = $2 and c.status = 'ACTIVO'`,
    [actor.userId, actor.businessId],
  );
  return rows[0] ?? null;
}

export type CollectorSessionView = {
  id: string;
  status: "ABIERTA" | "PENDIENTE_LIQUIDACION";
  fund: number;
  collected: number;
  spent: number;
  /** Fondo + cobros − gastos: lo que debes tener en la mano (derivado). */
  expected: number;
  declaredAmount: number | null;
};

export type PortfolioClient = {
  id: string;
  name: string;
  nickname: string | null;
  phone: string | null;
  whatsapp: string | null;
  address: string | null;
  /** Saldo de cuotas vencidas (antes de hoy). */
  overdue: number;
  dueToday: number;
  totalPending: number;
  maxDaysLate: number;
  oldestDue: IsoDate | null;
};

export type CollectorHome = {
  collectorName: string;
  today: IsoDate;
  session: CollectorSessionView | null;
  /** Meta diaria: cuotas vencidas o que vencen hoy de su cartera (02 §7). */
  dailyGoal: number;
  clients: PortfolioClient[];
};

export async function getCollectorHome(
  db: Db,
  actor: SessionContext,
  now: Date = new Date(),
): Promise<CollectorHome | null> {
  const collector = await loadCollector(db, actor);
  if (!collector) return null;
  const today = localDateIn(now, collector.time_zone);

  const sessionRows = await db.query<{
    id: string;
    status: "ABIERTA" | "PENDIENTE_LIQUIDACION";
    fund: string;
    collected: string;
    spent: string;
    expected: string;
    declared_amount: string | null;
  }>(
    `select s.id, s.status,
            coalesce(sum(m.amount) filter (where m.type = 'FONDO_OPERATIVO'), 0)::text as fund,
            (coalesce(sum(m.amount) filter (where m.type = 'COBRO'), 0)
             - coalesce(sum(m.amount) filter (where m.type = 'REVERSO' and m.direction = 'SALIDA'
                          and exists (select 1 from public.cash_movements o
                                       where o.id = m.reverses_movement_id and o.type = 'COBRO')), 0))::text as collected,
            (coalesce(sum(m.amount) filter (where m.type = 'GASTO_COBRADOR'), 0)
             - coalesce(sum(m.amount) filter (where m.type = 'REVERSO' and m.direction = 'ENTRADA'
                          and exists (select 1 from public.cash_movements o
                                       where o.id = m.reverses_movement_id and o.type = 'GASTO_COBRADOR')), 0))::text as spent,
            coalesce(sum(case when m.direction = 'ENTRADA' then m.amount else -m.amount end), 0)::text as expected,
            (select st.declared_amount::text from public.settlements st where st.session_id = s.id) as declared_amount
       from public.cash_sessions s
       left join public.cash_movements m on m.session_id = s.id
      where s.collector_id = $1 and s.status in ('ABIERTA', 'PENDIENTE_LIQUIDACION')
      group by s.id`,
    [collector.id],
  );
  const s = sessionRows.rows[0];
  const session: CollectorSessionView | null = s
    ? {
        id: s.id,
        status: s.status,
        fund: Number(s.fund),
        collected: Number(s.collected),
        spent: Number(s.spent),
        expected: Number(s.expected),
        declaredAmount: s.declared_amount === null ? null : Number(s.declared_amount),
      }
    : null;

  const rows = await db.query<{
    id: string;
    name: string;
    nickname: string | null;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
    overdue: string;
    due_today: string;
    total_pending: string;
    max_days_late: number | null;
    oldest_due: string | null;
  }>(
    `select cl.id, cl.name, cl.nickname, cl.phone, cl.whatsapp, cl.address,
            coalesce(sum(p.pending) filter (where i.due_on < $2::date), 0)::text as overdue,
            coalesce(sum(p.pending) filter (where i.due_on = $2::date), 0)::text as due_today,
            coalesce(sum(p.pending), 0)::text as total_pending,
            max($2::date - i.due_on) filter (where p.pending > 0 and i.due_on < $2::date) as max_days_late,
            (min(i.due_on) filter (where p.pending > 0))::text as oldest_due
       from public.client_assignments a
       join public.clients cl on cl.id = a.client_id
       left join public.contracts k on k.client_id = cl.id
       left join public.loans l on l.contract_id = k.id and l.status = 'ACTIVO'
       left join public.installments i on i.loan_id = l.id
       left join lateral (select i.amount - private.installment_applied(i.id) as pending) p on i.id is not null
      where a.collector_id = $1 and a.business_id = $3 and a.status = 'ACTIVA' and cl.business_id = $3
      group by cl.id`,
    [collector.id, today, collector.business_id],
  );
  const clients: PortfolioClient[] = rows.rows
    .map((row) => ({
      id: row.id,
      name: row.name,
      nickname: row.nickname,
      phone: row.phone,
      whatsapp: row.whatsapp,
      address: row.address,
      overdue: Number(row.overdue),
      dueToday: Number(row.due_today),
      totalPending: Number(row.total_pending),
      maxDaysLate: row.max_days_late ?? 0,
      oldestDue: row.oldest_due ? isoDate(row.oldest_due) : null,
    }))
    // Prioridad (02 §7): más mora, más saldo vencido, vencimiento más antiguo.
    .sort(
      (a, b) =>
        b.maxDaysLate - a.maxDaysLate ||
        b.overdue - a.overdue ||
        (a.oldestDue ?? "9999").localeCompare(b.oldestDue ?? "9999") ||
        a.name.localeCompare(b.name),
    );

  return {
    collectorName: collector.name,
    today,
    session,
    dailyGoal: clients.reduce((sum, client) => sum + client.overdue + client.dueToday, 0),
    clients,
  };
}

export type CollectorClientInstallment = {
  number: number;
  dueOn: IsoDate;
  amount: number;
  appliedAmount: number;
  pendingAmount: number;
  status: InstallmentStatus;
  daysLate: number;
};

export type CollectorClientLoan = {
  loanId: string;
  contractNumber: string;
  pendingBalance: number;
  installments: CollectorClientInstallment[];
  lateFees: { id: string; reason: string; pendingAmount: number }[];
};

export type CollectorClientDetail = {
  client: Omit<
    PortfolioClient,
    "overdue" | "dueToday" | "totalPending" | "maxDaysLate" | "oldestDue"
  >;
  loans: CollectorClientLoan[];
  attempts: {
    id: string;
    type: "INTENTO_FALLIDO" | "VOLVER_A_COBRAR";
    reason: string | null;
    note: string | null;
    retryAt: Date | null;
    createdAt: Date;
  }[];
  /** Jornada abierta o pendiente de liquidación del cobrador, si la hay. */
  sessionStatus: "ABIERTA" | "PENDIENTE_LIQUIDACION" | null;
};

/** El cliente solo si está asignado ahora al cobrador; si no, `null` («no encontrado»). */
export async function getCollectorClient(
  db: Db,
  actor: SessionContext,
  clientId: string,
  now: Date = new Date(),
): Promise<CollectorClientDetail | null> {
  const collector = await loadCollector(db, actor);
  if (!collector) return null;
  const today = localDateIn(now, collector.time_zone);

  const found = await db.query<{
    id: string;
    name: string;
    nickname: string | null;
    phone: string | null;
    whatsapp: string | null;
    address: string | null;
  }>(
    `select cl.id, cl.name, cl.nickname, cl.phone, cl.whatsapp, cl.address
       from public.client_assignments a join public.clients cl on cl.id = a.client_id
      where a.client_id = $1 and a.collector_id = $2 and a.business_id = $3 and a.status = 'ACTIVA'`,
    [clientId, collector.id, collector.business_id],
  );
  const client = found.rows[0];
  if (!client) return null;

  const loanRows = await db.query<{ loan_id: string; contract_number: string }>(
    `select l.id as loan_id, k.number as contract_number
       from public.loans l join public.contracts k on k.id = l.contract_id
      where k.client_id = $1 and l.business_id = $2 and l.status = 'ACTIVO'
      order by l.created_at, l.id`,
    [clientId, collector.business_id],
  );
  const loans: CollectorClientLoan[] = [];
  for (const loan of loanRows.rows) {
    const installments = await db.query<{
      number: number;
      due_on: string;
      amount: string;
      applied: string;
    }>(
      `select i.number, i.due_on::text, i.amount::text, private.installment_applied(i.id)::text as applied
         from public.installments i where i.loan_id = $1 order by i.number`,
      [loan.loan_id],
    );
    const views = installments.rows.map((row) => {
      const dueOn = isoDate(row.due_on);
      const amount = Number(row.amount);
      const appliedAmount = Number(row.applied);
      const pendingAmount = amount - appliedAmount;
      return {
        number: row.number,
        dueOn,
        amount,
        appliedAmount,
        pendingAmount,
        status: deriveInstallmentStatus({ dueOn, pendingAmount, appliedAmount }, today),
        daysLate: pendingAmount > 0 ? daysLate(dueOn, today) : 0,
      };
    });
    const fees = await db.query<{ id: string; reason: string; pending: string }>(
      `select c.id, c.reason, (c.amount - private.charge_applied(c.id))::text as pending
         from public.late_fee_charges c
        where c.loan_id = $1 and not exists (select 1 from public.late_fee_voids v where v.charge_id = c.id)
        order by c.created_at, c.id`,
      [loan.loan_id],
    );
    loans.push({
      loanId: loan.loan_id,
      contractNumber: loan.contract_number,
      pendingBalance: views.reduce((sum, item) => sum + item.pendingAmount, 0),
      installments: views,
      lateFees: fees.rows
        .filter((fee) => Number(fee.pending) > 0)
        .map((fee) => ({ id: fee.id, reason: fee.reason, pendingAmount: Number(fee.pending) })),
    });
  }

  const attempts = await db.query<{
    id: string;
    type: "INTENTO_FALLIDO" | "VOLVER_A_COBRAR";
    reason: string | null;
    note: string | null;
    retry_at: Date | null;
    created_at: Date;
  }>(
    `select id, type, reason, note, retry_at, created_at from public.collection_attempts
      where client_id = $1 and collector_id = $2 order by created_at desc, id limit 10`,
    [clientId, collector.id],
  );
  const open = await db.query<{ status: "ABIERTA" | "PENDIENTE_LIQUIDACION" }>(
    "select status from public.cash_sessions where collector_id = $1 and status in ('ABIERTA', 'PENDIENTE_LIQUIDACION')",
    [collector.id],
  );

  return {
    client,
    loans,
    attempts: attempts.rows.map((row) => ({
      id: row.id,
      type: row.type,
      reason: row.reason,
      note: row.note,
      retryAt: row.retry_at,
      createdAt: row.created_at,
    })),
    sessionStatus: open.rows[0]?.status ?? null,
  };
}
