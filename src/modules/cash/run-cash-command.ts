import type { Pool } from "pg";
import { recordAuditEvent, type AuditEventInput } from "@/modules/audit/record-audit-event";
import { recordRejectedAttempt } from "@/modules/audit/record-rejection";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { payloadHash } from "@/shared/commands/canonical-json";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import type { IdempotencyKey } from "@/shared/ids/idempotency-key";

/**
 * Ejecutor de comandos financieros sobre la Caja Mayor (03-ARQUITECTURA §3, ADR 0006). Todo comando que
 * escribe dinero pasa por aquí, y aquí se resuelve lo que no debe repetirse en cada uno:
 *
 *  1. Autoriza (solo el Admin de negocio; ver 02 §8) **antes** de validar nada más. `business_id` sale de
 *     la sesión, jamás de la petición (regla 1). Un cobrador que lo intenta deja un evento `RECHAZADO`.
 *  2. Abre **una** transacción (todo o nada, regla 7) con tope de espera de bloqueos.
 *  3. Toma el bloqueo consultivo de la caja (`pg_advisory_xact_lock`): los comandos de un mismo negocio
 *     se serializan y la comprobación del saldo no compite con otra escritura.
 *  4. Idempotencia: reserva (negocio, comando, clave). Misma clave y mismo contenido → devuelve el
 *     resultado guardado sin volver a ejecutar; misma clave y contenido distinto → 409.
 *  5. Ejecuta el comando y exige al menos un evento de auditoría, que se registra en la misma transacción.
 *  6. Guarda el resultado en la clave de idempotencia.
 *
 * Si cualquier paso falla se revierte todo, incluida la reserva de la clave: reintentar con la misma
 * clave vuelve a ejecutar. El resultado debe ser JSON (importes como `number`, nunca `bigint`).
 */

export type CashCommandContext = {
  businessId: string;
  actorId: string;
  /** Caja Mayor del negocio, ya bloqueada para esta transacción. */
  cashboxId: string;
};

export type CashCommandAudit = Omit<AuditEventInput, "businessId" | "actorId" | "result">;

export type CashCommand<R> = {
  /** Nombre estable del comando: espacio de nombres de la clave de idempotencia (p. ej. `RegistrarGasto`). */
  name: string;
  actor: SessionContext;
  idempotencyKey: IdempotencyKey;
  /** Entrada ya validada; se canoniza y se hashea para detectar una clave reutilizada con otro contenido. */
  input: unknown;
  execute: (
    tx: Tx,
    context: CashCommandContext,
  ) => Promise<{ result: R; audit: CashCommandAudit[] }>;
};

export type CashCommandOutcome<R> = {
  result: R;
  /** `true` si es el resultado guardado de un envío anterior con la misma clave (no se ejecutó de nuevo). */
  replayed: boolean;
};

export type RunCashCommandDeps = { db: Pick<Pool, "connect"> };

export async function runCashCommand<R>(
  deps: RunCashCommandDeps,
  command: CashCommand<R>,
): Promise<CashCommandOutcome<R>> {
  const { actor } = command;
  const businessId = await authorizeCashCommand(deps, command);

  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);

      const box = await tx.query<{ id: string }>(
        "select id from public.main_cashboxes where business_id = $1",
        [businessId],
      );
      const cashboxId = box.rows[0]?.id;
      if (!cashboxId) {
        throw new AppError("CASHBOX_NOT_FOUND", "El negocio no tiene Caja Mayor", 500);
      }
      await tx.query("select pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `main-cashbox:${cashboxId}`,
      ]);

      const hash = payloadHash(command.input);
      const reserved = await tx.query<{ id: string }>(
        `insert into public.idempotency_keys (business_id, command, key, payload_hash)
         values ($1, $2, $3, $4)
         on conflict (business_id, command, key) do nothing
         returning id`,
        [businessId, command.name, command.idempotencyKey, hash],
      );

      if (reserved.rows[0] === undefined) {
        return replay<R>(tx, businessId, command, hash);
      }

      const { result, audit } = await command.execute(tx, {
        businessId,
        actorId: actor.userId,
        cashboxId,
      });
      if (audit.length === 0) {
        // Un comando financiero sin auditoría es un error de programación: no se guarda nada.
        throw new AppError("AUDIT_REQUIRED", "El comando no registró su evento de auditoría", 500);
      }
      if (result === null || result === undefined) {
        throw new AppError("COMMAND_RESULT_REQUIRED", "El comando no devolvió resultado", 500);
      }
      // Lo que se devuelve ahora es exactamente lo que devolverá un reenvío (viaje por JSON).
      const serialized = JSON.stringify(result);
      if (serialized === undefined) {
        throw new AppError("COMMAND_RESULT_REQUIRED", "El resultado del comando no es JSON", 500);
      }
      for (const event of audit) {
        await recordAuditEvent(tx, { ...event, businessId, actorId: actor.userId });
      }
      await tx.query("update public.idempotency_keys set result = $2::jsonb where id = $1", [
        reserved.rows[0].id,
        serialized,
      ]);
      return { result: JSON.parse(serialized) as R, replayed: false };
    }, deps.db);
  } catch (error) {
    throw translateInsufficientFunds(translateLockTimeout(error));
  }
}

/** El saldo negativo lo rechaza la base al confirmar (invariante 14): se muestra como un 409 entendible. */
function translateInsufficientFunds(error: unknown): unknown {
  const failure = error as { code?: string; constraint?: string } | null;
  if (failure?.code === "23514" && failure.constraint === "cashbox_balance_not_negative") {
    return new AppError(
      "INSUFFICIENT_FUNDS",
      "La Caja Mayor no tiene saldo suficiente para esta operación",
      409,
    );
  }
  return error;
}

async function replay<R>(
  tx: Tx,
  businessId: string,
  command: CashCommand<R>,
  hash: string,
): Promise<CashCommandOutcome<R>> {
  const existing = await tx.query<{ payload_hash: string; result: R | null }>(
    `select payload_hash, result from public.idempotency_keys
      where business_id = $1 and command = $2 and key = $3`,
    [businessId, command.name, command.idempotencyKey],
  );
  const stored = existing.rows[0];
  if (!stored || stored.payload_hash !== hash) {
    throw new AppError(
      "IDEMPOTENCY_KEY_REUSED",
      "Esta clave de idempotencia ya se usó con otro contenido. Genera una nueva para una operación distinta",
      409,
    );
  }
  if (stored.result === null) {
    // Con el bloqueo de la caja tomado antes de reservar, una reserva sin resultado no puede
    // pertenecer a una transacción viva; si ocurriera, es un estado inconsistente: no se adivina.
    throw new AppError(
      "IDEMPOTENCY_STATE_INVALID",
      "No se pudo recuperar el resultado guardado",
      500,
    );
  }
  return { result: stored.result, replayed: true };
}

/**
 * Solo el Admin de negocio, con la contraseña temporal ya cambiada. Devuelve el negocio de la sesión.
 * Un cobrador (autenticado, con negocio) que lo intenta deja un evento `RECHAZADO` sobre la caja de su
 * negocio; el Super Admin no tiene negocio ni caja y recibe el 403 sin evento (ADR 0005).
 */
async function authorizeCashCommand<R>(
  deps: RunCashCommandDeps,
  command: CashCommand<R>,
): Promise<string> {
  const { actor } = command;
  try {
    authorizeSession(actor, { roles: ["ADMIN_NEGOCIO"] });
  } catch (error) {
    if (actor.businessId && (error as { code?: string }).code === "FORBIDDEN") {
      const businessId = actor.businessId;
      await recordRejectedAttempt(
        deps.db,
        {
          actor,
          businessId,
          // Aquí la acción rechazada es el nombre del comando (no el evento que habría generado).
          action: command.name,
          entityType: "business",
          entityId: businessId,
        },
        async () => true,
      );
    }
    throw error;
  }
  if (!actor.businessId) {
    throw new AppError("FORBIDDEN", "No tienes permiso para esta operación", 403);
  }
  return actor.businessId;
}
