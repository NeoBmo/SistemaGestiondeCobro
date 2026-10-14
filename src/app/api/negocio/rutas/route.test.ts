import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de rutas y asignaciones; el flujo real se cubre en integración (collectors.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const createRoute = vi.fn();
const closeRoute = vi.fn();
const assignClient = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/collections/routes", () => ({ createRoute, closeRoute }));
vi.mock("@/modules/collections/assignments", () => ({ assignClient }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const ID = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";
const OTHER = "7a1c3f20-2b44-4c66-8d1e-9f0a1b2c3d4e";

const request = (body?: unknown) =>
  new Request("https://app.cuadre.test/api/negocio/rutas", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

afterEach(() => vi.resetAllMocks());

describe("POST /api/negocio/rutas", () => {
  it("autoriza antes de validar, exige cobrador y nombre y crea (201)", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("./route");
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await POST(request({}))).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    createRoute.mockResolvedValue({ routeId: OTHER });
    for (const body of [{}, { collectorId: "x", name: "A" }, { collectorId: ID, name: " " }]) {
      expect((await POST(request(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await POST(request({ collectorId: ID, name: " Norte " }))).status).toBe(201);
    expect(createRoute).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { collectorId: ID, name: "Norte" },
    );
  });
});

describe("POST /api/negocio/rutas/[routeId]/cerrar", () => {
  it("autoriza primero, id inválido es 404 y cierra", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("./[routeId]/cerrar/route");
    const call = (routeId: string) => POST(request(), { params: Promise.resolve({ routeId }) });
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await call("no-uuid")).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    closeRoute.mockResolvedValue({ routeId: ID });
    expect((await call("no-uuid")).status).toBe(404);
    expect((await call(ID)).status).toBe(200);
  });
});

describe("POST /api/negocio/asignaciones", () => {
  it("autoriza antes de validar y exige cliente y ruta", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("../asignaciones/route");
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await POST(request({}))).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    assignClient.mockResolvedValue({ assignmentId: OTHER });
    expect((await POST(request({ clientId: ID }))).status).toBe(400);
    expect((await POST(request({ clientId: ID, routeId: OTHER, businessId: "x" }))).status).toBe(
      201,
    );
    expect(assignClient).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { clientId: ID, routeId: OTHER },
    );
  });
});
