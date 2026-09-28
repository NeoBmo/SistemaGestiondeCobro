import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import { authorizeSession, loadSessionContext, type SessionContext } from "./session";

// 02-DOMINIO §1.4 y matriz de permisos §8; 03-ARQUITECTURA §4.10: el estado se lee de la BD, no del JWT.

function fakeDb(row: Record<string, unknown> | undefined): Pick<Pool, "query"> {
  return { query: vi.fn(async () => ({ rows: row ? [row] : [] })) } as unknown as Pick<
    Pool,
    "query"
  >;
}

const adminRow = {
  id: "u-1",
  role: "ADMIN_NEGOCIO",
  business_id: "b-1",
  username: "admin.a",
  display_name: "Admin A",
  status: "ACTIVO",
  access_status: "ACTIVO",
  time_zone: "America/Bogota",
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : "NO_APPERROR";
  }
  return undefined;
}

describe("loadSessionContext", () => {
  it("devuelve el contexto de un admin activo con la zona horaria de su negocio", async () => {
    expect(await loadSessionContext("u-1", fakeDb(adminRow))).toEqual({
      userId: "u-1",
      role: "ADMIN_NEGOCIO",
      businessId: "b-1",
      username: "admin.a",
      displayName: "Admin A",
      businessTimeZone: "America/Bogota",
      mustChangePassword: false,
    });
  });

  it("el Super Admin no tiene negocio ni zona horaria y no depende del estado de ningún negocio", async () => {
    const row = {
      ...adminRow,
      role: "SUPER_ADMIN",
      business_id: null,
      access_status: null,
      time_zone: null,
    };

    expect(await loadSessionContext("u-1", fakeDb(row))).toMatchObject({
      role: "SUPER_ADMIN",
      businessId: null,
      businessTimeZone: null,
    });
  });

  it("marca la contraseña temporal pendiente", async () => {
    const row = { ...adminRow, status: "PENDIENTE_CAMBIO_CONTRASENA" };

    expect(await loadSessionContext("u-1", fakeDb(row))).toMatchObject({
      mustChangePassword: true,
    });
  });

  it("rechaza (403) sin perfil, bloqueado o negocio suspendido", async () => {
    expect(await codeOf(loadSessionContext("u-1", fakeDb(undefined)))).toBe("ACCESS_DENIED");
    expect(
      await codeOf(loadSessionContext("u-1", fakeDb({ ...adminRow, status: "BLOQUEADO" }))),
    ).toBe("USER_BLOCKED");
    expect(
      await codeOf(loadSessionContext("u-1", fakeDb({ ...adminRow, access_status: "SUSPENDIDO" }))),
    ).toBe("BUSINESS_SUSPENDED");
  });

  it("consulta por el id recibido (parametrizado)", async () => {
    const db = fakeDb(adminRow);
    await loadSessionContext("u-9", db);

    expect(db.query).toHaveBeenCalledWith(expect.stringContaining("where p.id = $1"), ["u-9"]);
  });
});

describe("authorizeSession", () => {
  const context: SessionContext = {
    userId: "u-1",
    role: "COBRADOR",
    businessId: "b-1",
    username: "cobrador.a",
    displayName: "Cobrador A",
    businessTimeZone: "America/Bogota",
    mustChangePassword: false,
  };

  it("sin restricciones deja pasar a cualquier rol", () => {
    expect(authorizeSession(context)).toBe(context);
  });

  it("acepta un rol permitido y rechaza uno no permitido con FORBIDDEN (403)", () => {
    expect(authorizeSession(context, { roles: ["COBRADOR", "ADMIN_NEGOCIO"] })).toBe(context);
    expect(() => authorizeSession(context, { roles: ["SUPER_ADMIN"] })).toThrowError(
      expect.objectContaining({ code: "FORBIDDEN", status: 403 }),
    );
  });

  it("bloquea todo con contraseña temporal pendiente salvo el cambio de contraseña", () => {
    const pending = { ...context, mustChangePassword: true };

    expect(() => authorizeSession(pending)).toThrowError(
      expect.objectContaining({ code: "PASSWORD_CHANGE_REQUIRED", status: 403 }),
    );
    expect(authorizeSession(pending, { allowPasswordChangePending: true })).toBe(pending);
  });

  it("con contraseña pendiente y rol incorrecto sigue rechazando por rol", () => {
    const pending = { ...context, mustChangePassword: true };

    expect(() =>
      authorizeSession(pending, { allowPasswordChangePending: true, roles: ["SUPER_ADMIN"] }),
    ).toThrowError(expect.objectContaining({ code: "FORBIDDEN" }));
  });
});
