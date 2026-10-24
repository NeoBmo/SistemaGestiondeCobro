import type { Pool } from "pg";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";

/**
 * Lecturas del Admin sobre cobradores, rutas, asignaciones y jornadas. Todas se filtran por el negocio de la
 * sesión (regla 1); el saldo esperado de una jornada se deriva de sus movimientos, nunca se guarda.
 */

type Db = Pick<Pool, "query">;

function businessOf(actor: SessionContext): string {
  authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  if (!actor.businessId)
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  return actor.businessId;
}

export type CollectorListItem = {
  id: string;
  name: string;
  username: string;
  status: "ACTIVO" | "INACTIVO";
  activeRoute: { id: string; name: string } | null;
  clientCount: number;
  session: { id: string; status: "ABIERTA" | "PENDIENTE_LIQUIDACION" } | null;
};

export async function listCollectors(db: Db, actor: SessionContext): Promise<CollectorListItem[]> {
  const businessId = businessOf(actor);
  const { rows } = await db.query<{
    id: string;
    name: string;
    username: string;
    status: "ACTIVO" | "INACTIVO";
    route_id: string | null;
    route_name: string | null;
    client_count: string;
    session_id: string | null;
    session_status: "ABIERTA" | "PENDIENTE_LIQUIDACION" | null;
  }>(
    `select c.id, c.name, p.username, c.status,
            r.id as route_id, r.name as route_name,
            (select count(*) from public.client_assignments a
              where a.collector_id = c.id and a.status = 'ACTIVA')::text as client_count,
            s.id as session_id, s.status as session_status
       from public.collectors c
       join public.profiles p on p.id = c.user_id
       left join public.routes r on r.collector_id = c.id and r.status = 'ACTIVA'
       left join public.cash_sessions s
              on s.collector_id = c.id and s.status in ('ABIERTA', 'PENDIENTE_LIQUIDACION')
      where c.business_id = $1
      order by (c.status = 'ACTIVO') desc, lower(c.name), c.id`,
    [businessId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    username: row.username,
    status: row.status,
    activeRoute: row.route_id ? { id: row.route_id, name: row.route_name! } : null,
    clientCount: Number(row.client_count),
    session: row.session_id ? { id: row.session_id, status: row.session_status! } : null,
  }));
}

export type RouteListItem = {
  id: string;
  name: string;
  status: "ACTIVA" | "CERRADA";
  startedOn: string;
  closedAt: Date | null;
  collector: { id: string; name: string };
  clientCount: number;
};

export async function listRoutes(db: Db, actor: SessionContext): Promise<RouteListItem[]> {
  const businessId = businessOf(actor);
  const { rows } = await db.query<{
    id: string;
    name: string;
    status: "ACTIVA" | "CERRADA";
    started_on: string;
    closed_at: Date | null;
    collector_id: string;
    collector_name: string;
    client_count: string;
  }>(
    `select r.id, r.name, r.status, r.started_on::text, r.closed_at, c.id as collector_id,
            c.name as collector_name,
            (select count(*) from public.client_assignments a
              where a.route_id = r.id and a.status = 'ACTIVA')::text as client_count
       from public.routes r join public.collectors c on c.id = r.collector_id
      where r.business_id = $1
      order by (r.status = 'ACTIVA') desc, r.created_at desc, r.id`,
    [businessId],
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    status: row.status,
    startedOn: row.started_on,
    closedAt: row.closed_at,
    collector: { id: row.collector_id, name: row.collector_name },
    clientCount: Number(row.client_count),
  }));
}

export type RouteClient = { id: string; name: string; identification: string; assignedAt: Date };

export type RouteDetail = RouteListItem & { clients: RouteClient[] };

export async function getRouteDetail(
  db: Db,
  actor: SessionContext,
  routeId: string,
): Promise<RouteDetail | null> {
  const businessId = businessOf(actor);
  const route = (await listRoutes(db, actor)).find((item) => item.id === routeId);
  if (!route) return null;
  const { rows } = await db.query<{
    id: string;
    name: string;
    identification: string;
    started_at: Date;
  }>(
    `select cl.id, cl.name, cl.identification, a.started_at
       from public.client_assignments a join public.clients cl on cl.id = a.client_id
      where a.route_id = $1 and a.business_id = $2 and a.status = 'ACTIVA'
      order by lower(cl.name), cl.id`,
    [routeId, businessId],
  );
  return {
    ...route,
    clients: rows.map((row) => ({
      id: row.id,
      name: row.name,
      identification: row.identification,
      assignedAt: row.started_at,
    })),
  };
}

export type ActiveRouteOption = { id: string; name: string; collectorName: string };

/** Rutas activas de cobradores activos: los destinos posibles de una asignación. */
export async function listAssignableRoutes(
  db: Db,
  actor: SessionContext,
): Promise<ActiveRouteOption[]> {
  const businessId = businessOf(actor);
  const { rows } = await db.query<{ id: string; name: string; collector_name: string }>(
    `select r.id, r.name, c.name as collector_name
       from public.routes r join public.collectors c on c.id = r.collector_id
      where r.business_id = $1 and r.status = 'ACTIVA' and c.status = 'ACTIVO'
      order by lower(c.name), lower(r.name)`,
    [businessId],
  );
  return rows.map((row) => ({ id: row.id, name: row.name, collectorName: row.collector_name }));
}

export type ClientAssignmentView = {
  routeId: string;
  routeName: string;
  collectorName: string;
  since: Date;
} | null;

export async function getClientAssignment(
  db: Db,
  actor: SessionContext,
  clientId: string,
): Promise<ClientAssignmentView> {
  const businessId = businessOf(actor);
  const { rows } = await db.query<{
    route_id: string;
    route_name: string;
    collector_name: string;
    started_at: Date;
  }>(
    `select r.id as route_id, r.name as route_name, c.name as collector_name, a.started_at
       from public.client_assignments a
       join public.routes r on r.id = a.route_id
       join public.collectors c on c.id = a.collector_id
      where a.client_id = $1 and a.business_id = $2 and a.status = 'ACTIVA'`,
    [clientId, businessId],
  );
  const row = rows[0];
  return row
    ? {
        routeId: row.route_id,
        routeName: row.route_name,
        collectorName: row.collector_name,
        since: row.started_at,
      }
    : null;
}

export type SessionListItem = {
  id: string;
  collector: { id: string; name: string };
  status: "ABIERTA" | "PENDIENTE_LIQUIDACION" | "LIQUIDADA" | "LIQUIDADA_CON_DIFERENCIA";
  businessDate: string;
  openedAt: Date;
  fund: number;
  collected: number;
  spent: number;
  /** Fondo + cobros − gastos (con reversos): lo que el cobrador debe tener en la mano. */
  expected: number;
  settlement: {
    id: string;
    status: "PENDIENTE_REVISION" | "CUADRADA" | "CON_DIFERENCIA";
    declaredAmount: number;
    receivedAmount: number | null;
    difference: number | null;
    observation: string | null;
    resolved: boolean;
    /** Cómo se resolvió la diferencia: reposición con un ajuste o asumida por el negocio (02 §5.5). */
    resolution: "REPOSICION" | "ASUMIDA" | null;
  } | null;
};

const SESSION_PAGE = 40;

/** Jornadas del negocio: las abiertas y pendientes primero, luego las más recientes. */
export async function listSessions(db: Db, actor: SessionContext): Promise<SessionListItem[]> {
  const businessId = businessOf(actor);
  const { rows } = await db.query<{
    id: string;
    collector_id: string;
    collector_name: string;
    status: SessionListItem["status"];
    business_date: string;
    opened_at: Date;
    fund: string;
    collected: string;
    spent: string;
    expected: string;
    settlement_id: string | null;
    settlement_status: "PENDIENTE_REVISION" | "CUADRADA" | "CON_DIFERENCIA" | null;
    declared_amount: string | null;
    received_amount: string | null;
    difference: string | null;
    observation: string | null;
    resolution: "REPOSICION" | "ASUMIDA" | null;
  }>(
    `select s.id, c.id as collector_id, c.name as collector_name, s.status, s.business_date::text,
            s.opened_at,
            coalesce(sum(m.amount) filter (where m.type = 'FONDO_OPERATIVO'), 0)::text as fund,
            (coalesce(sum(m.amount) filter (where m.type = 'COBRO'), 0)
             - coalesce(sum(m.amount) filter (where m.type = 'REVERSO' and m.direction = 'SALIDA'
                          and exists (select 1 from public.cash_movements o
                                       where o.id = m.reverses_movement_id and o.type = 'COBRO')), 0))::text as collected,
            (coalesce(sum(m.amount) filter (where m.type = 'GASTO_COBRADOR'), 0)
             - coalesce(sum(m.amount) filter (where m.type = 'REVERSO' and m.direction = 'ENTRADA'
                          and exists (select 1 from public.cash_movements o
                                       where o.id = m.reverses_movement_id and o.type = 'GASTO_COBRADOR')), 0))::text as spent,
            coalesce(sum(case when m.type in ('LIQUIDACION', 'DIFERENCIA_CAJA') then 0
                              when m.direction = 'ENTRADA' then m.amount else -m.amount end), 0)::text as expected,
            st.id as settlement_id, st.status as settlement_status, st.declared_amount::text,
            st.received_amount::text, st.difference::text, st.observation,
            (select r.kind from public.settlement_resolutions r where r.settlement_id = st.id) as resolution
       from public.cash_sessions s
       join public.collectors c on c.id = s.collector_id
       left join public.cash_movements m on m.session_id = s.id
       left join public.settlements st on st.session_id = s.id
      where s.business_id = $1
      group by s.id, c.id, c.name, st.id
      order by (s.status in ('ABIERTA', 'PENDIENTE_LIQUIDACION')) desc, s.opened_at desc, s.id
      limit $2`,
    [businessId, SESSION_PAGE],
  );
  return rows.map((row) => ({
    id: row.id,
    collector: { id: row.collector_id, name: row.collector_name },
    status: row.status,
    businessDate: row.business_date,
    openedAt: row.opened_at,
    fund: Number(row.fund),
    collected: Number(row.collected),
    spent: Number(row.spent),
    expected: Number(row.expected),
    settlement: row.settlement_id
      ? {
          id: row.settlement_id,
          status: row.settlement_status!,
          declaredAmount: Number(row.declared_amount),
          receivedAmount: row.received_amount === null ? null : Number(row.received_amount),
          difference: row.difference === null ? null : Number(row.difference),
          observation: row.observation,
          resolved: row.resolution !== null,
          resolution: row.resolution,
        }
      : null,
  }));
}
