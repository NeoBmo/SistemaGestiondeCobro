import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import {
  deriveSubscriptionStatus,
  type SubscriptionStatus,
} from "@/modules/subscriptions/subscription-status";
import type { PlanCode } from "@/modules/subscriptions/plans";
import { addDays, isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { money, type Money } from "@/shared/money/money";
import { periodRange, type Period } from "./periods";
import { resolveDashboardConfig, type DashboardConfig } from "./widgets";

/**
 * Lecturas del dashboard del Admin (02 §7, ADR 0010): agregados derivados de los hechos, de solo lectura.
 * Ninguna consulta escribe ni guarda un balance. Todas se filtran por el negocio de la sesión (regla 1) y
 * agrupan por la fecha local del negocio.
 */

type Db = Pick<Pool, "query">;

export type DashboardAlert =
  | { kind: "OVERDUE"; clients: number; amount: Money }
  | { kind: "PENDING_SESSIONS"; count: number }
  | { kind: "UNRESOLVED_DIFFERENCES"; count: number; amount: Money }
  | {
      kind: "SUBSCRIPTION";
      status: Extract<SubscriptionStatus, "PROXIMA_A_VENCER" | "VENCIDA">;
      expiresOn: IsoDate;
    };

export type DashboardData = {
  config: DashboardConfig;
  today: IsoDate;
  range: { from: IsoDate; to: IsoDate };
  cashBalance: Money;
  portfolio: { pending: Money; overdue: Money; clientsInArrears: number; activeLoans: number };
  collected: Money;
  spent: Money;
  sessions: { pending: number; unresolvedDifferences: number; unresolvedAmount: Money };
  /** Cuotas pendientes con vencimiento en los próximos 7 días, una fila por día (con ceros). */
  projection: { date: IsoDate; amount: Money }[];
  alerts: DashboardAlert[];
};

export const PROJECTION_DAYS = 7;

/** Lo aplicado por pagos no reversados a cada cuota (se agrega una vez, no por llamada a función). */
const APPLIED_CTE = `
  applied as (
    select a.installment_id, sum(a.amount) as amount
      from public.payment_applications a
      join public.payments p on p.id = a.payment_id
     where a.business_id = $1 and a.installment_id is not null
       and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
     group by a.installment_id
  )`;

export async function loadPlanAndSettings(db: Db, businessId: string) {
  const plan = await db.query<{
    plan_code: PlanCode;
    status: "ACTIVA" | "SUSPENDIDA" | "ARCHIVADA";
    expires_on: string;
  }>(
    `select plan_code, status, expires_on::text from public.subscriptions
      where business_id = $1 and status <> 'ARCHIVADA'`,
    [businessId],
  );
  const saved = await db.query<{ period: string; widgets: unknown }>(
    "select period, widgets from public.dashboard_settings where business_id = $1",
    [businessId],
  );
  return { subscription: plan.rows[0] ?? null, saved: saved.rows[0] ?? null };
}

export async function getDashboard(
  db: Db,
  actor: SessionContext,
  now: Date = new Date(),
): Promise<DashboardData> {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  const businessId = actor.businessId;
  if (!businessId) throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);

  const zone = await db.query<{ time_zone: string }>(
    "select time_zone from public.businesses where id = $1",
    [businessId],
  );
  const timeZone = zone.rows[0]?.time_zone;
  if (!timeZone) throw new AppError("BUSINESS_NOT_FOUND", "El negocio no existe", 404);
  const today = localDateIn(now, timeZone);

  const { subscription, saved } = await loadPlanAndSettings(db, businessId);
  const config = resolveDashboardConfig(subscription?.plan_code ?? null, saved);
  const range = periodRange(config.period, today);

  const [cash, portfolio, flows, sessions, projection] = await Promise.all([
    db.query<{ balance: string }>(
      `select coalesce(sum(case direction when 'ENTRADA' then amount else -amount end), 0)::text as balance
         from public.cash_movements where business_id = $1 and session_id is null`,
      [businessId],
    ),
    db.query<{ pending: string; overdue: string; clients: string; loans: string }>(
      `with ${APPLIED_CTE}
       select coalesce(sum(i.amount - coalesce(ap.amount, 0)), 0)::text as pending,
              coalesce(sum(i.amount - coalesce(ap.amount, 0)) filter (where i.due_on < $2::date), 0)::text as overdue,
              count(distinct k.client_id) filter (where i.due_on < $2::date)::text as clients,
              count(distinct l.id)::text as loans
         from public.installments i
         join public.loans l on l.id = i.loan_id and l.status = 'ACTIVO'
         join public.contracts k on k.id = l.contract_id
         left join applied ap on ap.installment_id = i.id
        where i.business_id = $1 and i.amount - coalesce(ap.amount, 0) > 0`,
      [businessId, today],
    ),
    db.query<{ collected: string; spent: string }>(
      `select coalesce(sum(case when m.type = 'COBRO' then m.amount else -m.amount end)
                       filter (where m.type = 'COBRO' or o.type = 'COBRO'), 0)::text as collected,
              coalesce(sum(case when m.type in ('GASTO_CAJA_MAYOR', 'GASTO_COBRADOR') then m.amount else -m.amount end)
                       filter (where m.type in ('GASTO_CAJA_MAYOR', 'GASTO_COBRADOR')
                                  or o.type in ('GASTO_CAJA_MAYOR', 'GASTO_COBRADOR')), 0)::text as spent
         from public.cash_movements m
         left join public.cash_movements o on o.id = m.reverses_movement_id
        where m.business_id = $1
          and (m.created_at at time zone $4)::date between $2::date and $3::date
          and (m.type in ('COBRO', 'GASTO_CAJA_MAYOR', 'GASTO_COBRADOR') or m.type = 'REVERSO')`,
      [businessId, range.from, range.to, timeZone],
    ),
    db.query<{ pending: string; unresolved: string; unresolved_amount: string }>(
      `select (select count(*) from public.cash_sessions s
                where s.business_id = $1 and s.status = 'PENDIENTE_LIQUIDACION')::text as pending,
              count(*) filter (where not exists (select 1 from public.settlement_resolutions r
                                                  where r.settlement_id = st.id))::text as unresolved,
              coalesce(sum(abs(st.difference)) filter (where not exists (select 1 from public.settlement_resolutions r
                                                                          where r.settlement_id = st.id)), 0)::text as unresolved_amount
         from public.settlements st
        where st.business_id = $1 and st.status = 'CON_DIFERENCIA'`,
      [businessId],
    ),
    db.query<{ due_on: string; amount: string }>(
      `with ${APPLIED_CTE}
       select i.due_on::text, sum(i.amount - coalesce(ap.amount, 0))::text as amount
         from public.installments i
         join public.loans l on l.id = i.loan_id and l.status = 'ACTIVO'
         left join applied ap on ap.installment_id = i.id
        where i.business_id = $1 and i.due_on > $2::date and i.due_on <= $3::date
          and i.amount - coalesce(ap.amount, 0) > 0
        group by i.due_on`,
      [businessId, today, addDays(today, PROJECTION_DAYS)],
    ),
  ]);

  const byDate = new Map(projection.rows.map((row) => [row.due_on, money(row.amount)]));
  const days = Array.from({ length: PROJECTION_DAYS }, (_, index) => {
    const date = addDays(today, index + 1);
    return { date, amount: byDate.get(date) ?? money(0) };
  });

  const portfolioRow = portfolio.rows[0]!;
  const flowRow = flows.rows[0]!;
  const sessionRow = sessions.rows[0]!;
  const data: DashboardData = {
    config,
    today,
    range,
    cashBalance: money(cash.rows[0]!.balance),
    portfolio: {
      pending: money(portfolioRow.pending),
      overdue: money(portfolioRow.overdue),
      clientsInArrears: Number(portfolioRow.clients),
      activeLoans: Number(portfolioRow.loans),
    },
    collected: money(flowRow.collected),
    spent: money(flowRow.spent),
    sessions: {
      pending: Number(sessionRow.pending),
      unresolvedDifferences: Number(sessionRow.unresolved),
      unresolvedAmount: money(sessionRow.unresolved_amount),
    },
    projection: days,
    alerts: [],
  };

  // Alertas: derivadas al leer, nunca guardadas (ADR 0010).
  if (data.portfolio.clientsInArrears > 0) {
    data.alerts.push({
      kind: "OVERDUE",
      clients: data.portfolio.clientsInArrears,
      amount: data.portfolio.overdue,
    });
  }
  if (data.sessions.pending > 0) {
    data.alerts.push({ kind: "PENDING_SESSIONS", count: data.sessions.pending });
  }
  if (data.sessions.unresolvedDifferences > 0) {
    data.alerts.push({
      kind: "UNRESOLVED_DIFFERENCES",
      count: data.sessions.unresolvedDifferences,
      amount: data.sessions.unresolvedAmount,
    });
  }
  if (subscription) {
    const derived = deriveSubscriptionStatus(
      { status: subscription.status, expiresOn: isoDate(subscription.expires_on) },
      today,
    );
    if (derived === "PROXIMA_A_VENCER" || derived === "VENCIDA") {
      data.alerts.push({
        kind: "SUBSCRIPTION",
        status: derived,
        expiresOn: isoDate(subscription.expires_on),
      });
    }
  }
  return data;
}
