import type { Pool } from "pg";
import { z } from "zod";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { money, type Money } from "@/shared/money/money";

/**
 * Cartera del Admin (02 §7, ADR 0010): clientes con su deuda derivada, ordenados por prioridad (más mora,
 * más saldo vencido, vencimiento más antiguo) y filtrables por cobrador, ruta, estado y texto. Solo lectura.
 */

type Db = Pick<Pool, "query">;

export const PORTFOLIO_STATUSES = ["AL_DIA", "EN_MORA", "SIN_PRESTAMO"] as const;
export type PortfolioStatus = (typeof PORTFOLIO_STATUSES)[number];

export const PORTFOLIO_STATUS_LABEL: Record<PortfolioStatus, string> = {
  AL_DIA: "Al día",
  EN_MORA: "En mora",
  SIN_PRESTAMO: "Sin préstamo activo",
};

export const PAGE_SIZE = 25;

const uuid = z.uuid();

/** Filtros de la URL: un valor inválido se ignora en vez de romper la pantalla. */
export function parsePortfolioFilters(params: Record<string, string | string[] | undefined>) {
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const collector = uuid.safeParse(first(params.cobrador));
  const route = uuid.safeParse(first(params.ruta));
  const status = z.enum(PORTFOLIO_STATUSES).safeParse(first(params.estado));
  const search = (first(params.q) ?? "").trim().slice(0, 80);
  const page = Number(first(params.pagina));
  return {
    collectorId: collector.success ? collector.data : undefined,
    routeId: route.success ? route.data : undefined,
    status: status.success ? status.data : undefined,
    search: search || undefined,
    // Tope: un número enorme daría un OFFSET inválido.
    page: Number.isInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
  };
}

export type PortfolioFilters = ReturnType<typeof parsePortfolioFilters>;

export type PortfolioRow = {
  id: string;
  name: string;
  identification: string;
  activeLoans: number;
  overdue: Money;
  totalPending: Money;
  maxDaysLate: number;
  oldestDue: IsoDate | null;
  collectorName: string | null;
  routeName: string | null;
  status: PortfolioStatus;
};

export type PortfolioPage = { rows: PortfolioRow[]; total: number; page: number; pageSize: number };

function businessOf(actor: SessionContext): string {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  if (!actor.businessId)
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  return actor.businessId;
}

const escapeLike = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

export async function listPortfolio(
  db: Db,
  actor: SessionContext,
  filters: PortfolioFilters,
  now: Date = new Date(),
): Promise<PortfolioPage> {
  const businessId = businessOf(actor);
  const zone = await db.query<{ time_zone: string }>(
    "select time_zone from public.businesses where id = $1",
    [businessId],
  );
  const today = localDateIn(now, zone.rows[0]!.time_zone);

  const { rows } = await db.query<{
    id: string;
    name: string;
    identification: string;
    loans: string;
    overdue: string;
    pending: string;
    max_days_late: number | null;
    oldest_due: string | null;
    collector_name: string | null;
    route_name: string | null;
    total: string;
  }>(
    `with applied as (
       select a.installment_id, sum(a.amount) as amount
         from public.payment_applications a
         join public.payments p on p.id = a.payment_id
        where a.business_id = $1 and a.installment_id is not null
          and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
        group by a.installment_id
     ),
     stats as (
       select cl.id, cl.name, cl.identification,
              count(distinct l.id) as loans,
              coalesce(sum(i.amount - coalesce(ap.amount, 0)) filter (where i.due_on < $2::date), 0) as overdue,
              coalesce(sum(i.amount - coalesce(ap.amount, 0)), 0) as pending,
              max($2::date - i.due_on) filter (where i.due_on < $2::date and i.amount - coalesce(ap.amount, 0) > 0) as max_days_late,
              min(i.due_on) filter (where i.amount - coalesce(ap.amount, 0) > 0) as oldest_due
         from public.clients cl
         left join public.contracts k on k.client_id = cl.id
         left join public.loans l on l.contract_id = k.id and l.status = 'ACTIVO'
         left join public.installments i on i.loan_id = l.id
         left join applied ap on ap.installment_id = i.id
        where cl.business_id = $1
          and ($6::text is null or cl.name ilike $6 or cl.identification ilike $6)
        group by cl.id
     )
     select s.id, s.name, s.identification, s.loans::text, s.overdue::text, s.pending::text,
            s.max_days_late, s.oldest_due::text, c.name as collector_name, r.name as route_name,
            count(*) over ()::text as total
       from stats s
       left join public.client_assignments a on a.client_id = s.id and a.status = 'ACTIVA'
       left join public.collectors c on c.id = a.collector_id
       left join public.routes r on r.id = a.route_id
      where ($3::uuid is null or a.collector_id = $3)
        and ($4::uuid is null or a.route_id = $4)
        and ($5::text is null
             or ($5 = 'EN_MORA' and s.overdue > 0)
             or ($5 = 'AL_DIA' and s.loans > 0 and s.overdue = 0)
             or ($5 = 'SIN_PRESTAMO' and s.loans = 0))
      order by s.max_days_late desc nulls last, s.overdue desc, s.oldest_due asc nulls last,
               lower(s.name), s.id
      limit ${PAGE_SIZE} offset $7`,
    [
      businessId,
      today,
      filters.collectorId ?? null,
      filters.routeId ?? null,
      filters.status ?? null,
      filters.search ? `%${escapeLike(filters.search)}%` : null,
      (filters.page - 1) * PAGE_SIZE,
    ],
  );

  return {
    rows: rows.map((row) => {
      const overdue = money(row.overdue);
      const loans = Number(row.loans);
      return {
        id: row.id,
        name: row.name,
        identification: row.identification,
        activeLoans: loans,
        overdue,
        totalPending: money(row.pending),
        maxDaysLate: row.max_days_late ?? 0,
        oldestDue: row.oldest_due ? isoDate(row.oldest_due) : null,
        collectorName: row.collector_name,
        routeName: row.route_name,
        status: loans === 0 ? "SIN_PRESTAMO" : overdue > 0 ? "EN_MORA" : "AL_DIA",
      };
    }),
    total: rows[0] ? Number(rows[0].total) : 0,
    page: filters.page,
    pageSize: PAGE_SIZE,
  };
}

export type ClientBehavior = {
  /** Cuotas pagadas por completo en su fecha de vencimiento o antes. */
  paidOnTime: number;
  /** Cuotas pagadas por completo después de su vencimiento. */
  paidLate: number;
  /** Cuotas con saldo y vencimiento pasado (mora actual). */
  overdueInstallments: number;
  maxDaysLate: number;
  overdue: Money;
  /** Préstamos del cliente que fueron refinanciados. */
  refinancings: number;
};

/** Historial de comportamiento sin puntaje (02 §7, ADR 0010): solo cifras derivadas de los hechos. */
export async function getClientBehavior(
  db: Db,
  actor: SessionContext,
  clientId: string,
  now: Date = new Date(),
): Promise<ClientBehavior> {
  const businessId = businessOf(actor);
  const zone = await db.query<{ time_zone: string }>(
    "select time_zone from public.businesses where id = $1",
    [businessId],
  );
  const timeZone = zone.rows[0]!.time_zone;
  const today = localDateIn(now, timeZone);

  const { rows } = await db.query<{
    on_time: string;
    late: string;
    overdue_installments: string;
    max_days_late: number | null;
    overdue: string;
    refinancings: string;
  }>(
    `with applied as (
       select a.installment_id, sum(a.amount) as amount,
              max((p.created_at at time zone $3)::date) as last_paid_on
         from public.payment_applications a
         join public.payments p on p.id = a.payment_id
        where a.business_id = $1 and a.installment_id is not null
          and not exists (select 1 from public.payment_reversals r where r.payment_id = p.id)
        group by a.installment_id
     ),
     mine as (
       select i.id, i.due_on, i.amount, coalesce(ap.amount, 0) as paid, ap.last_paid_on, l.status
         from public.contracts k
         join public.loans l on l.contract_id = k.id
         join public.installments i on i.loan_id = l.id
         left join applied ap on ap.installment_id = i.id
        where k.client_id = $2 and k.business_id = $1 and l.status <> 'ANULADO'
     )
     select count(*) filter (where paid = amount and last_paid_on <= due_on)::text as on_time,
            count(*) filter (where paid = amount and last_paid_on > due_on)::text as late,
            count(*) filter (where status = 'ACTIVO' and paid < amount and due_on < $4::date)::text as overdue_installments,
            max($4::date - due_on) filter (where status = 'ACTIVO' and paid < amount and due_on < $4::date) as max_days_late,
            coalesce(sum(amount - paid) filter (where status = 'ACTIVO' and paid < amount and due_on < $4::date), 0)::text as overdue,
            (select count(*) from public.loans l2
               join public.contracts k2 on k2.id = l2.contract_id
              where k2.client_id = $2 and k2.business_id = $1 and l2.status = 'REFINANCIADO')::text as refinancings
       from mine`,
    [businessId, clientId, timeZone, today],
  );
  const row = rows[0]!;
  return {
    paidOnTime: Number(row.on_time),
    paidLate: Number(row.late),
    overdueInstallments: Number(row.overdue_installments),
    maxDaysLate: row.max_days_late ?? 0,
    overdue: money(row.overdue),
    refinancings: Number(row.refinancings),
  };
}
