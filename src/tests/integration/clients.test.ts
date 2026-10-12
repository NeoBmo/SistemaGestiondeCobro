import { afterAll, describe, expect, it } from "vitest";
import { listClients, getClientDetail } from "@/modules/portfolio/client-queries";
import { createClient, updateClient } from "@/modules/portfolio/clients";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { AppError } from "@/shared/errors/app-error";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F3-T3 (02 §2.1): alta y edición de clientes con auditoría, identificación única por negocio,
// aislamiento entre negocios y búsqueda.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function newBusiness(): Promise<{ businessId: string; admin: SessionContext }> {
  const businessId = await fixtures.business("Clientes");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  return { businessId, admin: await loadSessionContext(account.userId, pool) };
}

async function failureOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof AppError) return error;
    throw error;
  }
  throw new Error("se esperaba un AppError");
}

const audit = async (businessId: string, action: string) =>
  (
    await pool.query<{ entity_id: string; result: string; summary: Record<string, unknown> }>(
      "select entity_id, result, summary from public.audit_events where business_id = $1 and action = $2 order by occurred_at",
      [businessId, action],
    )
  ).rows;

describe("alta de clientes", () => {
  it("crea el cliente en el negocio de la sesión y deja su auditoría", async () => {
    const { businessId, admin } = await newBusiness();

    const client = await createClient(deps, admin, {
      name: "Ana Pérez",
      identification: "12345",
      phone: "3001234567",
    });

    expect(client).toMatchObject({
      name: "Ana Pérez",
      identification: "12345",
      phone: "3001234567",
    });
    const row = await pool.query(
      "select business_id, created_by from public.clients where id = $1",
      [client.id],
    );
    expect(row.rows[0]).toEqual({ business_id: businessId, created_by: admin.userId });
    expect(await audit(businessId, "ClienteCreado")).toEqual([
      {
        entity_id: client.id,
        result: "OK",
        summary: { name: "Ana Pérez", identification: "12345" },
      },
    ]);
  });

  it("la identificación es única por negocio (409), pero se puede repetir en otro negocio", async () => {
    const one = await newBusiness();
    const two = await newBusiness();
    await createClient(deps, one.admin, { name: "Ana", identification: "777" });

    const duplicate = await failureOf(
      createClient(deps, one.admin, { name: "Otra Ana", identification: "777" }),
    );
    expect(duplicate).toMatchObject({ code: "CLIENT_IDENTIFICATION_EXISTS", status: 409 });
    expect(await audit(one.businessId, "ClienteCreado")).toHaveLength(1);

    expect(
      await createClient(deps, two.admin, { name: "Ana", identification: "777" }),
    ).toBeTruthy();
  });

  it("un cobrador recibe 403 con evento RECHAZADO y no crea nada; el Super Admin, 403 sin evento", async () => {
    const { businessId } = await newBusiness();
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId })).userId,
      pool,
    );
    const superAdmin = await loadSessionContext(
      (await fixtures.account({ role: "SUPER_ADMIN", businessId: null })).userId,
      pool,
    );

    expect(
      await failureOf(createClient(deps, collector, { name: "X", identification: "1" })),
    ).toMatchObject({ code: "FORBIDDEN" });
    expect(
      await failureOf(createClient(deps, superAdmin, { name: "X", identification: "1" })),
    ).toMatchObject({ code: "FORBIDDEN" });

    const clients = await pool.query("select 1 from public.clients where business_id = $1", [
      businessId,
    ]);
    expect(clients.rowCount).toBe(0);
    expect(await audit(businessId, "ClienteCreado")).toEqual([
      expect.objectContaining({ result: "RECHAZADO" }),
    ]);
  });
});

describe("edición de clientes", () => {
  it("cambia el contacto y audita qué campos cambiaron, con su valor anterior y el nuevo", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, {
      name: "Ana",
      identification: "1",
      phone: "300",
      notes: "Vive en la esquina",
    });

    const result = await updateClient(deps, admin, client.id, {
      name: "Ana María",
      phone: "310",
      whatsapp: "310",
    });

    expect(result.changed).toEqual(["name", "phone", "whatsapp", "notes"]);
    expect(result.client).toMatchObject({
      name: "Ana María",
      phone: "310",
      whatsapp: "310",
      notes: null,
      identification: "1",
    });
    expect(await audit(businessId, "ClienteActualizado")).toEqual([
      {
        entity_id: client.id,
        result: "OK",
        summary: {
          changes: {
            name: { from: "Ana", to: "Ana María" },
            phone: { from: "300", to: "310" },
            whatsapp: { from: null, to: "310" },
            notes: { from: "Vive en la esquina", to: null },
          },
        },
      },
    ]);
  });

  it("sin cambios no escribe ni audita", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });

    const result = await updateClient(deps, admin, client.id, { name: "Ana" });

    expect(result.changed).toEqual([]);
    expect(await audit(businessId, "ClienteActualizado")).toEqual([]);
  });

  it("un cliente de otro negocio es «no encontrado» y no se modifica", async () => {
    const mine = await newBusiness();
    const other = await newBusiness();
    const foreign = await createClient(deps, other.admin, { name: "Ajeno", identification: "9" });

    const error = await failureOf(updateClient(deps, mine.admin, foreign.id, { name: "Hackeado" }));

    expect(error).toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    const row = await pool.query("select name from public.clients where id = $1", [foreign.id]);
    expect(row.rows[0]).toEqual({ name: "Ajeno" });
  });

  it("un cobrador no edita clientes", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId })).userId,
      pool,
    );

    expect(await failureOf(updateClient(deps, collector, client.id, { name: "X" }))).toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("consulta de clientes", () => {
  it("lista solo los del negocio, ordenados por nombre, y busca por nombre, sobrenombre, documento y teléfono", async () => {
    const one = await newBusiness();
    const two = await newBusiness();
    await createClient(deps, one.admin, {
      name: "Zoila",
      identification: "10",
      phone: "3001112222",
    });
    await createClient(deps, one.admin, {
      name: "Andrés",
      nickname: "El Flaco",
      identification: "20",
    });
    await createClient(deps, two.admin, { name: "Ajeno", identification: "30" });

    const all = await listClients(pool, one.admin);
    expect(all.clients.map((c) => c.name)).toEqual(["Andrés", "Zoila"]);
    expect(all.truncated).toBe(false);

    for (const [term, expected] of [
      ["zoi", ["Zoila"]],
      ["FLACO", ["Andrés"]],
      ["20", ["Andrés"]],
      ["1112", ["Zoila"]],
      ["%", []],
      ["_", []],
      ["ajeno", []],
    ] as const) {
      const found = await listClients(pool, one.admin, term);
      expect(
        found.clients.map((c) => c.name),
        term,
      ).toEqual(expected);
    }
  });

  it("la ficha trae los datos del cliente y es nula para otro negocio o un id inválido", async () => {
    const one = await newBusiness();
    const two = await newBusiness();
    const client = await createClient(deps, one.admin, { name: "Ana", identification: "1" });

    expect((await getClientDetail(pool, one.admin, client.id))?.client.name).toBe("Ana");
    expect((await getClientDetail(pool, one.admin, client.id))?.loans).toEqual([]);
    expect(await getClientDetail(pool, two.admin, client.id)).toBeNull();
    expect(await getClientDetail(pool, one.admin, "no-es-uuid")).toBeNull();
  });
});
