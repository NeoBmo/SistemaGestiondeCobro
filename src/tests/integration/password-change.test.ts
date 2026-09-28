import { afterAll, describe, expect, it } from "vitest";
import { signInWithUsername } from "@/modules/identity/login";
import { completeFirstPasswordChange } from "@/modules/identity/password";
import { authorizeSession, loadSessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// 02-DOMINIO §1.4: la contraseña inicial temporal obliga al cambio en el primer acceso.

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
  return { account, client, context, deps: { supabase: client, db: pool } };
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

describe("completeFirstPasswordChange", () => {
  it("con la contraseña temporal pendiente todo queda bloqueado salvo el cambio", async () => {
    const { context } = await pendingUser();

    expect(context.mustChangePassword).toBe(true);
    expect(() => authorizeSession(context)).toThrowError(
      expect.objectContaining({ code: "PASSWORD_CHANGE_REQUIRED" }),
    );
    expect(authorizeSession(context, { allowPasswordChangePending: true })).toBe(context);
  });

  it("cambia la contraseña, activa al usuario y audita; la temporal deja de servir", async () => {
    const { account, context, deps } = await pendingUser();

    await completeFirstPasswordChange(deps, context, "NuevaClave2026");

    expect(await statusOf(account.userId)).toBe("ACTIVO");
    expect((await loadSessionContext(account.userId, pool)).mustChangePassword).toBe(false);

    const audit = await pool.query<{ action: string }>(
      "select action from public.audit_events where actor_id = $1 and action <> 'InicioSesion' order by action",
      [account.userId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "ContrasenaCambiada",
      "PrimerAccesoCompletado",
    ]);

    const loginDeps = { db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN };
    expect(
      await failureOf(signInWithUsername({ ...loginDeps, supabase: createAnonClient() }, account)),
    ).toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect(
      await signInWithUsername(
        { ...loginDeps, supabase: createAnonClient() },
        { username: account.username, password: "NuevaClave2026" },
      ),
    ).toMatchObject({ mustChangePassword: false });
  });

  it("rechaza contraseñas que no cumplen la política sin tocar nada", async () => {
    const { account, context, deps } = await pendingUser();

    for (const weak of ["corta1", "soloLetrasAqui", "123456789", "x".repeat(80) + "1"]) {
      expect(await failureOf(completeFirstPasswordChange(deps, context, weak)), weak).toMatchObject(
        {
          code: "INVALID_PASSWORD",
          status: 400,
        },
      );
    }
    expect(await statusOf(account.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");
  });

  it("rechaza conservar la contraseña temporal", async () => {
    const { account, context, deps } = await pendingUser();

    expect(
      await failureOf(completeFirstPasswordChange(deps, context, account.password)),
    ).toMatchObject({ code: "SAME_PASSWORD", status: 400 });
    expect(await statusOf(account.userId)).toBe("PENDIENTE_CAMBIO_CONTRASENA");
  });

  it("un usuario que ya cambió su contraseña no puede repetir este flujo (409)", async () => {
    const { context, deps } = await pendingUser();
    await completeFirstPasswordChange(deps, context, "NuevaClave2026");
    const refreshed = await loadSessionContext(context.userId, pool);

    expect(
      await failureOf(completeFirstPasswordChange(deps, refreshed, "OtraClave2026")),
    ).toMatchObject({ code: "PASSWORD_CHANGE_NOT_PENDING", status: 409 });
  });
});
