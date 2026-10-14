import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import { setLockTimeout } from "@/shared/database/lock-timeout";
import { translateCollectorError } from "./collectors";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { AssignClientInput } from "./validation";

/**
 * Asignación de clientes a rutas (02 §4.3). Un cliente tiene a lo sumo una asignación `ACTIVA`: asignar a
 * un cliente que ya tiene una la **reasigna** (cierra la anterior y crea una nueva, sin borrar historia).
 * No modifica contrato ni préstamo. No es un comando financiero: una transacción y su auditoría.
 */

export type AssignmentDeps = { db: Pick<Pool, "connect" | "query"> };

export type AssignedClient = {
  assignmentId: string;
  clientId: string;
  routeId: string;
  collectorId: string;
  reassigned: boolean;
};

export async function assignClient(
  deps: AssignmentDeps,
  actor: SessionContext,
  input: AssignClientInput,
): Promise<AssignedClient> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "ClienteAsignado");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      // El cliente bloquea el par (cliente, asignación activa): dos reasignaciones simultáneas se serializan.
      const client = await tx.query<{ name: string }>(
        "select name from public.clients where id = $1 and business_id = $2 for update",
        [input.clientId, businessId],
      );
      if (!client.rows[0]) throw new AppError("CLIENT_NOT_FOUND", "El cliente no existe", 404);

      const route = await tx.query<{ collector_id: string; status: string; name: string }>(
        `select r.collector_id, r.status, r.name from public.routes r
          where r.id = $1 and r.business_id = $2 for share`,
        [input.routeId, businessId],
      );
      const target = route.rows[0];
      if (!target) throw new AppError("ROUTE_NOT_FOUND", "La ruta no existe", 404);
      if (target.status !== "ACTIVA") {
        throw new AppError("ROUTE_CLOSED", "La ruta está cerrada: elige una ruta activa", 409);
      }

      const current = await tx.query<{ id: string; route_id: string; collector_id: string }>(
        `select id, route_id, collector_id from public.client_assignments
          where client_id = $1 and status = 'ACTIVA' for update`,
        [input.clientId],
      );
      const previous = current.rows[0];
      if (previous?.route_id === input.routeId) {
        throw new AppError("CLIENT_ALREADY_ASSIGNED", "El cliente ya está en esa ruta", 409);
      }
      if (previous) {
        await tx.query(
          "update public.client_assignments set status = 'CERRADA', ended_at = now() where id = $1",
          [previous.id],
        );
      }
      const created = await tx.query<{ id: string }>(
        `insert into public.client_assignments (business_id, client_id, route_id, collector_id, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [businessId, input.clientId, input.routeId, target.collector_id, actor.userId],
      );
      const assignmentId = created.rows[0]!.id;
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: previous ? "ClienteReasignado" : "ClienteAsignado",
        entityType: "client_assignment",
        entityId: assignmentId,
        summary: {
          clientId: input.clientId,
          routeId: input.routeId,
          collectorId: target.collector_id,
          ...(previous
            ? { fromRouteId: previous.route_id, fromCollectorId: previous.collector_id }
            : {}),
        },
      });
      return {
        assignmentId,
        clientId: input.clientId,
        routeId: input.routeId,
        collectorId: target.collector_id,
        reassigned: Boolean(previous),
      };
    }, deps.db);
  } catch (error) {
    if (
      (error as { code?: string; constraint?: string } | null)?.code === "23505" &&
      (error as { constraint?: string }).constraint === "client_assignments_one_active_per_client"
    ) {
      throw new AppError(
        "OPERATION_IN_PROGRESS",
        "Otra operación asignó a este cliente al mismo tiempo. Intenta de nuevo",
        409,
      );
    }
    throw translateCollectorError(error);
  }
}
