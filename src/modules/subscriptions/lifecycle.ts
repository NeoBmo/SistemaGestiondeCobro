import type { Pool } from "pg";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeSuperAdminOnBusiness } from "@/modules/identity/authorize-super-admin";
import type { SessionContext } from "@/modules/identity/session";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { isoDate, localDateIn, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { assertTransition, type LifecycleCommand } from "./lifecycle-rules";
import { isPlanCode, subscriptionExpiry, type PlanCode } from "./plans";
import type { StoredSubscriptionStatus } from "./subscription-status";

/**
 * Ciclo de vida de un negocio (02-DOMINIO §1.2–1.3, ADR 0003 y 0005). Solo el Super Admin. Cada
 * comando es una única transacción que bloquea la fila del negocio (y su suscripción vigente), cambia
 * `businesses.access_status` y `subscriptions` juntos y deja su evento de auditoría con el valor anterior
 * y el nuevo. No son comandos financieros: no llevan clave de idempotencia; repetir uno ya aplicado
 * devuelve 409 porque la transición deja de ser válida.
 */

export type LifecycleDeps = {
  db: Pick<Pool, "connect" | "query">;
  now?: () => Date;
};

export type BusinessAccessStatus = "ACTIVO" | "SUSPENDIDO";

export type SubscriptionSnapshot = {
  id: string;
  planCode: PlanCode;
  status: StoredSubscriptionStatus;
  startsOn: IsoDate;
  expiresOn: IsoDate;
};

export type LifecycleResult = {
  businessId: string;
  accessStatus: BusinessAccessStatus;
  subscription: SubscriptionSnapshot;
};

const NOTE_MAX_LENGTH = 500;

type LockedState = {
  business: { id: string; timeZone: string; accessStatus: BusinessAccessStatus };
  /** Suscripción vigente (no archivada); `null` si el negocio solo tiene archivadas. */
  current: SubscriptionSnapshot | null;
  /** La archivada más reciente, para el historial de una re-suscripción. */
  lastArchived: SubscriptionSnapshot | null;
};

type SubscriptionRow = {
  id: string;
  plan_code: PlanCode;
  status: StoredSubscriptionStatus;
  starts_on: string;
  expires_on: string;
};

const toSnapshot = (row: SubscriptionRow): SubscriptionSnapshot => ({
  id: row.id,
  planCode: row.plan_code,
  status: row.status,
  startsOn: isoDate(row.starts_on),
  expiresOn: isoDate(row.expires_on),
});

const summaryOf = (snapshot: SubscriptionSnapshot) => ({
  planCode: snapshot.planCode,
  status: snapshot.status,
  startsOn: snapshot.startsOn,
  expiresOn: snapshot.expiresOn,
});

/** Texto libre opcional (observación) u obligatorio (motivo de archivado): recortado y acotado. */
function cleanText(
  value: string | undefined,
  label: string,
  required: boolean,
): string | undefined {
  const text = value?.trim();
  if (!text) {
    if (required) throw new AppError("REASON_REQUIRED", `${label} es obligatorio`, 400);
    return undefined;
  }
  if (text.length > NOTE_MAX_LENGTH || text.includes("\0")) {
    throw new AppError(
      "INVALID_TEXT",
      `${label} no es válido (máximo ${NOTE_MAX_LENGTH} caracteres)`,
      400,
    );
  }
  return text;
}

const AUDIT_ACTION: Record<LifecycleCommand, string> = {
  SUSPEND: "NegocioSuspendido",
  ACTIVATE: "NegocioActivado",
  ARCHIVE: "NegocioArchivado",
  CHANGE_PLAN: "PlanCambiado",
  RESUBSCRIBE: "SuscripcionCreada",
};

/** Exige Super Admin activo y deja el evento RECHAZADO si no tiene permiso (ver authorize-super-admin.ts). */
export function authorizeLifecycle(
  deps: LifecycleDeps,
  actor: SessionContext,
  command: LifecycleCommand,
  businessId: string,
): Promise<void> {
  return authorizeSuperAdminOnBusiness(deps.db, actor, AUDIT_ACTION[command], businessId);
}

/** Bloquea el negocio y su suscripción vigente en este orden (03 §3) y devuelve el estado leído. */
async function lockState(tx: Tx, businessId: string): Promise<LockedState> {
  const business = await tx.query<{
    id: string;
    time_zone: string;
    access_status: BusinessAccessStatus;
  }>("select id, time_zone, access_status from public.businesses where id = $1 for update", [
    businessId,
  ]);
  const row = business.rows[0];
  if (!row) throw new AppError("BUSINESS_NOT_FOUND", "El negocio no existe", 404);

  const columns = "id, plan_code, status, starts_on::text, expires_on::text";
  const current = await tx.query<SubscriptionRow>(
    `select ${columns} from public.subscriptions where business_id = $1 and status <> 'ARCHIVADA' for update`,
    [businessId],
  );
  const archived = current.rows[0]
    ? undefined
    : await tx.query<SubscriptionRow>(
        `select ${columns} from public.subscriptions
          where business_id = $1 and status = 'ARCHIVADA' order by created_at desc, id desc limit 1`,
        [businessId],
      );

  return {
    business: { id: row.id, timeZone: row.time_zone, accessStatus: row.access_status },
    current: current.rows[0] ? toSnapshot(current.rows[0]) : null,
    lastArchived: archived?.rows[0] ? toSnapshot(archived.rows[0]) : null,
  };
}

type Mutation = {
  accessStatus: BusinessAccessStatus;
  subscription: SubscriptionSnapshot;
};

/**
 * Esqueleto común: abre la transacción, bloquea, valida la transición y delega el cambio. Quien lo
 * llama ya autorizó al actor (antes de validar nada de la entrada: un actor sin permiso recibe 403, no 400).
 */
async function runLifecycle(
  deps: LifecycleDeps,
  command: LifecycleCommand,
  businessId: string,
  apply: (tx: Tx, state: LockedState, today: IsoDate) => Promise<Mutation>,
): Promise<LifecycleResult> {
  return withTransaction(async (tx) => {
    const state = await lockState(tx, businessId);
    assertTransition(command, state.current?.status ?? null);
    const today = localDateIn((deps.now ?? (() => new Date()))(), state.business.timeZone);
    const result = await apply(tx, state, today);
    return { businessId, ...result };
  }, deps.db);
}

async function setBusinessAccess(tx: Tx, businessId: string, status: BusinessAccessStatus) {
  await tx.query(
    "update public.businesses set access_status = $2, updated_at = now() where id = $1",
    [businessId, status],
  );
}

async function setSubscriptionStatus(
  tx: Tx,
  subscriptionId: string,
  status: StoredSubscriptionStatus,
  actorId: string,
  note: string | undefined,
) {
  await tx.query(
    `update public.subscriptions
        set status = $2, note = coalesce($3, note), changed_by = $4, updated_at = now()
      where id = $1`,
    [subscriptionId, status, note ?? null, actorId],
  );
}

type StatusChange = {
  command: Extract<LifecycleCommand, "SUSPEND" | "ACTIVATE" | "ARCHIVE">;
  access: BusinessAccessStatus;
  status: StoredSubscriptionStatus;
};

/** Suspender, activar y archivar solo cambian el estado de acceso y el de la suscripción vigente. */
async function changeStatus(
  deps: LifecycleDeps,
  actor: SessionContext,
  businessId: string,
  change: StatusChange,
  note: string | undefined,
): Promise<LifecycleResult> {
  return runLifecycle(deps, change.command, businessId, async (tx, state) => {
    const before = state.current!;
    await setBusinessAccess(tx, businessId, change.access);
    await setSubscriptionStatus(tx, before.id, change.status, actor.userId, note);

    await recordAuditEvent(tx, {
      businessId,
      actorId: actor.userId,
      action: AUDIT_ACTION[change.command],
      entityType: "business",
      entityId: businessId,
      summary: {
        subscriptionId: before.id,
        from: { accessStatus: state.business.accessStatus, subscriptionStatus: before.status },
        to: { accessStatus: change.access, subscriptionStatus: change.status },
        ...(change.command === "ARCHIVE" ? { reason: note } : note ? { note } : {}),
      },
    });
    return {
      accessStatus: change.access,
      subscription: { ...before, status: change.status },
    };
  });
}

export async function suspendBusiness(
  deps: LifecycleDeps,
  actor: SessionContext,
  input: { businessId: string; note?: string },
): Promise<LifecycleResult> {
  await authorizeLifecycle(deps, actor, "SUSPEND", input.businessId);
  const note = cleanText(input.note, "La observación", false);
  return changeStatus(
    deps,
    actor,
    input.businessId,
    { command: "SUSPEND", access: "SUSPENDIDO", status: "SUSPENDIDA" },
    note,
  );
}

export async function activateBusiness(
  deps: LifecycleDeps,
  actor: SessionContext,
  input: { businessId: string; note?: string },
): Promise<LifecycleResult> {
  await authorizeLifecycle(deps, actor, "ACTIVATE", input.businessId);
  const note = cleanText(input.note, "La observación", false);
  return changeStatus(
    deps,
    actor,
    input.businessId,
    { command: "ACTIVATE", access: "ACTIVO", status: "ACTIVA" },
    note,
  );
}

/** El motivo es obligatorio al archivar (02-DOMINIO §1.3) y queda en la observación y en la auditoría. */
export async function archiveBusiness(
  deps: LifecycleDeps,
  actor: SessionContext,
  input: { businessId: string; reason: string },
): Promise<LifecycleResult> {
  await authorizeLifecycle(deps, actor, "ARCHIVE", input.businessId);
  const reason = cleanText(input.reason, "El motivo", true);
  return changeStatus(
    deps,
    actor,
    input.businessId,
    { command: "ARCHIVE", access: "SUSPENDIDO", status: "ARCHIVADA" },
    reason,
  );
}

/** Cambia el plan de la suscripción vigente: reinicia inicio y vencimiento desde hoy (02-DOMINIO §1.3). */
export async function changePlan(
  deps: LifecycleDeps,
  actor: SessionContext,
  input: { businessId: string; planCode: PlanCode; note?: string },
): Promise<LifecycleResult> {
  await authorizeLifecycle(deps, actor, "CHANGE_PLAN", input.businessId);
  const note = cleanText(input.note, "La observación", false);
  if (!isPlanCode(input.planCode)) throw new AppError("INVALID_PLAN", "El plan no es válido", 400);
  const planCode = input.planCode;

  return runLifecycle(deps, "CHANGE_PLAN", input.businessId, async (tx, state, today) => {
    const before = state.current!;
    const after: SubscriptionSnapshot = {
      ...before,
      planCode,
      startsOn: today,
      expiresOn: subscriptionExpiry(planCode, today),
    };
    try {
      await tx.query(
        `update public.subscriptions
            set plan_code = $2, starts_on = $3, expires_on = $4,
                note = coalesce($5, note), changed_by = $6, updated_at = now()
          where id = $1`,
        [before.id, after.planCode, after.startsOn, after.expiresOn, note ?? null, actor.userId],
      );
    } catch (error) {
      // El negocio tiene más cobradores activos que el tope del plan destino (ADR 0009): no se baja.
      if ((error as { code?: string } | null)?.code === "23514") {
        throw new AppError(
          "COLLECTOR_LIMIT_EXCEEDED",
          "El negocio tiene más cobradores activos de los que admite ese plan: desactiva cobradores antes de bajar de plan",
          409,
        );
      }
      throw error;
    }

    await recordAuditEvent(tx, {
      businessId: input.businessId,
      actorId: actor.userId,
      action: AUDIT_ACTION.CHANGE_PLAN,
      entityType: "subscription",
      entityId: before.id,
      summary: { from: summaryOf(before), to: summaryOf(after), ...(note ? { note } : {}) },
    });
    return { accessStatus: state.business.accessStatus, subscription: after };
  });
}

/**
 * Un negocio archivado vuelve con una suscripción NUEVA, ACTIVA desde hoy y con el plan que elija el
 * Super Admin (ADR 0005). La fila archivada no se modifica: queda como historial. No exige motivo.
 */
export async function resubscribeBusiness(
  deps: LifecycleDeps,
  actor: SessionContext,
  input: { businessId: string; planCode: PlanCode; note?: string },
): Promise<LifecycleResult> {
  await authorizeLifecycle(deps, actor, "RESUBSCRIBE", input.businessId);
  const note = cleanText(input.note, "La observación", false);
  if (!isPlanCode(input.planCode)) throw new AppError("INVALID_PLAN", "El plan no es válido", 400);
  const planCode = input.planCode;

  return runLifecycle(deps, "RESUBSCRIBE", input.businessId, async (tx, state, today) => {
    const expiresOn = subscriptionExpiry(planCode, today);
    const created = await tx.query<{ id: string }>(
      `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on, note, changed_by)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [input.businessId, planCode, today, expiresOn, note ?? null, actor.userId],
    );
    const subscription: SubscriptionSnapshot = {
      id: created.rows[0]!.id,
      planCode,
      status: "ACTIVA",
      startsOn: today,
      expiresOn,
    };
    await setBusinessAccess(tx, input.businessId, "ACTIVO");

    const audit = { businessId: input.businessId, actorId: actor.userId };
    await recordAuditEvent(tx, {
      ...audit,
      action: AUDIT_ACTION.RESUBSCRIBE,
      entityType: "subscription",
      entityId: subscription.id,
      summary: {
        ...summaryOf(subscription),
        previous: state.lastArchived ? summaryOf(state.lastArchived) : null,
        ...(note ? { note } : {}),
      },
    });
    await recordAuditEvent(tx, {
      ...audit,
      action: "NegocioActivado",
      entityType: "business",
      entityId: input.businessId,
      summary: {
        subscriptionId: subscription.id,
        via: "resuscripcion",
        from: { accessStatus: state.business.accessStatus },
        to: { accessStatus: "ACTIVO" },
      },
    });
    return { accessStatus: "ACTIVO", subscription };
  });
}
