import { afterEach, describe, expect, it, vi } from "vitest";
import { AppError } from "@/shared/errors/app-error";

// Orden y mapeo HTTP de las rutas de tickets; el flujo real se cubre en integración (tickets.test.ts).

const requireSession = vi.fn();
const authorizeBusinessAdmin = vi.fn();
const createTicket = vi.fn();
const closeOrReopenTicket = vi.fn();
const attendTicket = vi.fn();

vi.mock("@/modules/identity/require-session", () => ({ requireSession }));
vi.mock("@/modules/identity/authorize-business-admin", () => ({ authorizeBusinessAdmin }));
vi.mock("@/modules/support/tickets", () => ({ createTicket, closeOrReopenTicket, attendTicket }));
vi.mock("@/shared/database/pg-pool", () => ({ getPool: () => "pool" }));

const ID = "4f9d2d7e-1c34-4a55-9b0e-8c2d1e7f6a10";

const request = (body?: unknown) =>
  new Request("https://app.cuadre.test/api/x", {
    method: "POST",
    headers: { "content-type": "application/json", "sec-fetch-site": "same-origin" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

afterEach(() => vi.resetAllMocks());

describe("POST /api/negocio/tickets", () => {
  it("autoriza antes de validar, exige descripción y prioridad válida y crea (201)", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    const { POST } = await import("./route");
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await POST(request({}))).status).toBe(403);
    expect(createTicket).not.toHaveBeenCalled();

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    createTicket.mockResolvedValue({ ticketId: ID, priority: "MEDIA" });
    for (const body of [{}, { description: "  " }, { description: "x", priority: "URGENTE" }]) {
      expect((await POST(request(body))).status, JSON.stringify(body)).toBe(400);
    }
    expect((await POST(request({ description: " Falla ", businessId: "otro" }))).status).toBe(201);
    expect(createTicket).toHaveBeenCalledWith(
      { db: "pool" },
      { userId: "u" },
      { description: "Falla", priority: "MEDIA" },
    );
  });
});

describe("POST /api/negocio/tickets/[ticketId]/[action]", () => {
  const call = async (ticketId: string, action: string) => {
    const { POST } = await import("./[ticketId]/[action]/route");
    return POST(request({}), { params: Promise.resolve({ ticketId, action }) });
  };

  it("autoriza primero; id o acción inválidos son 404; cerrar y reabrir llaman al comando", async () => {
    requireSession.mockResolvedValue({ userId: "u" });
    authorizeBusinessAdmin.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await call("no-uuid", "cerrar")).status).toBe(403);

    authorizeBusinessAdmin.mockResolvedValue("b-1");
    closeOrReopenTicket.mockResolvedValue({ ticketId: ID, status: "CERRADO" });
    expect((await call("no-uuid", "cerrar")).status).toBe(404);
    expect((await call(ID, "borrar")).status).toBe(404);
    expect((await call(ID, "constructor")).status).toBe(404);
    expect((await call(ID, "cerrar")).status).toBe(200);
    expect((await call(ID, "reabrir")).status).toBe(200);
    expect(closeOrReopenTicket).toHaveBeenNthCalledWith(
      1,
      { db: "pool" },
      { userId: "u" },
      ID,
      "cerrar",
    );
    expect(closeOrReopenTicket).toHaveBeenNthCalledWith(
      2,
      { db: "pool" },
      { userId: "u" },
      ID,
      "reabrir",
    );
  });
});

describe("POST /api/super-admin/tickets/[ticketId]", () => {
  const call = async (ticketId: string, body: unknown) => {
    const { POST } = await import("../../super-admin/tickets/[ticketId]/route");
    return POST(request(body), { params: Promise.resolve({ ticketId }) });
  };

  it("exige Super Admin, id válido y al menos un cambio válido", async () => {
    requireSession.mockRejectedValueOnce(new AppError("FORBIDDEN", "No", 403));
    expect((await call(ID, { response: "x" })).status).toBe(403);

    requireSession.mockResolvedValue({ userId: "root" });
    attendTicket.mockResolvedValue({ ticketId: ID, changed: ["response"] });
    expect((await call("no-uuid", { response: "x" })).status).toBe(404);
    for (const body of [
      {},
      { status: "CERRADO" },
      { status: "ABIERTO" },
      { priority: "URGENTE" },
      { response: " " },
    ]) {
      expect((await call(ID, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call(ID, { status: "RESUELTO", response: " Listo " })).status).toBe(200);
    expect(attendTicket).toHaveBeenCalledWith({ db: "pool" }, { userId: "root" }, ID, {
      status: "RESUELTO",
      response: "Listo",
    });
  });
});
