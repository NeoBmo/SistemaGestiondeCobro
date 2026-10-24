import type { Pool } from "pg";
import { z } from "zod";
import { recordAuditEvent } from "@/modules/audit/record-audit-event";
import { authorizeSession, type SessionContext } from "@/modules/identity/session";
import { withTransaction, type Tx } from "@/shared/database/with-transaction";
import { formatIsoDate, isoDate, type IsoDate } from "@/shared/dates/dates";
import { AppError } from "@/shared/errors/app-error";
import { interestBpsFromPercent } from "@/shared/money/money";
import { effectiveAnnualRateExactBps, formatRateBps, roundRateBps } from "./effective-annual-rate";
import type { LoanPlan } from "./loan-calculation";

/**
 * Tasa de usura (02 §2.3, decisión del 2026-10-24, a validar con abogado). El Super Admin registra la tasa
 * vigente que certifica la Superintendencia Financiera; al crear o refinanciar un préstamo, si su TEA
 * equivalente la supera, el sistema **advierte** y exige que el Admin lo marque para confirmar. No bloquea:
 * la confirmación con advertencia queda en la auditoría del contrato.
 */

/** Tope de registro: descarta errores de digitación (la usura real ronda 25–60 % E.A.). */
const MAX_USURY_RATE_BPS = 100_000;

/** El Super Admin escribe la tasa como porcentaje («28,59»); se guarda en puntos básicos enteros. */
export const usuryRateSchema = z.object({
  rate: z
    .string()
    .trim()
    .transform((text, context) => {
      // Como el interés del préstamo: a lo más dos decimales, que son puntos básicos exactos.
      const normalized = text.replace(",", ".");
      const bps = /^\d{1,4}(\.\d{1,2})?$/.test(normalized)
        ? interestBpsFromPercent(Number(normalized))
        : null;
      if (bps === null || bps <= 0 || bps > MAX_USURY_RATE_BPS) {
        context.addIssue({
          code: "custom",
          message: "Escribe la tasa efectiva anual en porcentaje, por ejemplo 28,59",
        });
        return z.NEVER;
      }
      return bps;
    }),
  validFrom: z.iso.date().transform((value) => isoDate(value)),
  source: z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), "La fuente no puede contener el carácter nulo")
    .pipe(z.string().min(1).max(300)),
});

export type UsuryRateInput = z.output<typeof usuryRateSchema>;

export type UsuryRate = {
  id: string;
  /** Efectiva anual en puntos básicos enteros. */
  rateBps: number;
  validFrom: IsoDate;
  source: string;
};

export type UsuryDeps = { db: Pick<Pool, "connect" | "query"> };

/** Registra una tasa nueva (nunca se edita una anterior: la más reciente manda). Solo el Super Admin. */
export async function registerUsuryRate(
  deps: UsuryDeps,
  actor: SessionContext,
  input: UsuryRateInput,
): Promise<{ usuryRateId: string }> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  return withTransaction(async (tx) => {
    const created = await tx.query<{ id: string }>(
      `insert into public.usury_rates (rate_bps, valid_from, source, registered_by)
       values ($1, $2, $3, $4) returning id`,
      [input.rate, input.validFrom, input.source, actor.userId],
    );
    const usuryRateId = created.rows[0]!.id;
    await recordAuditEvent(tx, {
      businessId: null,
      actorId: actor.userId,
      action: "TasaUsuraRegistrada",
      entityType: "usury_rate",
      entityId: usuryRateId,
      summary: { rateBps: input.rate, validFrom: input.validFrom, source: input.source },
    });
    return { usuryRateId };
  }, deps.db);
}

type UsuryRateRow = { id: string; rate_bps: number; valid_from: string; source: string };

const toRate = (row: UsuryRateRow): UsuryRate => ({
  id: row.id,
  rateBps: row.rate_bps,
  validFrom: isoDate(row.valid_from),
  source: row.source,
});

/** La vigente en `on`: la de `valid_from` más reciente que no sea posterior (a igual fecha, la última). */
export async function currentUsuryRate(
  db: Pick<Tx, "query">,
  on: IsoDate,
): Promise<UsuryRate | null> {
  const { rows } = await db.query<UsuryRateRow>(
    `select id, rate_bps, valid_from::text, source from public.usury_rates
      where valid_from <= $1::date order by valid_from desc, created_at desc limit 1`,
    [on],
  );
  return rows[0] ? toRate(rows[0]) : null;
}

/** Historial para el panel del Super Admin, de la más reciente a la más antigua. */
export async function listUsuryRates(
  db: Pick<Pool, "query">,
  actor: SessionContext,
  limit = 50,
): Promise<(UsuryRate & { registeredAt: Date })[]> {
  authorizeSession(actor, { roles: ["SUPER_ADMIN"] });
  const { rows } = await db.query<UsuryRateRow & { created_at: Date }>(
    `select id, rate_bps, valid_from::text, source, created_at from public.usury_rates
      order by valid_from desc, created_at desc limit $1`,
    [limit],
  );
  return rows.map((row) => ({ ...toRate(row), registeredAt: row.created_at }));
}

export type UsuryAssessment = {
  /** TEA equivalente del préstamo en puntos básicos (ver `effective-annual-rate.ts`). */
  effectiveAnnualRateBps: number;
  /** La TEA llegó al tope de cálculo: es **al menos** `effectiveAnnualRateBps`. */
  effectiveAnnualRateCapped: boolean;
  /** Usura vigente el día del desembolso; `null` si no hay ninguna registrada (no se puede comparar). */
  usuryRate: UsuryRate | null;
  /** TEA exacta (sin redondear) > usura vigente: hay que advertir y la confirmación exige marcarlo. */
  exceeds: boolean;
};

/** Compara la TEA del plan con la usura vigente el día del desembolso. No bloquea nada. */
export async function assessUsury(
  db: Pick<Tx, "query">,
  plan: LoanPlan,
  disbursedOn: IsoDate,
): Promise<UsuryAssessment> {
  const exactBps = effectiveAnnualRateExactBps({
    principal: plan.principal,
    disbursedOn,
    installments: plan.installments,
  });
  const rate = roundRateBps(exactBps);
  const usuryRate = await currentUsuryRate(db, disbursedOn);
  return {
    effectiveAnnualRateBps: rate.bps,
    effectiveAnnualRateCapped: rate.capped,
    usuryRate,
    // Sin redondear: un exceso menor que medio punto básico también se advierte.
    exceeds: usuryRate !== null && exactBps > usuryRate.rateBps,
  };
}

/** «TEA del préstamo (X % E.A.) frente a la usura vigente (Y % E.A.)», para avisos y errores. */
export function describeUsuryExcess(assessment: UsuryAssessment): string {
  const rate = `${assessment.effectiveAnnualRateCapped ? "más de " : ""}${formatRateBps(assessment.effectiveAnnualRateBps)} E.A.`;
  const usury = assessment.usuryRate
    ? `${formatRateBps(assessment.usuryRate.rateBps)} E.A., vigente desde el ${formatIsoDate(assessment.usuryRate.validFrom)}`
    : "sin registrar";
  return `La tasa efectiva anual de este préstamo (${rate}) supera la tasa de usura (${usury}).`;
}

/**
 * Confirmar por encima de la usura exige la marca explícita del Admin (`acknowledgeUsuryWarning: true`);
 * sin ella se rechaza con 409 y no se guarda nada.
 */
export function assertUsuryAcknowledged(
  assessment: UsuryAssessment,
  acknowledged: boolean | undefined,
): void {
  if (assessment.exceeds && acknowledged !== true) {
    throw new AppError(
      "USURY_WARNING_NOT_ACKNOWLEDGED",
      `${describeUsuryExcess(assessment)} Cobrar por encima de la usura es delito (art. 305 del Código Penal). Para confirmar de todos modos, marca que conoces la advertencia.`,
      409,
    );
  }
}

/** Lo que queda en la auditoría del contrato: la TEA, la usura con que se comparó y si se advirtió. */
export function usuryAuditSummary(assessment: UsuryAssessment) {
  return {
    effectiveAnnualRateBps: assessment.effectiveAnnualRateBps,
    effectiveAnnualRateCapped: assessment.effectiveAnnualRateCapped,
    usuryRateId: assessment.usuryRate?.id ?? null,
    usuryRateBps: assessment.usuryRate?.rateBps ?? null,
    // Solo llega aquí si, de superarla, el Admin marcó la advertencia (`assertUsuryAcknowledged`).
    confirmedWithUsuryWarning: assessment.exceeds,
  };
}
