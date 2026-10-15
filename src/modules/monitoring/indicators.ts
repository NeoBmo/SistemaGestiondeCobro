import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { countOpenTickets, type OpenTicketCounts } from "@/modules/support/queries";
import {
  deriveSubscriptionStatus,
  type SubscriptionStatus,
} from "@/modules/subscriptions/subscription-status";
import { isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { getBackupStatus, type BackupStatus } from "./backups";

/**
 * Indicadores del Super Admin (ADR 0011): disponibilidad y latencia, errores, último backup, tickets abiertos
 * por prioridad y negocios con suscripción por vencer o vencida. Todo es de lectura. Las alertas de
 * suscripción **no** suspenden nada: la única compuerta de acceso es `businesses.access_status` (ADR 0003).
 */

/** Sin chequeos durante más de este tiempo se considera una interrupción del monitoreo. */
export const STALE_AFTER_MINUTES = 15;

type Db = Pick<Pool, "query">;

export type AvailabilityWindow = {
  checks: number;
  /** Porcentaje de chequeos correctos; `null` si no hubo chequeos. */
  availability: number | null;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type PlatformIndicators = {
  now: Date;
  last24h: AvailabilityWindow;
  last7d: AvailabilityWindow;
  lastCheckAt: Date | null;
  /** Minutos desde el último chequeo; `null` si nunca hubo. */
  minutesSinceLastCheck: number | null;
  /** `true` si no hay chequeos recientes: la base o el monitoreo no responden. */
  stale: boolean;
  /** Chequeos fallidos de las últimas 24 h, los más recientes primero. */
  interruptions: { checkedAt: Date; databaseOk: boolean; authOk: boolean; latencyMs: number }[];
  errors24h: number;
  recentErrors: { id: string; route: string; errorName: string | null; occurredAt: Date }[];
  backup: BackupStatus;
  tickets: OpenTicketCounts;
  subscriptions: {
    businessId: string;
    businessName: string;
    status: Extract<SubscriptionStatus, "PROXIMA_A_VENCER" | "VENCIDA">;
    expiresOn: IsoDate;
    accessStatus: "ACTIVO" | "SUSPENDIDO";
  }[];
};

async function window(db: Db, now: Date, hours: number): Promise<AvailabilityWindow> {
  const { rows } = await db.query<{
    checks: string;
    ok: string;
    average: string | null;
    p95: number | null;
  }>(
    `select count(*)::text as checks, count(*) filter (where ok)::text as ok,
            avg(latency_ms)::text as average,
            percentile_cont(0.95) within group (order by latency_ms) as p95
       from public.health_checks
      where checked_at > $1::timestamptz - make_interval(hours => $2) and checked_at <= $1::timestamptz`,
    [now.toISOString(), hours],
  );
  const row = rows[0]!;
  const checks = Number(row.checks);
  return {
    checks,
    // Se trunca (no se redondea): 99,95 % no debe mostrarse como 100 % si hubo un chequeo fallido.
    availability: checks === 0 ? null : Math.floor((Number(row.ok) / checks) * 1000) / 10,
    averageLatencyMs: row.average === null ? null : Math.round(Number(row.average)),
    p95LatencyMs: row.p95 === null ? null : Math.round(row.p95),
  };
}

export async function getPlatformIndicators(
  db: Db,
  actor: SessionContext,
  now: Date = new Date(),
): Promise<PlatformIndicators> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  const at = now.toISOString();

  const [last24h, last7d, lastCheck, failed, errors, recent, backup, tickets, subscriptions] =
    await Promise.all([
      window(db, now, 24),
      window(db, now, 24 * 7),
      db.query<{ checked_at: Date | null }>(
        "select max(checked_at) as checked_at from public.health_checks where checked_at <= $1::timestamptz",
        [at],
      ),
      db.query<{ checked_at: Date; database_ok: boolean; auth_ok: boolean; latency_ms: number }>(
        `select checked_at, database_ok, auth_ok, latency_ms from public.health_checks
          where not ok and checked_at > $1::timestamptz - interval '24 hours' and checked_at <= $1::timestamptz
          order by checked_at desc limit 20`,
        [at],
      ),
      db.query<{ n: string }>(
        `select count(*)::text as n from public.platform_events
          where occurred_at > $1::timestamptz - interval '24 hours' and occurred_at <= $1::timestamptz`,
        [at],
      ),
      db.query<{ id: string; route: string; error_name: string | null; occurred_at: Date }>(
        `select id, route, error_name, occurred_at from public.platform_events
          where occurred_at <= $1::timestamptz order by occurred_at desc limit 10`,
        [at],
      ),
      getBackupStatus(db, now),
      countOpenTickets(db, actor),
      db.query<{
        business_id: string;
        name: string;
        status: "ACTIVA" | "SUSPENDIDA" | "ARCHIVADA";
        expires_on: string;
        time_zone: string;
        access_status: "ACTIVO" | "SUSPENDIDO";
      }>(
        `select b.id as business_id, b.name, s.status, s.expires_on::text, b.time_zone, b.access_status
           from public.subscriptions s join public.businesses b on b.id = s.business_id
          where s.status = 'ACTIVA' order by s.expires_on, b.name`,
      ),
    ]);

  const lastCheckAt = lastCheck.rows[0]!.checked_at;
  const minutes = lastCheckAt ? Math.floor((now.getTime() - lastCheckAt.getTime()) / 60_000) : null;

  const expiring: PlatformIndicators["subscriptions"] = [];
  for (const row of subscriptions.rows) {
    const today = localDateIn(now, row.time_zone);
    const status = deriveSubscriptionStatus(
      { status: row.status, expiresOn: isoDate(row.expires_on) },
      today,
    );
    if (status === "PROXIMA_A_VENCER" || status === "VENCIDA") {
      expiring.push({
        businessId: row.business_id,
        businessName: row.name,
        status,
        expiresOn: isoDate(row.expires_on),
        accessStatus: row.access_status,
      });
    }
  }

  return {
    now,
    last24h,
    last7d,
    lastCheckAt,
    minutesSinceLastCheck: minutes,
    stale: minutes === null || minutes > STALE_AFTER_MINUTES,
    interruptions: failed.rows.map((row) => ({
      checkedAt: row.checked_at,
      databaseOk: row.database_ok,
      authOk: row.auth_ok,
      latencyMs: row.latency_ms,
    })),
    errors24h: Number(errors.rows[0]!.n),
    recentErrors: recent.rows.map((row) => ({
      id: row.id,
      route: row.route,
      errorName: row.error_name,
      occurredAt: row.occurred_at,
    })),
    backup,
    tickets,
    subscriptions: expiring,
  };
}
