import type { Pool } from "pg";
import { z } from "zod";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeBusinessAdmin } from "@/modules/identity/authorize-business-admin";
import type { SessionContext } from "@/modules/identity/session";
import { setLockTimeout, translateLockTimeout } from "@/shared/database/lock-timeout";
import { withTransaction } from "@/shared/database/with-transaction";
import { AppError } from "@/shared/errors/app-error";
import { PERIODS } from "./periods";
import { loadPlanAndSettings } from "./queries";
import { WIDGETS, resolveDashboardConfig, type DashboardConfig } from "./widgets";

/**
 * Configuración de presentación del dashboard (ADR 0010). No es un hecho financiero ni un comando de
 * dinero: una transacción y su auditoría, sin clave de idempotencia (guardar lo mismo dos veces deja lo
 * mismo). Solo los planes mensual y anual pueden guardarla; la base lo exige además.
 */

export const dashboardConfigSchema = z.object({
  period: z.enum(PERIODS),
  // Orden y selección: sin repetidos y solo indicadores conocidos.
  widgets: z
    .array(z.enum(WIDGETS))
    .max(WIDGETS.length)
    .refine((list) => new Set(list).size === list.length, "Hay indicadores repetidos"),
});

export type DashboardConfigInput = z.output<typeof dashboardConfigSchema>;

export type SettingsDeps = { db: Pick<Pool, "connect" | "query"> };

export async function saveDashboardConfig(
  deps: SettingsDeps,
  actor: SessionContext,
  input: DashboardConfigInput,
): Promise<DashboardConfig> {
  const businessId = await authorizeBusinessAdmin(deps.db, actor, "DashboardConfigurado");
  try {
    return await withTransaction(async (tx) => {
      await setLockTimeout(tx);
      const { subscription } = await loadPlanAndSettings(tx, businessId);
      const plan = subscription?.plan_code ?? null;
      if (plan !== "MENSUAL" && plan !== "ANUAL") {
        throw new AppError(
          "DASHBOARD_NOT_CONFIGURABLE",
          "El dashboard solo es configurable en los planes mensual y anual",
          403,
        );
      }
      const before = await tx.query<{ period: string; widgets: unknown }>(
        "select period, widgets from public.dashboard_settings where business_id = $1 for update",
        [businessId],
      );
      await tx.query(
        `insert into public.dashboard_settings (business_id, period, widgets, updated_by)
         values ($1, $2, $3::jsonb, $4)
         on conflict (business_id) do update
           set period = excluded.period, widgets = excluded.widgets,
               updated_by = excluded.updated_by, updated_at = now()`,
        [businessId, input.period, JSON.stringify(input.widgets), actor.userId],
      );
      await recordAuditEvent(tx, {
        businessId,
        actorId: actor.userId,
        action: "DashboardConfigurado",
        entityType: "dashboard_settings",
        entityId: businessId,
        summary: {
          from: before.rows[0] ?? null,
          to: { period: input.period, widgets: input.widgets },
        },
      });
      return resolveDashboardConfig(plan, { period: input.period, widgets: input.widgets });
    }, deps.db);
  } catch (error) {
    throw translateLockTimeout(error);
  }
}
