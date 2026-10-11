import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";
import type { SessionContext } from "./session";

// getPageSession es navegación, no control de acceso (cada comando vuelve a autorizar), pero decide
// adónde va cada usuario y no debe disfrazar de redirección un fallo real.

class Redirect extends Error {
  constructor(readonly to: string) {
    super(`REDIRECT:${to}`);
  }
}

const requireSession = vi.fn();
vi.mock("./require-session", () => ({ requireSession }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));
// `cache` solo deduplica dentro de una petición real; aquí cada llamada es independiente.
vi.mock("react", () => ({ cache: <T>(fn: T) => fn }));

function context(overrides: Partial<SessionContext> = {}): SessionContext {
  return {
    userId: "u-1",
    role: "SUPER_ADMIN",
    businessId: null,
    username: "root",
    displayName: "Root",
    businessTimeZone: null,
    mustChangePassword: false,
    ...overrides,
  };
}

async function redirectTarget(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Redirect) return error.to;
    throw error;
  }
  return undefined;
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("getPageSession", () => {
  it("devuelve el contexto cuando el usuario puede ver la página", async () => {
    const { getPageSession } = await import("./page-session");
    requireSession.mockResolvedValue(context());

    await expect(getPageSession({ roles: ["SUPER_ADMIN"] })).resolves.toMatchObject({
      role: "SUPER_ADMIN",
    });
  });

  it("lleva al login cuando no hay sesión utilizable (sin sesión, bloqueado, negocio suspendido, sin perfil)", async () => {
    const { getPageSession } = await import("./page-session");

    for (const code of ["UNAUTHENTICATED", "USER_BLOCKED", "BUSINESS_SUSPENDED", "ACCESS_DENIED"]) {
      requireSession.mockRejectedValueOnce(new AppError(code, "x", 403));
      expect(await redirectTarget(getPageSession()), code).toBe("/login");
    }
  });

  it("un fallo real (Auth caído, error interno) se propaga: no se disfraza de redirección", async () => {
    const { getPageSession } = await import("./page-session");

    requireSession.mockRejectedValueOnce(new AppError("AUTH_UNAVAILABLE", "caído", 503));
    await expect(getPageSession()).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
    requireSession.mockRejectedValueOnce(new Error("boom"));
    await expect(getPageSession()).rejects.toThrow("boom");
  });

  it("con la contraseña temporal pendiente lleva al cambio; el área de otro rol, a la propia", async () => {
    const { getPageSession } = await import("./page-session");

    requireSession.mockResolvedValueOnce(context({ mustChangePassword: true }));
    expect(await redirectTarget(getPageSession({ roles: ["SUPER_ADMIN"] }))).toBe(
      "/cambiar-contrasena",
    );
    requireSession.mockResolvedValueOnce(context({ role: "COBRADOR", businessId: "b-1" }));
    expect(await redirectTarget(getPageSession({ roles: ["SUPER_ADMIN"] }))).toBe("/cobrador");
  });

  it("la pantalla de cambio de contraseña no la ve quien no la tiene pendiente", async () => {
    const { getPageSession } = await import("./page-session");

    requireSession.mockResolvedValueOnce(context({ role: "ADMIN_NEGOCIO", businessId: "b-1" }));
    expect(await redirectTarget(getPageSession({ requirePasswordChangePending: true }))).toBe(
      "/negocio",
    );
  });
});

describe("getOptionalPageSession", () => {
  it("devuelve el contexto, o el motivo cuando la sesión ya no sirve", async () => {
    const { getOptionalPageSession } = await import("./page-session");

    requireSession.mockResolvedValueOnce(context());
    expect(await getOptionalPageSession()).toMatchObject({ context: { role: "SUPER_ADMIN" } });

    requireSession.mockRejectedValueOnce(
      new AppError("USER_BLOCKED", "Tu usuario está bloqueado", 403),
    );
    expect(await getOptionalPageSession()).toEqual({
      denied: { code: "USER_BLOCKED", message: "Tu usuario está bloqueado" },
    });
    requireSession.mockRejectedValueOnce(new AppError("UNAUTHENTICATED", "Inicia sesión", 401));
    expect(await getOptionalPageSession()).toMatchObject({ denied: { code: "UNAUTHENTICATED" } });
  });

  it("un fallo real se propaga", async () => {
    const { getOptionalPageSession } = await import("./page-session");

    requireSession.mockRejectedValueOnce(new AppError("AUTH_UNAVAILABLE", "caído", 503));
    await expect(getOptionalPageSession()).rejects.toMatchObject({ code: "AUTH_UNAVAILABLE" });
  });
});
