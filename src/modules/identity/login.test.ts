import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { signInWithUsername, type LoginDeps } from "./login";

// Fallos de Auth y de la BD alrededor del login, con dobles (el flujo real está en integración).

const profileRow = {
  id: "u-1",
  role: "COBRADOR",
  business_id: "b-1",
  username: "cobrador.a",
  display_name: "Cobrador A",
  status: "ACTIVO",
  access_status: "ACTIVO",
  time_zone: "America/Bogota",
};

type AuthResult = {
  data: { user: { id: string } | null };
  error: { status?: number; message: string } | null;
};

function makeDeps(options: {
  authResult: AuthResult;
  profile?: Record<string, unknown>;
  /** Falla la transacción posterior a Auth (la primera conexión es la del registro del intento). */
  connectFails?: boolean;
  /** El límite de intentos considera bloqueada la clave hasta esta hora. */
  lockedUntil?: Date;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const client = {
    query: vi.fn(async () => ({
      rows: [{ id: "attempt-1", locked_until: options.lockedUntil ?? null }],
      rowCount: 1,
    })),
    release: vi.fn(),
  };
  let connections = 0;
  const db = {
    query: vi.fn(async () => ({ rows: [options.profile ?? profileRow] })),
    connect: vi.fn(async () => {
      connections += 1;
      if (options.connectFails && connections > 1) throw new Error("BD caída");
      return client;
    }),
  } as unknown as Pick<Pool, "connect" | "query">;
  const signInWithPassword = vi.fn(async () => options.authResult);
  const deps: LoginDeps = {
    supabase: {
      auth: { signInWithPassword, signOut },
    } as unknown as LoginDeps["supabase"],
    db,
    syntheticEmailDomain: "cuadre.invalid",
    now: () => new Date("2026-10-24T12:00:00Z"),
  };
  return { deps, signOut, signInWithPassword, db };
}

const input = { username: "cobrador.a", password: "Clave12345" };
const success: AuthResult = { data: { user: { id: "u-1" } }, error: null };

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

describe("signInWithUsername: fallos", () => {
  it("un 429 de Auth es TOO_MANY_ATTEMPTS (429), no unas credenciales incorrectas", async () => {
    const { deps } = makeDeps({
      authResult: { data: { user: null }, error: { status: 429, message: "rate limit" } },
    });

    expect(await failureOf(signInWithUsername(deps, input))).toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
      status: 429,
    });
  });

  it("si el contexto se rechaza tras autenticar, cierra solo esta sesión (scope local)", async () => {
    const { deps, signOut } = makeDeps({
      authResult: success,
      profile: { ...profileRow, status: "BLOQUEADO" },
    });

    expect(await failureOf(signInWithUsername(deps, input))).toMatchObject({
      code: "USER_BLOCKED",
    });
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("si falla la transacción de último acceso y auditoría, cierra la sesión y propaga el error", async () => {
    const { deps, signOut } = makeDeps({ authResult: success, connectFails: true });

    await expect(signInWithUsername(deps, input)).rejects.toThrow("BD caída");
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("no cierra sesión cuando todo sale bien", async () => {
    const { deps, signOut } = makeDeps({ authResult: success });

    expect(await signInWithUsername(deps, input)).toEqual({
      userId: "u-1",
      role: "COBRADOR",
      mustChangePassword: false,
    });
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe("signInWithUsername: límite de intentos (02 §1.4)", () => {
  it("con la clave bloqueada responde TOO_MANY_ATTEMPTS sin consultar a Auth", async () => {
    const { deps, signInWithPassword } = makeDeps({
      authResult: success,
      lockedUntil: new Date("2026-10-24T12:10:00Z"),
    });

    expect(await failureOf(signInWithUsername(deps, input))).toMatchObject({
      code: "TOO_MANY_ATTEMPTS",
      status: 429,
      message: "Demasiados intentos fallidos. Espera 15 minutos e intenta de nuevo",
    });
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("un bloqueo ya vencido no impide entrar", async () => {
    const { deps } = makeDeps({
      authResult: success,
      lockedUntil: new Date("2026-10-24T11:59:59Z"),
    });

    expect((await signInWithUsername(deps, input)).userId).toBe("u-1");
  });

  it("cierra el intento con el motivo del fallo, nunca con la contraseña", async () => {
    const { deps, db } = makeDeps({
      authResult: { data: { user: null }, error: { status: 400, message: "invalid" } },
    });

    expect((await failureOf(signInWithUsername(deps, input))).code).toBe("INVALID_CREDENTIALS");
    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("login_security_events"), [
      "attempt-1",
      "CREDENCIALES_INVALIDAS",
    ]);
    expect(JSON.stringify(vi.mocked(db.query).mock.calls)).not.toContain(input.password);
  });
});
