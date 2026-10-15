import type pg from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  asApiUser,
  createBusiness,
  createProfile,
  createSubscription,
  resetApiUser,
} from "./helpers/identity";

// F7-T2 (02 §6.2, ADR 0011): tickets con historial de solo agregado y tablas de monitoreo.

const pool = createTestPool();
afterAll(() => pool.end());

const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";
const FOREIGN_KEY_VIOLATION = "23503";

let counter = 0;
const next = () => ++counter;

async function world(client: pg.PoolClient) {
  const business = await createBusiness(client, `Negocio ${next()}`);
  await createSubscription(client, business);
  const admin = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: business,
    username: `admin.${next()}`,
  });
  const superAdmin = await createProfile(client, {
    role: "SUPER_ADMIN",
    businessId: null,
    username: `super.${next()}`,
  });
  return { business, admin, superAdmin };
}

/** Un ticket nuevo con su evento CREADO, como lo crea el comando. */
async function ticket(client: pg.PoolClient, w: Awaited<ReturnType<typeof world>>) {
  const { rows } = await client.query<{ id: string }>(
    `insert into public.support_tickets (business_id, created_by, description)
     values ($1, $2, 'No puedo registrar un pago') returning id`,
    [w.business, w.admin],
  );
  const id = rows[0]!.id;
  await event(client, w, id, "CREADO", null, "MEDIA", w.admin);
  return id;
}

const event = (
  client: pg.PoolClient,
  w: { business: string },
  ticketId: string,
  kind: string,
  from: string | null,
  to: string | null,
  actor: string,
) =>
  client.query(
    `insert into public.support_ticket_events (business_id, ticket_id, actor_id, kind, from_value, to_value)
     values ($1, $2, $3, $4, $5, $6)`,
    [w.business, ticketId, actor, kind, from, to],
  );

const check = (client: pg.PoolClient) => attempt(client, "set constraints all immediate");

describe("tickets", () => {
  it("un ticket nuevo exige su evento CREADO (el historial no queda incompleto)", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      await client.query(
        "insert into public.support_tickets (business_id, created_by, description) values ($1, $2, 'Sin evento')",
        [w.business, w.admin],
      );
      expect((await check(client))?.code).toBe(CHECK_VIOLATION);
    });
    await withRollback(pool, async (client) => {
      const w = await world(client);
      await ticket(client, w);
      expect(await check(client)).toBeNull();
    });
  });

  it("valida la descripción, la prioridad y que el creador sea del mismo negocio", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const other = await world(client);
      const insert = (description: string, priority: string, creator: string, business: string) =>
        attempt(
          client,
          "insert into public.support_tickets (business_id, created_by, description, priority) values ($1, $2, $3, $4)",
          [business, creator, description, priority],
        );
      expect((await insert("  ", "MEDIA", w.admin, w.business))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("x", "URGENTE", w.admin, w.business))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("x", "ALTA", w.admin, other.business))?.code).toBe(
        FOREIGN_KEY_VIOLATION,
      );
      expect((await insert("x".repeat(2001), "ALTA", w.admin, w.business))?.code).toBe(
        CHECK_VIOLATION,
      );
    });
  });

  it("el estado avanza solo por las transiciones permitidas y CERRADO es final", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const id = await ticket(client, w);
      const move = async (from: string, to: string) => {
        const error = await attempt(
          client,
          "update public.support_tickets set status = $2 where id = $1",
          [id, to],
        );
        if (!error) await event(client, w, id, "ESTADO", from, to, w.superAdmin);
        return error;
      };

      expect((await move("ABIERTO", "CERRADO"))?.code).toBe(RESTRICT_VIOLATION);
      expect(await move("ABIERTO", "EN_ATENCION")).toBeNull();
      expect((await move("EN_ATENCION", "ABIERTO"))?.code).toBe(RESTRICT_VIOLATION);
      expect(await move("EN_ATENCION", "RESUELTO")).toBeNull();
      // El Admin reabre o cierra un ticket resuelto.
      expect(await move("RESUELTO", "ABIERTO")).toBeNull();
      expect(await move("ABIERTO", "RESUELTO")).toBeNull();
      expect(await move("RESUELTO", "CERRADO")).toBeNull();
      expect((await move("CERRADO", "ABIERTO"))?.code).toBe(RESTRICT_VIOLATION);
      expect(await check(client)).toBeNull();
      // Un ticket cerrado no cambia de prioridad ni de respuesta.
      for (const statement of [
        "update public.support_tickets set priority = 'ALTA'",
        "update public.support_tickets set response = 'tarde'",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }
    });
  });

  it("cada cambio de estado, prioridad o respuesta exige su evento en la misma transacción", async () => {
    for (const [statement, kind, to] of [
      ["update public.support_tickets set status = 'EN_ATENCION'", "ESTADO", "EN_ATENCION"],
      ["update public.support_tickets set priority = 'ALTA'", "PRIORIDAD", "ALTA"],
      ["update public.support_tickets set response = 'Revisando'", "RESPUESTA", "Revisando"],
    ] as const) {
      await withRollback(pool, async (client) => {
        const w = await world(client);
        const id = await ticket(client, w);
        await client.query("set constraints all immediate");
        await client.query("set constraints all deferred");
        await client.query(`${statement} where id = '${id}'`);
        // Sin evento: se rechaza.
        expect((await check(client))?.code, statement).toBe(CHECK_VIOLATION);
      });
      await withRollback(pool, async (client) => {
        const w = await world(client);
        const id = await ticket(client, w);
        await client.query("set constraints all immediate");
        await client.query("set constraints all deferred");
        await client.query(`${statement} where id = '${id}'`);
        await event(client, w, id, kind, null, to, w.superAdmin);
        expect(await check(client), statement).toBeNull();
      });
    }
  });

  it("solo el estado vigente cambia: la descripción, el creador y el negocio son fijos y nada se borra", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      const id = await ticket(client, w);
      for (const statement of [
        `update public.support_tickets set description = 'otra' where id = '${id}'`,
        `update public.support_tickets set created_by = '${w.superAdmin}' where id = '${id}'`,
        `update public.support_tickets set created_at = now() - interval '1 day' where id = '${id}'`,
        "delete from public.support_tickets",
        "delete from public.support_ticket_events",
        "update public.support_ticket_events set to_value = 'x'",
        "truncate public.support_tickets",
      ]) {
        const error = await attempt(client, statement);
        expect([RESTRICT_VIOLATION, "0A000", "55006"], statement).toContain(error?.code);
      }
    });
  });

  it("un evento de otro negocio no se cuelga del ticket", async () => {
    await withRollback(pool, async (client) => {
      const a = await world(client);
      const b = await world(client);
      const id = await ticket(client, a);
      expect(
        (
          await attempt(
            client,
            "insert into public.support_ticket_events (business_id, ticket_id, actor_id, kind) values ($1, $2, $3, 'RESPUESTA')",
            [b.business, id, b.superAdmin],
          )
        )?.code,
      ).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("monitoreo", () => {
  it("valida los registros y son de solo agregado", async () => {
    await withRollback(pool, async (client) => {
      const w = await world(client);
      expect(
        await attempt(
          client,
          "insert into public.platform_events (kind, route) values ('ERROR_500', '/api/x')",
        ),
      ).toBeNull();
      expect(
        (
          await attempt(
            client,
            "insert into public.platform_events (kind, route) values ('OTRO', '/api/x')",
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      expect(
        await attempt(
          client,
          "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values (true, true, true, 12)",
        ),
      ).toBeNull();
      expect(
        await attempt(
          client,
          "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values (false, true, false, 900)",
        ),
      ).toBeNull();
      // `ok` no puede contradecir sus componentes ni la latencia ser negativa.
      expect(
        (
          await attempt(
            client,
            "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values (true, true, false, 5)",
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(
        (
          await attempt(
            client,
            "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values (true, true, true, -1)",
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      expect(
        await attempt(
          client,
          "insert into public.backup_checks (checked_on, result, registered_by) values (current_date, 'OK', $1)",
          [w.superAdmin],
        ),
      ).toBeNull();
      expect(
        (
          await attempt(
            client,
            "insert into public.backup_checks (checked_on, result, registered_by) values (current_date, 'TAL VEZ', $1)",
            [w.superAdmin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);

      for (const statement of [
        "update public.platform_events set route = 'x'",
        "delete from public.health_checks",
        "update public.backup_checks set result = 'FALLO'",
        "truncate public.platform_events",
      ]) {
        const error = await attempt(client, statement);
        expect([RESTRICT_VIOLATION, "0A000", "55006"], statement).toContain(error?.code);
      }
    });
  });
});

describe("acceso por la API de datos", () => {
  it("el Admin ve solo los tickets de su negocio, el Super Admin todo y el cobrador nada; sin escrituras", async () => {
    await withRollback(pool, async (client) => {
      const a = await world(client);
      const b = await world(client);
      const collector = await createProfile(client, {
        role: "COBRADOR",
        businessId: a.business,
        username: `cob.${next()}`,
      });
      await ticket(client, a);
      await ticket(client, b);
      await client.query(
        "insert into public.platform_events (kind, route) values ('ERROR_500', '/api/x')",
      );
      await client.query(
        "insert into public.health_checks (ok, database_ok, auth_ok, latency_ms) values (true, true, true, 10)",
      );
      await client.query(
        "insert into public.backup_checks (checked_on, result, registered_by) values (current_date, 'OK', $1)",
        [a.superAdmin],
      );

      const count = async (table: string) =>
        (await client.query<{ n: string }>(`select count(*)::text as n from public.${table}`))
          .rows[0]!.n;
      const tables = [
        "support_tickets",
        "support_ticket_events",
        "platform_events",
        "health_checks",
        "backup_checks",
      ];

      await asApiUser(client, { sub: a.admin, app_role: "ADMIN_NEGOCIO", business_id: a.business });
      expect(await count("support_tickets")).toBe("1");
      expect(await count("support_ticket_events")).toBe("1");
      for (const table of tables.slice(2)) expect(await count(table), `admin ${table}`).toBe("0");
      for (const statement of [
        "insert into public.support_tickets (business_id, created_by, description) values (gen_random_uuid(), gen_random_uuid(), 'x')",
        "update public.support_tickets set status = 'CERRADO'",
        "delete from public.support_tickets",
        "insert into public.platform_events (kind, route) values ('ERROR_500', 'x')",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe("42501");
      }
      await resetApiUser(client);

      await asApiUser(client, { sub: a.superAdmin, app_role: "SUPER_ADMIN", business_id: null });
      expect(await count("support_tickets")).toBe("2");
      for (const table of tables.slice(2))
        expect(Number(await count(table)), `super ${table}`).toBeGreaterThanOrEqual(1);
      await resetApiUser(client);

      await asApiUser(client, { sub: collector, app_role: "COBRADOR", business_id: a.business });
      for (const table of tables) expect(await count(table), `cobrador ${table}`).toBe("0");
      await resetApiUser(client);
    });
  });
});
