import { afterAll, describe, expect, it } from "vitest";
import { signInWithUsername } from "@/modules/identity/login";
import { completeFirstPasswordChange, type PasswordDeps } from "@/modules/identity/password";
import { loadSessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Endurecimiento tras la revisión independiente de F1-T2: carrera, otras sesiones y fallo entre Auth y BD.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function pendingUser() {
  const business = await fixtures.business();
  const account = await fixtures.account({
    role: "COBRADOR",
    businessId: business,
    status: "PENDIENTE_CAMBIO_CONTRASENA",
  });
  const client = createAnonClient();
  await signInWithUsername(
    { supabase: client, db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
    account,
  );
  const context = await loadSessionContext(account.userId, pool);
  return { account, client, context, deps: { supabase: client, db: pool } satisfies PasswordDeps };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

const statusOf = async (userId: string) =>
  (
    await pool.query<{ status: string }>("select status from public.profiles where id = $1", [
      userId,
    ])
  ).rows[0]?.status;

describe("completeFirstPasswordChange: endurecimiento", () => {
  it("dos peticiones simultáneas completan el cambio una sola vez: un solo juego de auditoría", async () => {
    const { account, context, deps } = await pendingUser();

    const results = await Promise.allSettled([
      completeFirstPasswordChange(deps, context, "PrimeraClave2026"),
      completeFirstPasswordChange(deps, context, "SegundaClave2026"),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "PASSWORD_CHANGE_NOT_PENDING", status: 409 });

    const audit = await pool.query<{ action: string; total: number }>(
      `select action, count(*)::int as total from public.audit_events
        where actor_id = $1 and action <> 'InicioSesion' group by action order by action`,
      [account.userId],
    );
    expect(audit.rows).toEqual([
      { action: "ContrasenaCambiada", total: 1 },
      { action: "PrimerAccesoCompletado", total: 1 },
    ]);
  });

  it("cierra las demás sesiones abiertas con la contraseña temporal", async () => {
    const { account, context, deps } = await pendingUser();
    const otherDevice = createAnonClient();
    await signInWithUsername(
      { supabase: otherDevice, db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      account,
    );
    expect((await otherDevice.auth.getUser()).error).toBeNull();

    await completeFirstPasswordChange(deps, context, "NuevaClave2026");

    expect((await otherDevice.auth.refreshSession()).error).not.toBeNull();
  });

  it("si la BD falla tras cambiar la contraseña, sigue PENDIENTE y se reintenta con otra distinta", async () => {
    const { account, context, client } = await pendingUser();
    const brokenDb = {
      connect: async () => {
        throw new Error("BD caída");
      },
      query: pool.query.bind(pool),
    } as unknown as PasswordDeps["db"];

    await expect(
      completeFirstPasswordChange({ supabase: client, db: brokenDb }, context, "NuevaClave2026"),
    ).rejects.toThrow("BD caída");
    expect(await statusOf(account.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");

    const good = { supabase: client, db: pool };
    // Auth ya guardó "NuevaClave2026": repetirla es SAME_PASSWORD; otra distinta completa el cambio.
    expect(
      await failureOf(completeFirstPasswordChange(good, context, "NuevaClave2026")),
    ).toMatchObject({ code: "SAME_PASSWORD" });
    await completeFirstPasswordChange(good, context, "TerceraClave2026");
    expect(await statusOf(account.userId)).toBe("ACTIVO");
  });
});
