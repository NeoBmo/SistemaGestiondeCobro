import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error";
import { parsePublicEnv, parseServerEnv } from "./env";

const validPublic = {
  NEXT_PUBLIC_SUPABASE_URL: "https://proyecto.supabase.co",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-key",
};

const validServer = {
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  DATABASE_URL: "postgresql://usuario:clave@db.ejemplo.local:6543/postgres",
  AUTH_SYNTHETIC_EMAIL_DOMAIN: "cuadre.invalid",
};

function catchError(fn: () => unknown): AppError {
  try {
    fn();
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba que lanzara");
}

describe("parsePublicEnv", () => {
  it("devuelve las variables tipadas cuando son válidas", () => {
    expect(parsePublicEnv(validPublic)).toEqual({
      supabaseUrl: "https://proyecto.supabase.co",
      supabaseAnonKey: "anon-key",
    });
  });

  it("falla con INVALID_ENV (500) y nombra las variables ausentes", () => {
    const error = catchError(() => parsePublicEnv({}));

    expect(error).toMatchObject({ code: "INVALID_ENV", status: 500 });
    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  });

  it("trata una variable vacía como ausente (así llega desde .env.example)", () => {
    const error = catchError(() =>
      parsePublicEnv({ ...validPublic, NEXT_PUBLIC_SUPABASE_ANON_KEY: "" }),
    );

    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    expect(error.message).not.toContain("NEXT_PUBLIC_SUPABASE_URL");
  });

  it("rechaza una URL inválida", () => {
    const error = catchError(() =>
      parsePublicEnv({ ...validPublic, NEXT_PUBLIC_SUPABASE_URL: "no-es-url" }),
    );

    expect(error.message).toContain("NEXT_PUBLIC_SUPABASE_URL");
  });
});

describe("parseServerEnv", () => {
  it("devuelve las variables tipadas cuando son válidas", () => {
    expect(parseServerEnv(validServer)).toEqual({
      supabaseServiceRoleKey: "service-role-key",
      databaseUrl: "postgresql://usuario:clave@db.ejemplo.local:6543/postgres",
      syntheticEmailDomain: "cuadre.invalid",
    });
  });

  it("acepta los esquemas postgres:// y postgresql://", () => {
    expect(() =>
      parseServerEnv({ ...validServer, DATABASE_URL: "postgres://u:p@h:5432/db" }),
    ).not.toThrow();
  });

  it("rechaza DATABASE_URL que no sea PostgreSQL", () => {
    const error = catchError(() =>
      parseServerEnv({ ...validServer, DATABASE_URL: "mysql://u:p@h:3306/db" }),
    );

    expect(error.message).toContain("DATABASE_URL");
  });

  it("rechaza un dominio de email sintético que no sea un hostname válido", () => {
    for (const bad of [
      "no es dominio",
      "@cuadre.invalid",
      "cuadre",
      "-x.invalid",
      "a..b.invalid",
    ]) {
      const error = catchError(() =>
        parseServerEnv({ ...validServer, AUTH_SYNTHETIC_EMAIL_DOMAIN: bad }),
      );
      expect(error.message).toContain("AUTH_SYNTHETIC_EMAIL_DOMAIN");
    }
  });

  it("nunca incluye valores (secretos) en el mensaje de error", () => {
    const error = catchError(() =>
      parseServerEnv({
        ...validServer,
        DATABASE_URL: "mysql://usuario:claveSuperSecreta@host/db",
        SUPABASE_SERVICE_ROLE_KEY: "",
      }),
    );

    expect(error.message).toContain("DATABASE_URL");
    expect(error.message).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(error.message).not.toContain("claveSuperSecreta");
  });
});
