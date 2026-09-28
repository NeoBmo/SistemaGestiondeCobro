import { afterAll, describe, expect, it } from "vitest";
import { attempt, createTestPool, withRollback } from "./helpers/db";
import {
  createAuditEvent,
  createAuthUser,
  createBusiness,
  createProfile,
  createSubscription,
} from "./helpers/identity";

// 02-DOMINIO §1.1–1.4 y §6.3; ADR 0002 y 0003.

const pool = createTestPool();
afterAll(() => pool.end());

const UNIQUE_VIOLATION = "23505";
const CHECK_VIOLATION = "23514";
const FOREIGN_KEY_VIOLATION = "23503";
const RESTRICT_VIOLATION = "23001";

describe("plans (02 §1.1)", () => {
  it("trae los tres planes V1 con sus límites", async () => {
    const { rows } = await pool.query(
      `select code, max_active_collectors, dashboard_configurable, price_amount::text
         from public.plans order by code`,
    );

    expect(rows).toEqual([
      {
        code: "ANUAL",
        max_active_collectors: null,
        dashboard_configurable: true,
        price_amount: "1440000",
      },
      {
        code: "MENSUAL",
        max_active_collectors: null,
        dashboard_configurable: true,
        price_amount: "150000",
      },
      {
        code: "SEMANAL",
        max_active_collectors: 5,
        dashboard_configurable: false,
        price_amount: "50000",
      },
    ]);
  });

  it("el precio anual es 20 % menos que 12 mensualidades (01-CONTEXTO)", async () => {
    const { rows } = await pool.query<{ ok: boolean }>(
      `select (select price_amount from public.plans where code = 'ANUAL')
            = (select price_amount from public.plans where code = 'MENSUAL') * 12 * 8 / 10 as ok`,
    );

    expect(rows[0]?.ok).toBe(true);
  });
});

describe("businesses (02 §1.2)", () => {
  it("nace ACTIVO y con zona horaria America/Bogota por defecto", async () => {
    await withRollback(pool, async (client) => {
      const id = await createBusiness(client, "Negocio A");

      const { rows } = await client.query(
        "select access_status, time_zone from public.businesses where id = $1",
        [id],
      );
      expect(rows[0]).toEqual({ access_status: "ACTIVO", time_zone: "America/Bogota" });
    });
  });

  it("rechaza zona horaria inválida, estado inválido y textos vacíos", async () => {
    await withRollback(pool, async (client) => {
      const insert = (columns: string, values: string) =>
        `insert into public.businesses (name, owner_name, owner_identification, phone${columns})
         values ('N', 'R', '1', '3'${values})`;

      expect((await attempt(client, insert(", time_zone", ", 'Marte/Olimpo'")))?.code).toBe(
        CHECK_VIOLATION,
      );
      expect((await attempt(client, insert(", access_status", ", 'BORRADO'")))?.code).toBe(
        CHECK_VIOLATION,
      );
      expect(
        (
          await attempt(
            client,
            "insert into public.businesses (name, owner_name, owner_identification, phone) values ('  ', 'R', '1', '3')",
          )
        )?.code,
      ).toBe(CHECK_VIOLATION);
      expect(await attempt(client, insert(", time_zone", ", 'America/Bogota'"))).toBeNull();
    });
  });
});

describe("profiles (02 §1.4, ADR 0002)", () => {
  it("Super Admin sin negocio; los demás roles con negocio", async () => {
    await withRollback(pool, async (client) => {
      const business = await createBusiness(client, "Negocio A");
      const authId = await createAuthUser(client, "x");
      const insert = (role: string, businessId: string | null, username: string) =>
        attempt(
          client,
          `insert into public.profiles (id, business_id, role, username, display_name)
           values ($1, $2, $3, $4, 'X')`,
          [authId, businessId, role, username],
        );

      expect((await insert("SUPER_ADMIN", business, "root01"))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("ADMIN_NEGOCIO", null, "admin01"))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("COBRADOR", null, "cobra01"))?.code).toBe(CHECK_VIOLATION);
      expect(await insert("SUPER_ADMIN", null, "root01")).toBeNull();
    });
  });

  it("una sola cuenta administrativa principal por negocio", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      const b = await createBusiness(client, "Negocio B");
      await createProfile(client, { role: "ADMIN_NEGOCIO", businessId: a, username: "admin.a" });

      const second = await attempt(
        client,
        "insert into public.profiles (id, business_id, role, username, display_name) values ($1, $2, 'ADMIN_NEGOCIO', 'admin.a2', 'X')",
        [await createAuthUser(client, "y"), a],
      );
      expect(second?.code).toBe(UNIQUE_VIOLATION);

      // Otro negocio sí puede tener su administrador; varios cobradores en el mismo, también.
      await createProfile(client, { role: "ADMIN_NEGOCIO", businessId: b, username: "admin.b" });
      await createProfile(client, { role: "COBRADOR", businessId: a, username: "cobra.uno" });
      await createProfile(client, { role: "COBRADOR", businessId: a, username: "cobra.dos" });
    });
  });

  it("el nombre de usuario es único en toda la plataforma", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      const b = await createBusiness(client, "Negocio B");
      await createProfile(client, { role: "COBRADOR", businessId: a, username: "juan.perez" });

      const duplicate = await attempt(
        client,
        "insert into public.profiles (id, business_id, role, username, display_name) values ($1, $2, 'COBRADOR', 'juan.perez', 'X')",
        [await createAuthUser(client, "z"), b],
      );
      expect(duplicate?.code).toBe(UNIQUE_VIOLATION);
    });
  });

  it("el nombre de usuario solo admite minúsculas, dígitos, punto, guion y guion bajo (3–32)", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      const tryUsername = async (username: string) =>
        attempt(
          client,
          "insert into public.profiles (id, business_id, role, username, display_name) values ($1, $2, 'COBRADOR', $3, 'X')",
          [await createAuthUser(client, "u"), a, username],
        );

      for (const bad of ["Juan", "ab", "con espacio", "a@b", "ñandú", "x".repeat(33)]) {
        expect((await tryUsername(bad))?.code, bad).toBe(CHECK_VIOLATION);
      }
      for (const good of ["abc", "juan.perez", "juan_perez-2", "x".repeat(32)]) {
        expect(await tryUsername(good), good).toBeNull();
      }
    });
  });

  it("nace PENDIENTE_CAMBIO_CONTRASENA y exige un usuario de Auth existente", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      const id = await createProfile(client, {
        role: "COBRADOR",
        businessId: a,
        username: "nuevo.usuario",
      });

      const { rows } = await client.query("select status from public.profiles where id = $1", [id]);
      expect(rows[0]?.status).toBe("PENDIENTE_CAMBIO_CONTRASENA");

      const orphan = await attempt(
        client,
        "insert into public.profiles (id, business_id, role, username, display_name) values (gen_random_uuid(), $1, 'COBRADOR', 'huerfano', 'X')",
        [a],
      );
      expect(orphan?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("subscriptions (02 §1.3, ADR 0003)", () => {
  it("una suscripción vigente por negocio, ACTIVA por defecto", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      const id = await createSubscription(client, a);

      const { rows } = await client.query("select status from public.subscriptions where id = $1", [
        id,
      ]);
      expect(rows[0]?.status).toBe("ACTIVA");

      const second = await attempt(
        client,
        "insert into public.subscriptions (business_id, plan_code, starts_on, expires_on) values ($1, 'ANUAL', current_date, current_date + 365)",
        [a],
      );
      expect(second?.code).toBe(UNIQUE_VIOLATION);
    });
  });

  it("solo guarda ACTIVA/SUSPENDIDA/ARCHIVADA: los estados informativos se derivan", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");

      for (const derived of ["PROXIMA_A_VENCER", "VENCIDA"]) {
        const error = await attempt(
          client,
          "insert into public.subscriptions (business_id, plan_code, status, starts_on, expires_on) values ($1, 'MENSUAL', $2, current_date, current_date + 30)",
          [a, derived],
        );
        expect(error?.code, derived).toBe(CHECK_VIOLATION);
      }
    });
  });

  it("rechaza vencimiento no posterior al inicio y planes inexistentes", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      const insert = (plan: string, expires: string) =>
        attempt(
          client,
          `insert into public.subscriptions (business_id, plan_code, starts_on, expires_on)
           values ($1, $2, current_date, ${expires})`,
          [a, plan],
        );

      expect((await insert("MENSUAL", "current_date"))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("MENSUAL", "current_date - 1"))?.code).toBe(CHECK_VIOLATION);
      expect((await insert("TRIMESTRAL", "current_date + 90"))?.code).toBe(FOREIGN_KEY_VIOLATION);
    });
  });
});

describe("audit_events (02 §6.3): solo agregado", () => {
  it("permite INSERT y rechaza UPDATE, DELETE y TRUNCATE", async () => {
    await withRollback(pool, async (client) => {
      const a = await createBusiness(client, "Negocio A");
      await createAuditEvent(client, a, "NegocioCreado");
      await createAuditEvent(client, null, "PlanCambiado");

      for (const statement of [
        "update public.audit_events set action = 'otra'",
        "delete from public.audit_events",
        "truncate public.audit_events",
      ]) {
        expect((await attempt(client, statement))?.code, statement).toBe(RESTRICT_VIOLATION);
      }

      const { rows } = await client.query("select count(*)::int as total from public.audit_events");
      expect(rows[0]?.total).toBe(2);
    });
  });

  it("solo acepta resultados OK o RECHAZADO", async () => {
    await withRollback(pool, async (client) => {
      const error = await attempt(
        client,
        "insert into public.audit_events (action, entity_type, entity_id, result) values ('x', 'test', gen_random_uuid(), 'QUIZAS')",
      );
      expect(error?.code).toBe(CHECK_VIOLATION);
    });
  });
});
