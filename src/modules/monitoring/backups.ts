import type { Pool } from "pg";
import { z } from "zod";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { withTransaction } from "@/shared/database/with-transaction";
import { isoDate, localDateIn } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";

/**
 * Verificación de backups (ADR 0011): el Super Admin registra cada verificación (fecha, resultado, nota);
 * el panel muestra la última y avisa si no está al día. No se integra con el proveedor.
 */

export const backupCheckSchema = z.object({
  checkedOn: z.iso.date(),
  result: z.enum(["OK", "FALLO"]),
  note: z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), "La nota no puede contener el carácter nulo")
    .pipe(z.string().max(500))
    .transform((value) => value || undefined)
    .optional(),
});

export type BackupCheckInput = z.output<typeof backupCheckSchema>;

export async function registerBackupCheck(
  deps: { db: Pick<Pool, "connect" | "query"> },
  actor: SessionContext,
  input: BackupCheckInput,
  now: Date = new Date(),
): Promise<{ backupCheckId: string }> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  // No se registra una verificación de una fecha futura (UTC: la plataforma no tiene zona propia).
  if (input.checkedOn > localDateIn(now, "UTC")) {
    throw new AppError(
      "BACKUP_DATE_IN_FUTURE",
      "La fecha de la verificación no puede ser futura",
      400,
    );
  }
  return withTransaction(async (tx) => {
    const created = await tx.query<{ id: string }>(
      `insert into public.backup_checks (checked_on, result, note, registered_by)
       values ($1, $2, $3, $4) returning id`,
      [input.checkedOn, input.result, input.note ?? null, actor.userId],
    );
    const backupCheckId = created.rows[0]!.id;
    await recordAuditEvent(tx, {
      businessId: null,
      actorId: actor.userId,
      action: "BackupVerificado",
      entityType: "backup_check",
      entityId: backupCheckId,
      summary: { checkedOn: input.checkedOn, result: input.result },
    });
    return { backupCheckId };
  }, deps.db);
}

export type BackupStatus = {
  last: { checkedOn: string; result: "OK" | "FALLO"; note: string | null } | null;
  /** Días con verificación OK en los últimos 7 (de 7 posibles): la retención prometida. */
  okDaysLast7: number;
  /** `SIN_REGISTRO`, `FALLO` (la última falló), `VENCIDO` (más de 24 h sin verificar) o `INCOMPLETO` (<7 días OK). */
  alert: "SIN_REGISTRO" | "FALLO" | "VENCIDO" | "INCOMPLETO" | null;
};

export async function getBackupStatus(
  db: Pick<Pool, "query">,
  now: Date = new Date(),
): Promise<BackupStatus> {
  const today = isoDate(localDateIn(now, "UTC"));
  const last = await db.query<{ checked_on: string; result: "OK" | "FALLO"; note: string | null }>(
    `select checked_on::text, result, note from public.backup_checks
      where checked_on <= $1::date order by checked_on desc, (result = 'FALLO') desc, created_at desc limit 1`,
    [today],
  );
  const days = await db.query<{ n: string }>(
    `select count(distinct checked_on)::text as n from public.backup_checks
      where result = 'OK' and checked_on > $1::date - 7 and checked_on <= $1::date`,
    [today],
  );
  const row = last.rows[0];
  const okDaysLast7 = Number(days.rows[0]!.n);
  let alert: BackupStatus["alert"] = null;
  if (!row) alert = "SIN_REGISTRO";
  else if (row.result === "FALLO") alert = "FALLO";
  else if (row.checked_on < today && Date.parse(today) - Date.parse(row.checked_on) > 86_400_000) {
    alert = "VENCIDO";
  } else if (okDaysLast7 < 7) alert = "INCOMPLETO";
  return {
    last: row ? { checkedOn: row.checked_on, result: row.result, note: row.note } : null,
    okDaysLast7,
    alert,
  };
}
