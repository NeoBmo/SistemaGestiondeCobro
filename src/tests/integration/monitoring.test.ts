import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import {
  backupCheckSchema,
  getBackupStatus,
  registerBackupCheck,
} from "@/modules/monitoring/backups";
import { isValidMonitorSecret, runHealthCheck } from "@/modules/monitoring/health";
import { STALE_AFTER_MINUTES, getPlatformIndicators } from "@/modules/monitoring/indicators";
import { recordPlatformError } from "@/modules/monitoring/record-error";
import { AppError } from "@/shared/errors/app-error";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool, withRollback } from "./helpers/db";
import { createBusiness, createProfile, createSubscription } from "./helpers/identity";

// F7-T4 (ADR 0011): errores, disponibilidad, backups e indicadores del Super Admin.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

/** Una fecha lejana: las ventanas de los indicadores no ven nada de lo que escriben otras pruebas. */
const NOW = new Date("2030-03-10T12:00:00Z");
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

async function superAdmin(): Promise<SessionContext> {
  const account = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
  return loadSessionContext(account.userId, pool);
}

const check = (client: pg.PoolClient, at: string, ok: boolean, latency: number, authOk = ok) =>
  client.query(
    "insert into public.health_checks (checked_at, ok, database_ok, auth_ok, latency_ms) values ($1, $2, true, $3, $4)",
    [at, ok && authOk, authOk, latency],
  );

describe("secreto del chequeo", () => {
  it("compara en tiempo constante y sin secreto configurado queda deshabilitado", () => {
    const secret = "s".repeat(40);
    expect(isValidMonitorSecret(secret, secret)).toBe(true);
    expect(isValidMonitorSecret("x".repeat(40), secret)).toBe(false);
    expect(isValidMonitorSecret("corto", secret)).toBe(false);
    expect(isValidMonitorSecret(null, secret)).toBe(false);
    expect(isValidMonitorSecret(secret, undefined)).toBe(false);
    expect(isValidMonitorSecret("", "")).toBe(false);
  });
});

describe("chequeo de disponibilidad", () => {
  it("guarda el resultado y la latencia de un chequeo correcto", async () => {
    await withRollback(pool, async (client) => {
      const result = await runHealthCheck({ db: client, checkAuth: async () => true });

      expect(result).toMatchObject({ ok: true, databaseOk: true, authOk: true });
      const row = await client.query<{ ok: boolean; latency_ms: number }>(
        "select ok, latency_ms from public.health_checks order by checked_at desc limit 1",
      );
      expect(row.rows[0]).toMatchObject({ ok: true });
      expect(row.rows[0]!.latency_ms).toBeGreaterThanOrEqual(0);
    });
  });

  it("una caída de la autenticación se registra como chequeo fallido", async () => {
    await withRollback(pool, async (client) => {
      const result = await runHealthCheck({ db: client, checkAuth: async () => false });
      expect(result).toMatchObject({ ok: false, databaseOk: true, authOk: false });
      const row = await client.query(
        "select 1 from public.health_checks where not ok and database_ok and not auth_ok",
      );
      expect(row.rowCount).toBeGreaterThan(0);
    });
    // Un chequeo que lanza se trata igual que uno fallido.
    await withRollback(pool, async (client) => {
      const result = await runHealthCheck({
        db: client,
        checkAuth: async () => {
          throw new Error("timeout");
        },
      });
      expect(result.authOk).toBe(false);
    });
  });

  it("si la base no responde no se escribe nada y el resultado es fallido", async () => {
    let writes = 0;
    const db = {
      query: async (sql: string) => {
        if (sql.startsWith("select 1")) throw new Error("conexión rechazada");
        writes += 1;
        return { rows: [], rowCount: 0 };
      },
    };

    const result = await runHealthCheck({ db: db as never, checkAuth: async () => true });

    expect(result).toMatchObject({ ok: false, databaseOk: false });
    expect(writes).toBe(0);
  });
});

describe("registro de errores", () => {
  it("guarda solo la ruta y el tipo del error y nunca lanza", async () => {
    await withRollback(pool, async (client) => {
      await recordPlatformError(client, {
        route: "/api/negocio/pagos/:id",
        errorName: "TypeError",
      });
      const row = await client.query<{ kind: string; route: string; error_name: string }>(
        "select kind, route, error_name from public.platform_events order by occurred_at desc limit 1",
      );
      expect(row.rows[0]).toEqual({
        kind: "ERROR_500",
        route: "/api/negocio/pagos/:id",
        error_name: "TypeError",
      });
    });
    // Con la base caída, registrar no propaga el fallo.
    await expect(
      recordPlatformError({ query: async () => Promise.reject(new Error("sin base")) } as never, {
        route: "/api/x",
        errorName: "Error",
      }),
    ).resolves.toBeUndefined();
  });
});

describe("backups", () => {
  it("el Super Admin registra una verificación; no una futura ni otro rol", async () => {
    const root = await superAdmin();
    const other = await fixtures.account({
      role: "ADMIN_NEGOCIO",
      businessId: await fixtures.business("Backups"),
    });
    const admin = await loadSessionContext(other.userId, pool);

    const created = await registerBackupCheck(
      { db: pool },
      root,
      { checkedOn: "2030-03-10", result: "OK", note: "Restauración de prueba" },
      NOW,
    );
    expect(created.backupCheckId).toBeTruthy();
    const audit = await pool.query(
      "select 1 from public.audit_events where action = 'BackupVerificado' and entity_id = $1",
      [created.backupCheckId],
    );
    expect(audit.rowCount).toBe(1);

    await expect(
      registerBackupCheck({ db: pool }, root, { checkedOn: "2030-03-11", result: "OK" }, NOW),
    ).rejects.toMatchObject({ code: "BACKUP_DATE_IN_FUTURE", status: 400 });
    await expect(
      registerBackupCheck({ db: pool }, admin, { checkedOn: "2030-03-10", result: "OK" }, NOW),
    ).rejects.toBeInstanceOf(AppError);
    expect(backupCheckSchema.safeParse({ checkedOn: "ayer", result: "OK" }).success).toBe(false);
    expect(
      backupCheckSchema.safeParse({ checkedOn: "2030-03-10", result: "TAL VEZ" }).success,
    ).toBe(false);
  });

  it("el estado avisa si no hay registro, si el último falló, si venció o si la cobertura es incompleta", async () => {
    const root = await superAdmin();
    await withRollback(pool, async (client) => {
      const insert = (on: string, result: "OK" | "FALLO") =>
        client.query(
          "insert into public.backup_checks (checked_on, result, registered_by) values ($1, $2, $3)",
          [on, result, root.userId],
        );
      // Con otra fecha lejana para ignorar lo que haya en la base: se mira desde 2040.
      const at = new Date("2040-06-15T10:00:00Z");

      // Antes de cualquier verificación registrada no hay nada que mostrar.
      expect((await getBackupStatus(client, new Date("2000-01-01T00:00:00Z"))).alert).toBe(
        "SIN_REGISTRO",
      );

      await insert("2040-06-10", "OK");
      expect((await getBackupStatus(client, at)).alert).toBe("VENCIDO");

      await insert("2040-06-14", "OK");
      expect(await getBackupStatus(client, at)).toMatchObject({
        alert: "INCOMPLETO",
        okDaysLast7: 2,
      });

      for (const day of ["2040-06-09", "2040-06-11", "2040-06-12", "2040-06-13", "2040-06-15"])
        await insert(day, "OK");
      expect(await getBackupStatus(client, at)).toMatchObject({ alert: null, okDaysLast7: 7 });

      await insert("2040-06-15", "FALLO");
      expect((await getBackupStatus(client, at)).alert).toBe("FALLO");
    });
  });
});

describe("indicadores del Super Admin", () => {
  it("calcula disponibilidad, latencia, interrupciones, errores y chequeos recientes", async () => {
    const root = await superAdmin();
    await withRollback(pool, async (client) => {
      await check(client, minutesAgo(5), true, 100);
      await check(client, minutesAgo(20), true, 200);
      await check(client, minutesAgo(35), false, 900, false); // auth caído
      await check(client, minutesAgo(50), true, 300);
      await check(client, minutesAgo(60 * 30), true, 400); // fuera de 24 h, dentro de 7 d
      await client.query(
        "insert into public.platform_events (kind, route, error_name, occurred_at) values ('ERROR_500', '/api/x', 'Error', $1), ('ERROR_500', '/api/y', 'TypeError', $2), ('ERROR_500', '/api/z', 'Error', $3)",
        [minutesAgo(10), minutesAgo(60), minutesAgo(60 * 30)],
      );

      const data = await getPlatformIndicators(client, root, NOW);

      expect(data.last24h).toMatchObject({ checks: 4, availability: 75, averageLatencyMs: 375 });
      expect(data.last24h.p95LatencyMs).toBeGreaterThanOrEqual(300);
      expect(data.last7d).toMatchObject({ checks: 5, availability: 80 });
      expect(data.interruptions).toHaveLength(1);
      expect(data.interruptions[0]).toMatchObject({ databaseOk: true, authOk: false });
      expect(data.errors24h).toBe(2);
      expect(data.recentErrors[0]).toMatchObject({ route: "/api/x" });
      expect(data.minutesSinceLastCheck).toBe(5);
      expect(data.stale).toBe(false);
    });
  });

  it("la ausencia de chequeos recientes es una interrupción", async () => {
    const root = await superAdmin();
    await withRollback(pool, async (client) => {
      await check(client, minutesAgo(STALE_AFTER_MINUTES + 1), true, 50);
      expect((await getPlatformIndicators(client, root, NOW)).stale).toBe(true);
    });
    await withRollback(pool, async (client) => {
      const none = await getPlatformIndicators(client, root, new Date("2000-01-01T00:00:00Z"));
      expect(none).toMatchObject({
        stale: true,
        minutesSinceLastCheck: null,
        last24h: { checks: 0, availability: null },
      });
    });
  });

  it("una suscripción por vencer o vencida genera alerta y no suspende el acceso", async () => {
    const root = await superAdmin();
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Por vencer");
      await createProfile(client, {
        role: "ADMIN_NEGOCIO",
        businessId: business,
        username: "admin.vence",
      });
      await createSubscription(client, business);
      await client.query(
        "update public.subscriptions set starts_on = '2030-02-01', expires_on = '2030-03-12' where business_id = $1",
        [business],
      );

      let data = await getPlatformIndicators(client, root, NOW);
      expect(data.subscriptions.find((s) => s.businessId === business)).toMatchObject({
        status: "PROXIMA_A_VENCER",
        expiresOn: "2030-03-12",
        accessStatus: "ACTIVO",
      });

      await client.query(
        "update public.subscriptions set starts_on = '2030-01-01', expires_on = '2030-03-01' where business_id = $1",
        [business],
      );
      data = await getPlatformIndicators(client, root, NOW);
      expect(data.subscriptions.find((s) => s.businessId === business)).toMatchObject({
        status: "VENCIDA",
        accessStatus: "ACTIVO",
      });
      // Nada la suspendió: el acceso del negocio sigue activo.
      const access = await client.query(
        "select access_status from public.businesses where id = $1",
        [business],
      );
      expect(access.rows[0]!.access_status).toBe("ACTIVO");
    });
  });

  it("incluye los tickets abiertos por prioridad y solo lo lee el Super Admin", async () => {
    const root = await superAdmin();
    const account = await fixtures.account({
      role: "ADMIN_NEGOCIO",
      businessId: await fixtures.business("Indicadores"),
    });
    const admin = await loadSessionContext(account.userId, pool);

    const data = await getPlatformIndicators(pool, root, NOW);
    expect(data.tickets).toMatchObject({
      ALTA: expect.any(Number),
      MEDIA: expect.any(Number),
      BAJA: expect.any(Number),
    });
    await expect(getPlatformIndicators(pool, admin, NOW)).rejects.toMatchObject({ status: 403 });
  });
});
