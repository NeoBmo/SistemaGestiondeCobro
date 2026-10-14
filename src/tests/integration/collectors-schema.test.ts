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

// F5-T2 (02 §4, ADR 0009): cobradores, rutas y asignaciones. Los estados son las únicas mutaciones
// permitidas, el plan limita los cobradores activos y un cliente/cobrador tiene a lo sumo una asignación/ruta activa.

const pool = createTestPool();
afterAll(() => pool.end());

const CHECK_VIOLATION = "23514";
const RESTRICT_VIOLATION = "23001";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

let counter = 0;
const next = () => ++counter;

async function business(client: pg.PoolClient, plan = "MENSUAL") {
  const id = await createBusiness(client, `Negocio ${next()}`);
  await createSubscription(client, id, plan);
  const admin = await createProfile(client, {
    role: "ADMIN_NEGOCIO",
    businessId: id,
    username: `admin.${next()}`,
  });
  return { id, admin };
}

async function collector(
  client: pg.PoolClient,
  b: { id: string; admin: string },
  status: "ACTIVO" | "INACTIVO" = "ACTIVO",
) {
  const user = await createProfile(client, {
    role: "COBRADOR",
    businessId: b.id,
    username: `cob.${next()}`,
  });
  const { rows } = await client.query<{ id: string }>(
    "insert into public.collectors (business_id, user_id, name, status, created_by) values ($1, $2, 'Cobrador', $3, $4) returning id",
    [b.id, user, status, b.admin],
  );
  return { id: rows[0]!.id, user };
}

async function route(
  client: pg.PoolClient,
  b: { id: string; admin: string },
  collectorId: string,
  name = "Ruta",
) {
  const { rows } = await client.query<{ id: string }>(
    "insert into public.routes (business_id, collector_id, name, started_on, created_by) values ($1, $2, $3, current_date, $4) returning id",
    [b.id, collectorId, name, b.admin],
  );
  return rows[0]!.id;
}

async function clientOf(client: pg.PoolClient, b: { id: string; admin: string }) {
  const { rows } = await client.query<{ id: string }>(
    "insert into public.clients (business_id, name, identification, created_by) values ($1, 'Ana', $2, $3) returning id",
    [b.id, `id-${next()}`, b.admin],
  );
  return rows[0]!.id;
}

const assignSql =
  "insert into public.client_assignments (business_id, client_id, route_id, collector_id, created_by) values ($1, $2, $3, $4, $5)";

describe("cobradores", () => {
  it("solo un usuario COBRADOR del mismo negocio es cobrador, una sola vez", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const b = await business(client);
      const c = await collector(client, a);
      const insert =
        "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'X', $3)";

      // El administrador no es un cobrador.
      expect((await attempt(client, insert, [a.id, a.admin, a.admin]))?.code).toBe(CHECK_VIOLATION);
      // Un usuario no puede ser dos cobradores.
      expect((await attempt(client, insert, [a.id, c.user, a.admin]))?.code).toBe(UNIQUE_VIOLATION);
      // Un usuario de otro negocio no entra por FK compuesta.
      const foreign = await createProfile(client, {
        role: "COBRADOR",
        businessId: b.id,
        username: `cob.${next()}`,
      });
      expect((await attempt(client, insert, [a.id, foreign, a.admin]))?.code).toBe(
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  it("el plan semanal admite cinco cobradores activos y no un sexto, ni activarlo", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client, "SEMANAL");
      const created = [];
      for (let i = 0; i < 5; i++) created.push(await collector(client, a));

      const sixth = await createProfile(client, {
        role: "COBRADOR",
        businessId: a.id,
        username: `cob.${next()}`,
      });
      const insert = (status: string) =>
        attempt(
          client,
          "insert into public.collectors (business_id, user_id, name, status, created_by) values ($1, $2, 'Sexto', $3, $4)",
          [a.id, sixth, status, a.admin],
        );
      expect((await insert("ACTIVO"))?.code).toBe(CHECK_VIOLATION);
      // Inactivo sí entra, pero no se puede activar mientras haya cinco activos.
      expect(await insert("INACTIVO")).toBeNull();
      expect(
        (
          await attempt(
            client,
            "update public.collectors set status = 'ACTIVO' where user_id = $1",
            [sixth],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      // Al desactivar uno, el sexto puede activarse.
      await client.query("update public.collectors set status = 'INACTIVO' where id = $1", [
        created[0]!.id,
      ]);
      expect(
        await attempt(client, "update public.collectors set status = 'ACTIVO' where user_id = $1", [
          sixth,
        ]),
      ).toBeNull();
    });
  });

  it("un plan mensual no tiene tope y bajar de plan con demasiados activos se rechaza", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client, "MENSUAL");
      for (let i = 0; i < 6; i++) await collector(client, a);

      const downgrade = (plan: string) =>
        attempt(client, "update public.subscriptions set plan_code = $2 where business_id = $1", [
          a.id,
          plan,
        ]);
      expect((await downgrade("SEMANAL"))?.code).toBe(CHECK_VIOLATION);
      expect(await downgrade("ANUAL")).toBeNull();

      // Con cinco activos sí se puede bajar.
      await client.query(
        "update public.collectors set status = 'INACTIVO' where id = (select id from public.collectors where business_id = $1 limit 1)",
        [a.id],
      );
      expect(await downgrade("SEMANAL")).toBeNull();
    });
  });

  it("solo alterna el estado: no se edita ni se borra, y no se desactiva con ruta activa", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const c = await collector(client, a);
      const routeId = await route(client, a, c.id);

      for (const statement of [
        "update public.collectors set name = 'Otro'",
        "update public.collectors set business_id = business_id, user_id = gen_random_uuid()",
        "delete from public.collectors",
        "truncate public.collectors",
      ]) {
        const error = await attempt(client, statement);
        expect([RESTRICT_VIOLATION, "0A000"], statement).toContain(error?.code);
      }
      expect(
        (
          await attempt(client, "update public.collectors set status = 'INACTIVO' where id = $1", [
            c.id,
          ])
        )?.code,
      ).toBe(CHECK_VIOLATION);

      await client.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [routeId],
      );
      expect(
        await attempt(client, "update public.collectors set status = 'INACTIVO' where id = $1", [
          c.id,
        ]),
      ).toBeNull();
    });
  });
});

describe("rutas", () => {
  it("un cobrador tiene una sola ruta activa y puede abrir otra al cerrar la anterior", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const c = await collector(client, a);
      const first = await route(client, a, c.id, "Norte");
      expect(
        (
          await attempt(
            client,
            "insert into public.routes (business_id, collector_id, name, started_on, created_by) values ($1, $2, 'Sur', current_date, $3)",
            [a.id, c.id, a.admin],
          )
        )?.code,
      ).toBe(UNIQUE_VIOLATION);

      await client.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [first],
      );
      await route(client, a, c.id, "Sur");
      const rows = await client.query(
        "select status from public.routes where collector_id = $1 order by name",
        [c.id],
      );
      expect(rows.rows.map((r) => r.status)).toEqual(["CERRADA", "ACTIVA"]);
    });
  });

  it("una ruta cerrada no se reabre, el estado exige su fecha de cierre y no se cierra con clientes asignados", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const c = await collector(client, a);
      const routeId = await route(client, a, c.id);
      const clientId = await clientOf(client, a);
      await client.query(assignSql, [a.id, clientId, routeId, c.id, a.admin]);

      expect(
        (
          await attempt(
            client,
            "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
            [routeId],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now() where route_id = $1",
        [routeId],
      );
      // CERRADA sin fecha de cierre no vale.
      expect(
        (
          await attempt(client, "update public.routes set status = 'CERRADA' where id = $1", [
            routeId,
          ])
        )?.code,
      ).toBe(CHECK_VIOLATION);
      await client.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [routeId],
      );
      expect(
        (
          await attempt(
            client,
            "update public.routes set status = 'ACTIVA', closed_at = null where id = $1",
            [routeId],
          )
        )?.code,
      ).toBe(RESTRICT_VIOLATION);
      expect((await attempt(client, "delete from public.routes"))?.code).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe("asignaciones", () => {
  it("un cliente tiene una sola asignación activa; reasignar cierra la anterior y conserva el historial", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const c1 = await collector(client, a);
      const c2 = await collector(client, a);
      const r1 = await route(client, a, c1.id, "Uno");
      const r2 = await route(client, a, c2.id, "Dos");
      const clientId = await clientOf(client, a);

      await client.query(assignSql, [a.id, clientId, r1, c1.id, a.admin]);
      expect((await attempt(client, assignSql, [a.id, clientId, r2, c2.id, a.admin]))?.code).toBe(
        UNIQUE_VIOLATION,
      );

      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now() where client_id = $1 and status = 'ACTIVA'",
        [clientId],
      );
      await client.query(assignSql, [a.id, clientId, r2, c2.id, a.admin]);
      const rows = await client.query<{ collector_id: string; status: string }>(
        "select collector_id, status from public.client_assignments where client_id = $1 order by started_at, status desc",
        [clientId],
      );
      expect(rows.rows).toHaveLength(2);
      expect(rows.rows.filter((r) => r.status === "ACTIVA").map((r) => r.collector_id)).toEqual([
        c2.id,
      ]);
    });
  });

  it("exige ruta activa, cobrador activo y que la ruta sea de ese cobrador y del mismo negocio", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const b = await business(client);
      const c1 = await collector(client, a);
      const c2 = await collector(client, a);
      const inactive = await collector(client, a, "INACTIVO");
      const r1 = await route(client, a, c1.id);
      const closed = await route(client, a, c2.id);
      await client.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [closed],
      );
      const clientId = await clientOf(client, a);
      const foreignClient = await clientOf(client, b);

      // Ruta de otro cobrador.
      expect((await attempt(client, assignSql, [a.id, clientId, r1, c2.id, a.admin]))?.code).toBe(
        FOREIGN_KEY_VIOLATION,
      );
      // Ruta cerrada.
      expect(
        (await attempt(client, assignSql, [a.id, clientId, closed, c2.id, a.admin]))?.code,
      ).toBe(CHECK_VIOLATION);
      // Una ruta nueva exige un cobrador activo.
      expect(
        (
          await attempt(
            client,
            "insert into public.routes (business_id, collector_id, name, started_on, created_by) values ($1, $2, 'X', current_date, $3)",
            [a.id, inactive.id, a.admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      // Cliente de otro negocio.
      expect(
        (await attempt(client, assignSql, [a.id, foreignClient, r1, c1.id, a.admin]))?.code,
      ).toBe(FOREIGN_KEY_VIOLATION);
      // Bien formada.
      expect(await attempt(client, assignSql, [a.id, clientId, r1, c1.id, a.admin])).toBeNull();
    });
  });

  it("la asignación es de solo agregado salvo su cierre", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const c = await collector(client, a);
      const routeId = await route(client, a, c.id);
      const clientId = await clientOf(client, a);
      await client.query(assignSql, [a.id, clientId, routeId, c.id, a.admin]);

      for (const statement of [
        "update public.client_assignments set client_id = gen_random_uuid()",
        "update public.client_assignments set started_at = now() - interval '1 day'",
        "delete from public.client_assignments",
        "truncate public.client_assignments",
      ]) {
        expect([RESTRICT_VIOLATION, "0A000"], statement).toContain(
          (await attempt(client, statement))?.code,
        );
      }
      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now()",
      );
      expect(
        (
          await attempt(
            client,
            "update public.client_assignments set status = 'ACTIVA', ended_at = null",
          )
        )?.code,
      ).toBe(RESTRICT_VIOLATION);
    });
  });
});

describe("fechas de cierre y suscripción", () => {
  it("la fecha de cierre de una ruta o asignación cerradas no se reescribe", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const c = await collector(client, a);
      const routeId = await route(client, a, c.id);
      const clientId = await clientOf(client, a);
      await client.query(assignSql, [a.id, clientId, routeId, c.id, a.admin]);
      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now() where route_id = $1",
        [routeId],
      );
      await client.query(
        "update public.routes set status = 'CERRADA', closed_at = now() where id = $1",
        [routeId],
      );

      for (const statement of [
        "update public.routes set closed_at = now() + interval '1 day'",
        "update public.client_assignments set ended_at = now() + interval '1 day'",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }
      // No se cierra «antes de empezar».
      const other = await collector(client, a);
      const early = await route(client, a, other.id);
      expect(
        (
          await attempt(
            client,
            "update public.routes set status = 'CERRADA', closed_at = now() - interval '1 day' where id = $1",
            [early],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });

  it("sin suscripción no se activa un cobrador (falla cerrado)", async () => {
    await withRollback(pool, async (client) => {
      const id = await createBusiness(client, `Sin suscripción ${next()}`);
      const admin = await createProfile(client, {
        role: "ADMIN_NEGOCIO",
        businessId: id,
        username: `admin.${next()}`,
      });
      const user = await createProfile(client, {
        role: "COBRADOR",
        businessId: id,
        username: `cob.${next()}`,
      });
      expect(
        (
          await attempt(
            client,
            "insert into public.collectors (business_id, user_id, name, created_by) values ($1, $2, 'X', $3)",
            [id, user, admin],
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
    });
  });
});

describe("acceso por la API de datos", () => {
  it("el admin ve su negocio, el cobrador solo lo suyo y nadie ve lo ajeno ni escribe", async () => {
    await withRollback(pool, async (client) => {
      const a = await business(client);
      const b = await business(client);
      const mine = await collector(client, a);
      const other = await collector(client, a);
      const foreign = await collector(client, b);
      for (const [c, owner] of [
        [mine, a],
        [other, a],
        [foreign, b],
      ] as const) {
        const routeId = await route(client, owner, c.id);
        const clientId = await clientOf(client, owner);
        await client.query(assignSql, [owner.id, clientId, routeId, c.id, owner.admin]);
      }
      const count = async (table: string) =>
        (await client.query<{ n: string }>(`select count(*)::text as n from public.${table}`))
          .rows[0]!.n;
      const tables = ["collectors", "routes", "client_assignments"];

      await asApiUser(client, { sub: a.admin, app_role: "ADMIN_NEGOCIO", business_id: a.id });
      for (const table of tables) expect(await count(table), `admin ${table}`).toBe("2");
      for (const statement of [
        "insert into public.collectors (business_id, user_id, name, created_by) values (gen_random_uuid(), gen_random_uuid(), 'x', gen_random_uuid())",
        "update public.routes set name = 'x'",
        "delete from public.client_assignments",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe("42501");
      }
      await resetApiUser(client);

      await asApiUser(client, { sub: mine.user, app_role: "COBRADOR", business_id: a.id });
      for (const table of tables) expect(await count(table), `cobrador ${table}`).toBe("1");
      await resetApiUser(client);

      // Al cerrarse la asignación, el cobrador deja de verla (ADR 0009).
      await client.query(
        "update public.client_assignments set status = 'CERRADA', ended_at = now() where collector_id = $1",
        [mine.id],
      );
      await asApiUser(client, { sub: mine.user, app_role: "COBRADOR", business_id: a.id });
      expect(await count("client_assignments")).toBe("0");
      await resetApiUser(client);

      await asApiUser(client, { sub: b.admin, app_role: "ADMIN_NEGOCIO", business_id: b.id });
      for (const table of tables) expect(await count(table), `otro admin ${table}`).toBe("1");
      await resetApiUser(client);
      await asApiUser(client, {}, "anon");
      expect((await attempt(client, "select 1 from public.collectors"))?.code).toBe("42501");
      await resetApiUser(client);
    });
  });
});
