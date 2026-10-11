import { describe, expect, it } from "vitest";
import {
  decidePageAccess,
  homePathFor,
  redirectForSessionError,
  type PageAccessOptions,
} from "./page-access";
import type { Role, SessionContext } from "./session";

// Qué ve cada rol y cuándo se redirige (02-DOMINIO §1.4 y §8): la contraseña temporal pendiente
// bloquea todo salvo cambiarla; cada rol solo entra a su área.

function context(role: Role, mustChangePassword = false): SessionContext {
  return {
    userId: "u-1",
    role,
    businessId: role === "SUPER_ADMIN" ? null : "b-1",
    username: "usuario",
    displayName: "Usuario",
    businessTimeZone: role === "SUPER_ADMIN" ? null : "America/Bogota",
    mustChangePassword,
  };
}

describe("homePathFor", () => {
  it("lleva a cada rol a su área", () => {
    expect(homePathFor("SUPER_ADMIN")).toBe("/super-admin");
    expect(homePathFor("ADMIN_NEGOCIO")).toBe("/negocio");
    expect(homePathFor("COBRADOR")).toBe("/cobrador");
  });
});

describe("decidePageAccess", () => {
  const allow = { kind: "allow" };

  it("permite el área propia", () => {
    const options: PageAccessOptions = { roles: ["SUPER_ADMIN"] };

    expect(decidePageAccess(context("SUPER_ADMIN"), options)).toEqual(allow);
  });

  it("sin restricción de rol permite a cualquiera con la contraseña al día", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN_NEGOCIO", "COBRADOR"] as const) {
      expect(decidePageAccess(context(role), {})).toEqual(allow);
    }
  });

  it("redirige a cada rol a su propia área si entra a la de otro", () => {
    expect(decidePageAccess(context("ADMIN_NEGOCIO"), { roles: ["SUPER_ADMIN"] })).toEqual({
      kind: "redirect",
      to: "/negocio",
    });
    expect(decidePageAccess(context("COBRADOR"), { roles: ["ADMIN_NEGOCIO"] })).toEqual({
      kind: "redirect",
      to: "/cobrador",
    });
    expect(decidePageAccess(context("SUPER_ADMIN"), { roles: ["COBRADOR"] })).toEqual({
      kind: "redirect",
      to: "/super-admin",
    });
  });

  it("con la contraseña temporal pendiente todo lleva al cambio, sea cual sea el rol de la página", () => {
    for (const role of ["SUPER_ADMIN", "ADMIN_NEGOCIO", "COBRADOR"] as const) {
      expect(decidePageAccess(context(role, true), { roles: ["SUPER_ADMIN"] })).toEqual({
        kind: "redirect",
        to: "/cambiar-contrasena",
      });
    }
  });

  it("la pantalla de cambio solo la ve quien lo tiene pendiente; los demás vuelven a su área", () => {
    const options: PageAccessOptions = { requirePasswordChangePending: true };

    expect(decidePageAccess(context("COBRADOR", true), options)).toEqual(allow);
    expect(decidePageAccess(context("COBRADOR", false), options)).toEqual({
      kind: "redirect",
      to: "/cobrador",
    });
    expect(decidePageAccess(context("SUPER_ADMIN", false), options)).toEqual({
      kind: "redirect",
      to: "/super-admin",
    });
  });
});

describe("redirectForSessionError", () => {
  it("sin sesión o sin acceso vigente lleva al login (que explica el motivo)", () => {
    for (const code of ["UNAUTHENTICATED", "ACCESS_DENIED", "USER_BLOCKED", "BUSINESS_SUSPENDED"]) {
      expect(redirectForSessionError(code), code).toBe("/login");
    }
  });

  it("cualquier otro error no se convierte en redirección (es un fallo real)", () => {
    for (const code of ["INTERNAL_ERROR", "AUTH_UNAVAILABLE", "INVALID_ENV", ""]) {
      expect(redirectForSessionError(code), code).toBeNull();
    }
  });
});
