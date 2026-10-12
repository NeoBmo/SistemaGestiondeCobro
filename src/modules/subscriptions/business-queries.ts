import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { isPlanCode, type PlanCode } from "./plans";
import {
  deriveSubscriptionStatus,
  type StoredSubscriptionStatus,
  type SubscriptionStatus,
} from "./subscription-status";

/**
 * Lecturas del panel del Super Admin (02-DOMINIO §1.2–1.3). Cruzan negocios a propósito: solo las
 * ejecuta un Super Admin (se vuelve a comprobar aquí, no solo en la página) y nunca devuelven secretos.
 * El estado que se muestra se deriva al leer con «hoy» en la zona horaria de cada negocio.
 */

type Db = Pick<Pool, "query">;

export const SUBSCRIPTION_STATUSES = [
  "ACTIVA",
  "PROXIMA_A_VENCER",
  "VENCIDA",
  "SUSPENDIDA",
  "ARCHIVADA",
] as const satisfies readonly SubscriptionStatus[];

export type BusinessListFilters = {
  /** Texto contenido en el nombre del negocio (sin distinguir mayúsculas). */
  search?: string;
  planCode?: PlanCode;
  /** Estado derivado: se aplica después de calcularlo, porque no se guarda. */
  status?: SubscriptionStatus;
};

const SEARCH_MAX_LENGTH = 120;

type RawParams = Record<string, string | string[] | undefined>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** Filtros de la URL; un valor desconocido se ignora (nunca es un error: la URL la escribe el usuario). */
export function parseListFilters(params: RawParams): BusinessListFilters {
  const search = first(params.q)?.trim().slice(0, SEARCH_MAX_LENGTH);
  const plan = first(params.plan);
  const status = first(params.estado);
  return {
    ...(search ? { search } : {}),
    ...(plan && isPlanCode(plan) ? { planCode: plan } : {}),
    ...(status && (SUBSCRIPTION_STATUSES as readonly string[]).includes(status)
      ? { status: status as SubscriptionStatus }
      : {}),
  };
}

export type BusinessSummary = {
  id: string;
  name: string;
  ownerName: string;
  accessStatus: "ACTIVO" | "SUSPENDIDO";
  planCode: PlanCode;
  planName: string;
  status: SubscriptionStatus;
  expiresOn: IsoDate;
  adminUsername: string | null;
};

type SummaryRow = {
  id: string;
  name: string;
  owner_name: string;
  time_zone: string;
  access_status: "ACTIVO" | "SUSPENDIDO";
  plan_code: PlanCode;
  plan_name: string;
  status: StoredSubscriptionStatus;
  expires_on: string;
  admin_username: string | null;
};

/**
 * Negocios con su suscripción vigente (o, si solo tiene archivadas, la última). Orden: los más
 * recientes primero. Sin paginación: el volumen de V1 son decenas de negocios, no miles.
 */
export async function listBusinesses(
  db: Db,
  actor: SessionContext,
  filters: BusinessListFilters = {},
  now: Date = new Date(),
): Promise<BusinessSummary[]> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });

  const { rows } = await db.query<SummaryRow>(
    `select b.id, b.name, b.owner_name, b.time_zone, b.access_status,
            s.plan_code, p.name as plan_name, s.status, s.expires_on::text as expires_on,
            a.username as admin_username
       from public.businesses b
       cross join lateral (
         select s.plan_code, s.status, s.expires_on
           from public.subscriptions s
          where s.business_id = b.id
          order by (s.status = 'ARCHIVADA'), s.created_at desc
          limit 1
       ) s
       join public.plans p on p.code = s.plan_code
       left join lateral (
         select pr.username from public.profiles pr
          where pr.business_id = b.id and pr.role = 'ADMIN_NEGOCIO'
          order by pr.created_at limit 1
       ) a on true
      where ($1::text is null or position(lower($1::text) in lower(b.name)) > 0)
        and ($2::text is null or s.plan_code = $2::text)
      order by b.created_at desc, b.id`,
    [filters.search ?? null, filters.planCode ?? null],
  );

  const summaries = rows.map((row): BusinessSummary => {
    const expiresOn = isoDate(row.expires_on);
    return {
      id: row.id,
      name: row.name,
      ownerName: row.owner_name,
      accessStatus: row.access_status,
      planCode: row.plan_code,
      planName: row.plan_name,
      status: deriveSubscriptionStatus(
        { status: row.status, expiresOn },
        localDateIn(now, row.time_zone),
      ),
      expiresOn,
      adminUsername: row.admin_username,
    };
  });
  return filters.status ? summaries.filter((b) => b.status === filters.status) : summaries;
}

export type SubscriptionHistoryEntry = {
  id: string;
  planCode: PlanCode;
  planName: string;
  status: StoredSubscriptionStatus;
  startsOn: IsoDate;
  expiresOn: IsoDate;
  note: string | null;
  changedBy: string | null;
  createdAt: Date;
};

export type BusinessDetail = {
  id: string;
  name: string;
  ownerName: string;
  ownerIdentification: string;
  phone: string;
  timeZone: string;
  accessStatus: "ACTIVO" | "SUSPENDIDO";
  /** Estado de la suscripción vigente para la UI; `null` si el negocio está archivado. */
  currentStatus: StoredSubscriptionStatus | null;
  /** Estado mostrado: el derivado de la vigente, o ARCHIVADA. */
  status: SubscriptionStatus;
  currentPlan: PlanCode | null;
  admin: {
    username: string;
    displayName: string;
    status: "ACTIVO" | "BLOQUEADO" | "PENDIENTE_CAMBIO_CONTRASENA";
    lastSignInAt: Date | null;
  } | null;
  /** Más reciente primero; las archivadas quedan como historial. */
  subscriptions: SubscriptionHistoryEntry[];
};

type DetailRow = {
  id: string;
  name: string;
  owner_name: string;
  owner_identification: string;
  phone: string;
  time_zone: string;
  access_status: "ACTIVO" | "SUSPENDIDO";
};

type HistoryRow = {
  id: string;
  plan_code: PlanCode;
  plan_name: string;
  status: StoredSubscriptionStatus;
  starts_on: string;
  expires_on: string;
  note: string | null;
  changed_by: string | null;
  created_at: Date;
};

type AdminRow = {
  username: string;
  display_name: string;
  status: "ACTIVO" | "BLOQUEADO" | "PENDIENTE_CAMBIO_CONTRASENA";
  last_sign_in_at: Date | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Ficha de un negocio, o `null` si no existe (o el id no es un UUID). */
export async function getBusinessDetail(
  db: Db,
  actor: SessionContext,
  businessId: string,
  now: Date = new Date(),
): Promise<BusinessDetail | null> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  if (!UUID.test(businessId)) return null;

  const business = (
    await db.query<DetailRow>(
      `select id, name, owner_name, owner_identification, phone, time_zone, access_status
         from public.businesses where id = $1`,
      [businessId],
    )
  ).rows[0];
  if (!business) return null;

  const [history, admin] = await Promise.all([
    db.query<HistoryRow>(
      `select s.id, s.plan_code, p.name as plan_name, s.status, s.starts_on::text as starts_on,
              s.expires_on::text as expires_on, s.note, c.display_name as changed_by, s.created_at
         from public.subscriptions s
         join public.plans p on p.code = s.plan_code
         left join public.profiles c on c.id = s.changed_by
        where s.business_id = $1
        order by s.created_at desc, s.id`,
      [businessId],
    ),
    db.query<AdminRow>(
      `select pr.username, pr.display_name, pr.status, pr.last_sign_in_at
         from public.profiles pr
        where pr.business_id = $1 and pr.role = 'ADMIN_NEGOCIO'
        order by pr.created_at limit 1`,
      [businessId],
    ),
  ]);

  const subscriptions = history.rows.map((row): SubscriptionHistoryEntry => ({
    id: row.id,
    planCode: row.plan_code,
    planName: row.plan_name,
    status: row.status,
    startsOn: isoDate(row.starts_on),
    expiresOn: isoDate(row.expires_on),
    note: row.note,
    changedBy: row.changed_by,
    createdAt: row.created_at,
  }));
  const current = subscriptions.find((s) => s.status !== "ARCHIVADA") ?? null;
  const shown = current ?? subscriptions[0] ?? null;
  const adminRow = admin.rows[0];

  return {
    id: business.id,
    name: business.name,
    ownerName: business.owner_name,
    ownerIdentification: business.owner_identification,
    phone: business.phone,
    timeZone: business.time_zone,
    accessStatus: business.access_status,
    currentStatus: current?.status ?? null,
    currentPlan: current?.planCode ?? null,
    status: shown
      ? deriveSubscriptionStatus(
          { status: shown.status, expiresOn: shown.expiresOn },
          localDateIn(now, business.time_zone),
        )
      : "ARCHIVADA",
    admin: adminRow
      ? {
          username: adminRow.username,
          displayName: adminRow.display_name,
          status: adminRow.status,
          lastSignInAt: adminRow.last_sign_in_at,
        }
      : null,
    subscriptions,
  };
}
