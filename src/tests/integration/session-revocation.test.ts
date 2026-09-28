import { afterAll, describe, expect, it } from "vitest";
import { signInWithUsername } from "@/modules/identity/login";
import { loadSessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// 03-ARQUITECTURA §4.10: el JWT vive hasta 1 h, pero el estado se lee de la BD en cada petición
// (requireSession usa loadSessionContext), así que una revocación se aplica de inmediato.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("revocación con sesión ya emitida", () => {
  it("bloquear al usuario o suspender su negocio se detecta en la siguiente petición", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });
    await signInWithUsername(
      { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      account,
    );
    expect((await loadSessionContext(account.userId, pool)).businessId).toBe(business);

    await fixtures.setProfileStatus(account.userId, "BLOQUEADO");
    expect(await failureOf(loadSessionContext(account.userId, pool))).toMatchObject({
      code: "USER_BLOCKED",
    });

    await fixtures.setProfileStatus(account.userId, "ACTIVO");
    await fixtures.setBusinessAccess(business, "SUSPENDIDO");
    expect(await failureOf(loadSessionContext(account.userId, pool))).toMatchObject({
      code: "BUSINESS_SUSPENDED",
    });

    await fixtures.setBusinessAccess(business, "ACTIVO");
    expect((await loadSessionContext(account.userId, pool)).role).toBe("ADMIN_NEGOCIO");
  });
});
