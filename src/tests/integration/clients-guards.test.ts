import { afterAll, describe, expect, it } from "vitest";
import {
  CLIENT_PAGE_SIZE,
  getClientDetail,
  listClients,
  parseClientSearch,
} from "@/modules/portfolio/client-queries";
import { createClient, updateClient } from "@/modules/portfolio/clients";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Barreras de los clientes (F3-T3): carreras, aislamiento en la escritura, cobradores y búsqueda.

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());
const deps = { db: pool };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function newBusiness(): Promise<{ businessId: string; admin: SessionContext }> {
  const businessId = await fixtures.business("Clientes barreras");
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  return { businessId, admin: await loadSessionContext(account.userId, pool) };
}

const auditCount = async (businessId: string, action: string) =>
  Number(
    (
      await pool.query<{ n: string }>(
        "select count(*) as n from public.audit_events where business_id = $1 and action = $2",
        [businessId, action],
      )
    ).rows[0]!.n,
  );

describe("concurrencia", () => {
  it("dos altas simultáneas con la misma identificación: una se crea, la otra es un 409, un solo evento", async () => {
    const { businessId, admin } = await newBusiness();

    const outcomes = await Promise.allSettled(
      [1, 2].map(() => createClient(deps, admin, { name: "Ana", identification: "555" })),
    );

    expect(outcomes.filter((o) => o.status === "fulfilled")).toHaveLength(1);
    const rejected = outcomes.find((o) => o.status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ code: "CLIENT_IDENTIFICATION_EXISTS", status: 409 });
    expect(await auditCount(businessId, "ClienteCreado")).toBe(1);
  });

  it("dos ediciones simultáneas se serializan: ambas se auditan con el valor anterior correcto", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });

    await Promise.all([
      updateClient(deps, admin, client.id, { name: "Ana", phone: "300" }),
      updateClient(deps, admin, client.id, { name: "Ana", phone: "310" }),
    ]);

    const events = await pool.query<{
      summary: { changes: { phone: { from: string | null; to: string } } };
    }>(
      "select summary from public.audit_events where business_id = $1 and action = 'ClienteActualizado'",
      [businessId],
    );
    expect(events.rows).toHaveLength(2);
    // Encadenadas: el «desde» de una es el «a» de la otra (nadie pisó sin que quedara registro). El orden
    // de `occurred_at` es el de inicio de la transacción, no el de confirmación: se ordena por la cadena.
    const changes = events.rows.map((row) => row.summary.changes.phone);
    const first = changes.find((change) => change.from === null)!;
    const second = changes.find((change) => change.from !== null)!;
    expect(first).toBeDefined();
    expect(second.from).toBe(first.to);
    expect(new Set([first.to, second.to])).toEqual(new Set(["300", "310"]));
  });
});

describe("autorización y aislamiento", () => {
  it("un cobrador no lista ni consulta clientes, y su intento de editar deja un evento RECHAZADO", async () => {
    const { businessId, admin } = await newBusiness();
    const client = await createClient(deps, admin, { name: "Ana", identification: "1" });
    const collector = await loadSessionContext(
      (await fixtures.account({ role: "COBRADOR", businessId })).userId,
      pool,
    );

    await expect(listClients(pool, collector)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getClientDetail(pool, collector, client.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(updateClient(deps, collector, client.id, { name: "X" })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const rejected = await pool.query(
      "select actor_id from public.audit_events where business_id = $1 and action = 'ClienteActualizado' and result = 'RECHAZADO'",
      [businessId],
    );
    expect(rejected.rows).toEqual([{ actor_id: collector.userId }]);
    const row = await pool.query("select name from public.clients where id = $1", [client.id]);
    expect(row.rows[0]).toEqual({ name: "Ana" });
  });
});

describe("búsqueda", () => {
  it("descarta el byte nulo en vez de romper la consulta", async () => {
    const { admin } = await newBusiness();
    await createClient(deps, admin, { name: "Ana", identification: "1" });

    expect(parseClientSearch({ q: "a\0b" })).toBe("ab");
    expect(parseClientSearch({ q: "\0" })).toBeUndefined();
    expect(
      (await listClients(pool, admin, parseClientSearch({ q: "an\0a" }))).clients,
    ).toHaveLength(1);
  });

  it("limita la lista y avisa que hay más", async () => {
    const { businessId, admin } = await newBusiness();
    await pool.query(
      `insert into public.clients (business_id, name, identification, created_by)
       select $1, 'Cliente ' || lpad(n::text, 3, '0'), 'doc-' || n, $2 from generate_series(1, $3) as n`,
      [businessId, admin.userId, CLIENT_PAGE_SIZE + 5],
    );

    const { clients, truncated } = await listClients(pool, admin);

    expect(clients).toHaveLength(CLIENT_PAGE_SIZE);
    expect(truncated).toBe(true);
    expect(clients[0]!.name).toBe("Cliente 001");
  });
});
