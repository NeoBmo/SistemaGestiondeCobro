import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction } from "@/shared/database/with-transaction";
import { localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import type { CreateRouteInput } from "./validation";

/**
 * Rutas (02 §4.2): lista nombrada de clientes de un cobrador, a lo sumo una `ACTIVA` por cobrador. No son
 * comandos financieros: una transacción y su auditoría. Cerrar una ruta exige que no queden clientes
 * asignados (se reasignan antes; la asignación nunca borra historia).
 */

export type RouteDeps = { db: Pick<Pool, "connect" | "query">; now?: () => Date };

export type CreatedRoute = { routeId: string; collectorId: string; name: string };

const isUnique = (error: unknown, constraint: string) =>
  (error as { code?: string; constraint?: string } | null)?.code === "23505" &&
  (error as { constraint?: string }).constraint === constraint;

export async function createRoute(
  deps: RouteDeps,
  actor: SessionContext,
  input: CreateRouteInput,
): Promise<CreatedRoute> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "RutaCreada");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const collector = await tx.query<{ status: string; time_zone: string }>(
        `select c.status, b.time_zone from public.collectors c join public.businesses b on b.id = c.business_id
          where c.id = $1 and c.business_id = $2 for update of c`,
        [input.collectorId, businessId],
      );
      const found = collector.rows[0];
      if (!found) throw new AppError("COLLECTOR_NOT_FOUND", "El cobrador no existe", 404);
      if (found.status !== "ACTIVO") {
        throw new AppError(
          "COLLECTOR_INACTIVE",
          "El cobrador está inactivo: reactívalo para crearle una ruta",
          409,
        );
      }
      const startedOn = localDateIn((deps.now ?? (() => new Date()))(), found.time_zone);
      const route = await tx.query<{ id: string }>(
        `insert into public.routes (business_id, collector_id, name, started_on, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [businessId, input.collectorId, input.name, startedOn, actor.userId],
      );
      const routeId = route.rows[0]!.id;
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "RutaCreada",
        entityType: "route",
        entityId: routeId,
        summary: { name: input.name, collectorId: input.collectorId, startedOn },
      });
      return { routeId, collectorId: input.collectorId, name: input.name };
    }, deps.db);
  } catch (error) {
    if (isUnique(error, "routes_one_active_per_collector")) {
      throw new AppError(
        "COLLECTOR_HAS_ACTIVE_ROUTE",
        "El cobrador ya tiene una ruta activa: ciérrala para crear otra",
        409,
      );
    }
    throw translateLockTimeout(error);
  }
}

export async function closeRoute(
  deps: RouteDeps,
  actor: SessionContext,
  routeId: string,
): Promise<{ routeId: string }> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "RutaCerrada");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const route = await tx.query<{ status: string; name: string; collector_id: string }>(
        "select status, name, collector_id from public.routes where id = $1 and business_id = $2 for update",
        [routeId, businessId],
      );
      const found = route.rows[0];
      if (!found) throw new AppError("ROUTE_NOT_FOUND", "La ruta no existe", 404);
      if (found.status !== "ACTIVA") {
        throw new AppError("ROUTE_ALREADY_CLOSED", "La ruta ya está cerrada", 409);
      }
      const clients = await tx.query(
        "select 1 from public.client_assignments where route_id = $1 and status = 'ACTIVA' limit 1",
        [routeId],
      );
      if ((clients.rowCount ?? 0) > 0) {
        throw new AppError(
          "ROUTE_HAS_CLIENTS",
          "La ruta aún tiene clientes asignados: reasígnalos antes de cerrarla",
          409,
        );
      }
      await tx.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [routeId],
      );
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "RutaCerrada",
        entityType: "route",
        entityId: routeId,
        summary: { name: found.name, collectorId: found.collector_id },
      });
      return { routeId };
    }, deps.db);
  } catch (error) {
    throw translateLockTimeout(error);
  }
}
