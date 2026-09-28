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
  connectFails?: boolean;
}) {
  const signOut = vi.fn(async () => ({ error: null }));
  const client = { query: vi.fn(async () => ({ rows: [], rowCount: 1 })), release: vi.fn() };
  const db = {
    query: vi.fn(async () => ({ rows: [options.profile ?? profileRow] })),
    connect: vi.fn(async () => {
      if (options.connectFails) throw new Error("BD caída");
      return client;
    }),
  } as unknown as Pick<Pool, "connect" | "query">;
  const deps: LoginDeps = {
    supabase: {
      auth: { signInWithPassword: vi.fn(async () => options.authResult), signOut },
    } as unknown as LoginDeps["supabase"],
    db,
    syntheticEmailDomain: "cuadre.invalid",
  };
  return { deps, signOut };
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
