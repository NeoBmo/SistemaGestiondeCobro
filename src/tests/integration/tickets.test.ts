import { afterAll, describe, expect, it } from "vitest";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { countOpenTickets, getTicket, listTickets } from "@/modules/support/queries";
import { attendTicket, closeOrReopenTicket, createTicket } from "@/modules/support/tickets";
import { AppError } from "@/shared/errors/app-error";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F7-T3 (02 §6.2, ADR 0011): el Admin crea y cierra tickets de su negocio; el Super Admin los atiende y el
// historial se conserva.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

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

async function business(): Promise<{ businessId: string; admin: SessionContext }> {
  const businessId = await fixtures.business("Soporte");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  return { businessId, admin: await loadSessionContext(account.userId, pool) };
}

async function superAdmin(): Promise<SessionContext> {
  const account = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
  return loadSessionContext(account.userId, pool);
}

const open = (admin: SessionContext, priority: "ALTA" | "MEDIA" | "BAJA" = "MEDIA") =>
  createTicket(deps, admin, { description: "No puedo registrar un pago", priority });

describe("crear y ver", () => {
  it("el Admin crea un ticket de su negocio con su evento y auditoría; solo su negocio lo ve", async () => {
    const mine = await business();
    const other = await business();
    const root = await superAdmin();

    const created = await open(mine.admin, "ALTA");

    const detail = await getTicket(pool, mine.admin, created.ticketId);
    expect(detail).toMatchObject({ status: "ABIERTO", priority: "ALTA", response: null });
    expect(detail!.events.map((e) => e.kind)).toEqual(["CREADO"]);
    expect((await listTickets(pool, mine.admin)).map((t) => t.id)).toEqual([created.ticketId]);
    // Otro negocio no lo ve ni lo lee; el Super Admin sí.
    expect(await listTickets(pool, other.admin)).toEqual([]);
    expect(await getTicket(pool, other.admin, created.ticketId)).toBeNull();
    expect((await getTicket(pool, root, created.ticketId))!.businessName).toContain("Soporte");
    const audit = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'TicketCreado' and entity_id = $2",
      [mine.businessId, created.ticketId],
    );
    expect(audit.rowCount).toBe(1);
  });

  it("un cobrador no crea ni lee tickets y el Super Admin no crea los de un negocio", async () => {
    const w = await business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: w.businessId });
    const collector = await loadSessionContext(account.userId, pool);
    const root = await superAdmin();

    expect(await failureOf(open(collector))).toMatchObject({ status: 403 });
    expect(await failureOf(open(root))).toMatchObject({ status: 403 });
    await expect(listTickets(pool, collector)).rejects.toMatchObject({ status: 403 });
  });

  it("la lista pone primero los abiertos de mayor prioridad y filtra por estado y prioridad", async () => {
    const w = await business();
    const low = await open(w.admin, "BAJA");
    const high = await open(w.admin, "ALTA");
    const mid = await open(w.admin, "MEDIA");
    const root = await superAdmin();
    await attendTicket(deps, root, mid.ticketId, { status: "RESUELTO" });
    await closeOrReopenTicket(deps, w.admin, mid.ticketId, "cerrar");

    const all = await listTickets(pool, w.admin);

    expect(all.map((t) => t.id)).toEqual([high.ticketId, low.ticketId, mid.ticketId]);
    expect((await listTickets(pool, w.admin, { status: "CERRADO" })).map((t) => t.id)).toEqual([
      mid.ticketId,
    ]);
    expect((await listTickets(pool, w.admin, { priority: "BAJA" })).map((t) => t.id)).toEqual([
      low.ticketId,
    ]);
  });
});

describe("atender", () => {
  it("el Super Admin cambia estado, prioridad y respuesta; cada cambio deja su evento y se conserva el historial", async () => {
    const w = await business();
    const root = await superAdmin();
    const { ticketId } = await open(w.admin);

    const first = await attendTicket(deps, root, ticketId, {
      status: "EN_ATENCION",
      priority: "ALTA",
      response: "Lo estamos revisando",
    });
    expect(first).toMatchObject({
      changed: ["status", "priority", "response"],
      status: "EN_ATENCION",
      priority: "ALTA",
    });
    await attendTicket(deps, root, ticketId, {
      response: "Era un problema de red",
      status: "RESUELTO",
    });

    const detail = await getTicket(pool, w.admin, ticketId);
    expect(detail).toMatchObject({
      status: "RESUELTO",
      priority: "ALTA",
      response: "Era un problema de red",
    });
    // La respuesta anterior sigue en su evento aunque el ticket guarde solo la vigente.
    const responses = detail!.events.filter((e) => e.kind === "RESPUESTA");
    expect(responses.map((e) => e.to)).toEqual(["Lo estamos revisando", "Era un problema de red"]);
    expect(responses[1]!.from).toBe("Lo estamos revisando");
    expect(detail!.events.map((e) => e.kind)).toEqual([
      "CREADO",
      "ESTADO",
      "PRIORIDAD",
      "RESPUESTA",
      "ESTADO",
      "RESPUESTA",
    ]);
    expect(detail!.events.filter((e) => e.kind === "ESTADO").map((e) => e.actorRole)).toEqual([
      "SUPER_ADMIN",
      "SUPER_ADMIN",
    ]);
  });

  it("si no cambia nada no se escribe; un estado hacia atrás o repetido se rechaza", async () => {
    const w = await business();
    const root = await superAdmin();
    const { ticketId } = await open(w.admin, "MEDIA");
    await attendTicket(deps, root, ticketId, { status: "RESUELTO", response: "Listo" });
    const events = async () =>
      (
        await pool.query(
          "select count(*)::int as n from public.support_ticket_events where ticket_id = $1",
          [ticketId],
        )
      ).rows[0]!.n;
    const before = await events();

    const same = await attendTicket(deps, root, ticketId, {
      status: "RESUELTO",
      priority: "MEDIA",
      response: "Listo",
    });

    expect(same.changed).toEqual([]);
    expect(await events()).toBe(before);
    expect(
      await failureOf(attendTicket(deps, root, ticketId, { status: "EN_ATENCION" })),
    ).toMatchObject({
      code: "TICKET_INVALID_TRANSITION",
      status: 409,
    });
  });

  it("solo el Super Admin atiende: el Admin recibe 403 con evento RECHAZADO y un ticket ajeno o inexistente no se revela", async () => {
    const w = await business();
    const other = await business();
    const { ticketId } = await open(w.admin);

    expect(
      await failureOf(attendTicket(deps, w.admin, ticketId, { response: "yo mismo" })),
    ).toMatchObject({
      status: 403,
    });
    expect(
      await failureOf(attendTicket(deps, other.admin, ticketId, { priority: "ALTA" })),
    ).toMatchObject({
      status: 403,
    });
    const missing = "00000000-0000-4000-8000-000000000000";
    expect(
      await failureOf(attendTicket(deps, other.admin, missing, { priority: "ALTA" })),
    ).toMatchObject({
      status: 403,
    });
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and action = 'TicketAtendido' and result = 'RECHAZADO'",
      [w.businessId],
    );
    expect(rejected.rowCount).toBeGreaterThan(0);
    expect((await getTicket(pool, w.admin, ticketId))!.status).toBe("ABIERTO");
    expect(
      await failureOf(attendTicket(deps, await superAdmin(), missing, { priority: "ALTA" })),
    ).toMatchObject({
      status: 404,
    });
  });
});

describe("cerrar y reabrir", () => {
  it("el Admin cierra un ticket resuelto (final) o lo reabre; no uno sin resolver ni de otro negocio", async () => {
    const w = await business();
    const other = await business();
    const root = await superAdmin();
    const { ticketId } = await open(w.admin);

    expect(await failureOf(closeOrReopenTicket(deps, w.admin, ticketId, "cerrar"))).toMatchObject({
      code: "TICKET_NOT_RESOLVED",
    });
    await attendTicket(deps, root, ticketId, { status: "RESUELTO", response: "Probá de nuevo" });
    expect(
      await failureOf(closeOrReopenTicket(deps, other.admin, ticketId, "cerrar")),
    ).toMatchObject({
      code: "TICKET_NOT_FOUND",
      status: 404,
    });

    expect(await closeOrReopenTicket(deps, w.admin, ticketId, "reabrir")).toMatchObject({
      status: "ABIERTO",
    });
    await attendTicket(deps, root, ticketId, { status: "RESUELTO" });
    expect(await closeOrReopenTicket(deps, w.admin, ticketId, "cerrar")).toMatchObject({
      status: "CERRADO",
    });

    // CERRADO es final: ni el Admin ni el Super Admin lo modifican.
    expect(await failureOf(closeOrReopenTicket(deps, w.admin, ticketId, "reabrir"))).toMatchObject({
      code: "TICKET_NOT_RESOLVED",
    });
    expect(
      await failureOf(attendTicket(deps, root, ticketId, { response: "tarde" })),
    ).toMatchObject({
      code: "TICKET_CLOSED",
    });
    const kinds = (await getTicket(pool, w.admin, ticketId))!.events.map(
      (e) => `${e.kind}:${e.to}`,
    );
    expect(kinds).toEqual([
      "CREADO:MEDIA",
      "ESTADO:RESUELTO",
      "RESPUESTA:Probá de nuevo",
      "ESTADO:ABIERTO",
      "ESTADO:RESUELTO",
      "ESTADO:CERRADO",
    ]);
  });

  it("un cobrador no cierra tickets", async () => {
    const w = await business();
    const account = await fixtures.account({ role: "COBRADOR", businessId: w.businessId });
    const collector = await loadSessionContext(account.userId, pool);
    const { ticketId } = await open(w.admin);

    expect(await failureOf(closeOrReopenTicket(deps, collector, ticketId, "cerrar"))).toMatchObject(
      {
        status: 403,
      },
    );
  });
});

describe("indicador de tickets abiertos", () => {
  it("cuenta por prioridad los que no están cerrados, de todos los negocios", async () => {
    const a = await business();
    const b = await business();
    const root = await superAdmin();
    const before = await countOpenTickets(pool, root);
    await open(a.admin, "ALTA");
    await open(b.admin, "ALTA");
    await open(b.admin, "BAJA");
    const done = await open(a.admin, "BAJA");
    await attendTicket(deps, root, done.ticketId, { status: "RESUELTO" });
    await closeOrReopenTicket(deps, a.admin, done.ticketId, "cerrar");

    const after = await countOpenTickets(pool, root);

    expect(after.ALTA - before.ALTA).toBe(2);
    expect(after.BAJA - before.BAJA).toBe(1);
    await expect(countOpenTickets(pool, a.admin)).rejects.toMatchObject({ status: 403 });
  });
});
