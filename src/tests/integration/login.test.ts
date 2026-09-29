import { afterAll, describe, expect, it, vi } from "vitest";
import { signInWithUsername, type LoginDeps } from "@/modules/identity/login";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
  decodeJwtClaims,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// ADR 0002/0003: login con usuario y contraseña contra el Auth real (con el hook de token activo).

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const deps = (supabase: LoginDeps["supabase"] = createAnonClient()): LoginDeps => ({
  supabase,
  db: pool,
  syntheticEmailDomain: TEST_EMAIL_DOMAIN,
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

describe("signInWithUsername", () => {
  it("inicia sesión y el JWT lleva app_role y business_id", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });
    const client = createAnonClient();

    const result = await signInWithUsername(deps(client), account);

    expect(result).toEqual({
      userId: account.userId,
      role: "ADMIN_NEGOCIO",
      mustChangePassword: false,
    });
    const { data } = await client.auth.getSession();
    expect(decodeJwtClaims(data.session!.access_token)).toMatchObject({
      role: "authenticated",
      app_role: "ADMIN_NEGOCIO",
      business_id: business,
    });
  });

  it("el Super Admin entra sin negocio (business_id nulo)", async () => {
    const account = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
    const client = createAnonClient();

    const result = await signInWithUsername(deps(client), account);

    expect(result.role).toBe("SUPER_ADMIN");
    const { data } = await client.auth.getSession();
    expect(decodeJwtClaims(data.session!.access_token)).toMatchObject({
      app_role: "SUPER_ADMIN",
      business_id: null,
    });
  });

  it("normaliza el usuario: mayúsculas y espacios (así se teclea en el celular)", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: business });

    const result = await signInWithUsername(deps(), {
      username: `  ${account.username.toUpperCase()} `,
      password: account.password,
    });

    expect(result.userId).toBe(account.userId);
  });

  it("indica cuando la contraseña es temporal", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({
      role: "COBRADOR",
      businessId: business,
      status: "PENDIENTE_CAMBIO_CONTRASENA",
    });

    expect((await signInWithUsername(deps(), account)).mustChangePassword).toBe(true);
  });

  it("contraseña errónea y usuario inexistente dan exactamente el mismo error", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: business });

    const wrongPassword = await failureOf(
      signInWithUsername(deps(), { username: account.username, password: "Incorrecta123" }),
    );
    const unknownUser = await failureOf(
      signInWithUsername(deps(), { username: "no.existe.jamas", password: "Incorrecta123" }),
    );

    for (const error of [wrongPassword, unknownUser]) {
      expect(error).toMatchObject({ code: "INVALID_CREDENTIALS", status: 401 });
    }
    expect(wrongPassword.message).toBe(unknownUser.message);
  });

  it("un usuario con formato inválido se rechaza sin consultar a Auth", async () => {
    const supabase = {
      auth: {
        signInWithPassword: vi.fn(),
        signOut: vi.fn(),
      },
    } as unknown as LoginDeps["supabase"];

    for (const username of ["no válido", "", "ab"]) {
      expect(
        (await failureOf(signInWithUsername(deps(supabase), { username, password: "Clave12345" })))
          .code,
      ).toBe("INVALID_CREDENTIALS");
    }
    expect(supabase.auth.signInWithPassword).not.toHaveBeenCalled();
  });

  it("registra el último acceso y el evento de auditoría InicioSesion", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });

    await signInWithUsername(deps(), account);

    const profile = await pool.query<{ last_sign_in_at: Date | null }>(
      "select last_sign_in_at from public.profiles where id = $1",
      [account.userId],
    );
    expect(profile.rows[0]?.last_sign_in_at).not.toBeNull();

    const audit = await pool.query(
      "select action, business_id, actor_id, entity_type, result from public.audit_events where actor_id = $1",
      [account.userId],
    );
    expect(audit.rows).toEqual([
      {
        action: "InicioSesion",
        business_id: business,
        actor_id: account.userId,
        entity_type: "profile",
        result: "OK",
      },
    ]);
  });

  it("un negocio suspendido no admite sesiones; al activarlo vuelve a entrar", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });
    await fixtures.setBusinessAccess(business, "SUSPENDIDO");

    expect(await failureOf(signInWithUsername(deps(), account))).toMatchObject({
      code: "BUSINESS_SUSPENDED",
      status: 403,
    });

    await fixtures.setBusinessAccess(business, "ACTIVO");
    expect((await signInWithUsername(deps(), account)).role).toBe("ADMIN_NEGOCIO");
  });

  it("no revela el estado del negocio a quien no acredita la contraseña", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId: business });
    await fixtures.setBusinessAccess(business, "SUSPENDIDO");

    const error = await failureOf(
      signInWithUsername(deps(), { username: account.username, password: "Incorrecta123" }),
    );

    expect(error.code).toBe("INVALID_CREDENTIALS");
  });

  it("un usuario bloqueado no entra", async () => {
    const business = await fixtures.business();
    const account = await fixtures.account({
      role: "COBRADOR",
      businessId: business,
      status: "BLOQUEADO",
    });

    expect(await failureOf(signInWithUsername(deps(), account))).toMatchObject({
      code: "USER_BLOCKED",
      status: 403,
    });
  });

  it("un usuario de Auth sin perfil no entra", async () => {
    const username = `t.${crypto.randomUUID().slice(0, 10)}`;
    const { data } = await admin.auth.admin.createUser({
      email: `${username}@${TEST_EMAIL_DOMAIN}`,
      password: "ClaveTemporal1",
      email_confirm: true,
    });
    try {
      expect(
        await failureOf(signInWithUsername(deps(), { username, password: "ClaveTemporal1" })),
      ).toMatchObject({ code: "ACCESS_DENIED", status: 403 });
    } finally {
      await admin.auth.admin.deleteUser(data.user!.id);
    }
  });

  it("si Auth no responde bien devuelve AUTH_UNAVAILABLE (503)", async () => {
    for (const authError of [{ status: 503, message: "caído" }, { message: "sin red" }]) {
      const supabase = {
        auth: {
          signInWithPassword: vi.fn(async () => ({
            data: { user: null, session: null },
            error: authError,
          })),
          signOut: vi.fn(),
        },
      } as unknown as LoginDeps["supabase"];

      expect(
        await failureOf(
          signInWithUsername(deps(supabase), { username: "alguien", password: "Clave12345" }),
        ),
      ).toMatchObject({ code: "AUTH_UNAVAILABLE", status: 503 });
    }
  });

  it("el registro público está cerrado: las cuentas las crea el administrador", async () => {
    const { error } = await createAnonClient().auth.signUp({
      email: `intruso.${crypto.randomUUID().slice(0, 8)}@${TEST_EMAIL_DOMAIN}`,
      password: "Clave12345",
    });

    expect(error?.code).toBe("signup_disabled");
  });
});
