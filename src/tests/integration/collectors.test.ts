import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { assignClient } from "@/modules/collections/assignments";
import {
  createCollector,
  deactivateCollector,
  reactivateCollector,
  resetCollectorPassword,
  type CollectorDeps,
} from "@/modules/collections/collectors";
import { closeRoute, createRoute } from "@/modules/collections/routes";
import { signInWithUsername } from "@/modules/identity/login";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { createClient } from "@/modules/portfolio/clients";
import { changePlan } from "@/modules/subscriptions/lifecycle";
import { AppError } from "@/shared/errors/app-error";
import {
  TEST_EMAIL_DOMAIN,
  TestFixtures,
  createAdminClient,
  createAnonClient,
} from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// F5-T3 (02 §4, ADR 0009): cobradores (alta, desactivar = bloquear, reactivar, restablecer), rutas y
// asignaciones/reasignaciones. Comandos no financieros: una transacción + auditoría, solo el Admin.

const pool = createTestPool();
const admin = createAdminClient();
const fixtures = new TestFixtures(pool, admin);
const deps: CollectorDeps = { db: pool, admin, syntheticEmailDomain: TEST_EMAIL_DOMAIN };

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

const unique = () => randomUUID().slice(0, 8);

async function world(plan?: "SEMANAL") {
  const businessId = await fixtures.business("Cobradores");
  if (plan) {
    await pool.query("update public.subscriptions set plan_code = $2 where business_id = $1", [
      businessId,
      plan,
    ]);
  }
  const account = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
  const actor: SessionContext = await loadSessionContext(account.userId, pool);
  return { businessId, actor };
}

async function newCollector(w: Awaited<ReturnType<typeof world>>, name = "Carlos") {
  const result = await createCollector(deps, w.actor, { name, username: `cob.${unique()}` });
  fixtures.track({ userId: result.userId });
  return result;
}

async function newClient(w: Awaited<ReturnType<typeof world>>) {
  return createClient({ db: pool }, w.actor, { name: "Ana", identification: unique() });
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
    await pool.query<{ entity_id: string; summary: Record<string, unknown> }>(
      "select entity_id, summary from public.audit_events where business_id = $1 and action = $2 and result = 'OK'",
      [businessId, action],
    )
  ).rows;

describe("cobradores", () => {
  it("crea la cuenta COBRADOR y el cobrador, audita sin la contraseña y le deja entrar con la temporal", async () => {
    const w = await world();
    const username = `cob.${unique()}`;

    const created = await createCollector(deps, w.actor, { name: "Carlos", username });
    fixtures.track({ userId: created.userId });

    const profile = await pool.query(
      "select role, status, business_id from public.profiles where id = $1",
      [created.userId],
    );
    expect(profile.rows[0]).toEqual({
      role: "COBRADOR",
      status: "PENDIENTE_CAMBIO_CONTRASENA",
      business_id: w.businessId,
    });
    const collector = await pool.query(
      "select status, user_id, name from public.collectors where id = $1",
      [created.collectorId],
    );
    expect(collector.rows[0]).toEqual({
      status: "ACTIVO",
      user_id: created.userId,
      name: "Carlos",
    });
    expect((await audit(w.businessId, "CobradorCreado"))[0]!.entity_id).toBe(created.collectorId);
    expect((await audit(w.businessId, "UsuarioCreado")).map((e) => e.entity_id)).toContain(
      created.userId,
    );
    const events = await pool.query<{ summary: unknown }>(
      "select summary from public.audit_events where business_id = $1",
      [w.businessId],
    );
    expect(JSON.stringify(events.rows)).not.toContain(created.temporaryPassword);

    const login = await signInWithUsername(
      { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      { username: created.username, password: created.temporaryPassword },
    );
    expect(login).toMatchObject({ role: "COBRADOR", mustChangePassword: true });
  });

  it("rechaza un usuario repetido y un cobrador no administra cobradores (RECHAZADO)", async () => {
    const w = await world();
    const first = await newCollector(w);

    expect(
      await failureOf(createCollector(deps, w.actor, { name: "Otro", username: first.username })),
    ).toMatchObject({ code: "USERNAME_TAKEN", status: 409 });

    await pool.query("update public.profiles set status = 'ACTIVO' where id = $1", [first.userId]);
    const cobrador = await loadSessionContext(first.userId, pool);
    expect(
      await failureOf(createCollector(deps, cobrador, { name: "X", username: `cob.${unique()}` })),
    ).toMatchObject({ status: 403 });
    expect(await failureOf(deactivateCollector(deps, cobrador, first.collectorId))).toMatchObject({
      status: 403,
    });
    expect((await audit(w.businessId, "CobradorCreado")).length).toBe(1);
    const rejected = await pool.query(
      "select 1 from public.audit_events where business_id = $1 and result = 'RECHAZADO'",
      [w.businessId],
    );
    expect(rejected.rowCount).toBeGreaterThan(0);
  });

  it("el plan semanal no admite un sexto cobrador activo y no deja un usuario de Auth huérfano", async () => {
    const w = await world("SEMANAL");
    for (let i = 0; i < 5; i++) await newCollector(w, `C${i}`);
    const username = `cob.${unique()}`;

    const error = await failureOf(createCollector(deps, w.actor, { name: "Sexto", username }));

    expect(error).toMatchObject({ code: "COLLECTOR_LIMIT_REACHED", status: 409 });
    expect(
      (
        await pool.query("select 1 from auth.users where email = $1", [
          `${username}@${TEST_EMAIL_DOMAIN}`,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it("desactivar bloquea la cuenta y revoca sesiones; reactivar la desbloquea con contraseña nueva", async () => {
    const w = await world();
    const c = await newCollector(w);
    // Abre una sesión real con la temporal.
    const session = createAnonClient();
    await signInWithUsername(
      { supabase: session, db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      { username: c.username, password: c.temporaryPassword },
    );
    expect(
      (await pool.query("select 1 from auth.sessions where user_id = $1", [c.userId])).rowCount,
    ).toBeGreaterThan(0);

    await deactivateCollector(deps, w.actor, c.collectorId);

    const state = await pool.query(
      `select c.status as collector, p.status as profile from public.collectors c
         join public.profiles p on p.id = c.user_id where c.id = $1`,
      [c.collectorId],
    );
    expect(state.rows[0]).toEqual({ collector: "INACTIVO", profile: "BLOQUEADO" });
    expect(
      (await pool.query("select 1 from auth.sessions where user_id = $1", [c.userId])).rowCount,
    ).toBe(0);
    expect(
      await failureOf(
        signInWithUsername(
          { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
          { username: c.username, password: c.temporaryPassword },
        ),
      ),
    ).toBeInstanceOf(AppError);
    expect(await failureOf(deactivateCollector(deps, w.actor, c.collectorId))).toMatchObject({
      code: "COLLECTOR_ALREADY_INACTIVE",
    });
    // Restablecer no desbloquea por la puerta de atrás.
    expect(await failureOf(resetCollectorPassword(deps, w.actor, c.collectorId))).toMatchObject({
      code: "COLLECTOR_INACTIVE",
    });

    const back = await reactivateCollector(deps, w.actor, c.collectorId);
    const login = await signInWithUsername(
      { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
      { username: back.username, password: back.temporaryPassword },
    );
    expect(login).toMatchObject({ role: "COBRADOR", mustChangePassword: true });
    expect((await audit(w.businessId, "CobradorDesactivado")).length).toBe(1);
    expect((await audit(w.businessId, "UsuarioBloqueado")).length).toBe(1);
    expect((await audit(w.businessId, "CobradorReactivado")).length).toBe(1);
  });

  it("no se desactiva con una ruta activa y no se reactiva por encima del tope del plan", async () => {
    const w = await world("SEMANAL");
    const first = await newCollector(w);
    for (let i = 0; i < 4; i++) await newCollector(w, `C${i}`);
    await createRoute({ db: pool }, w.actor, { collectorId: first.collectorId, name: "Norte" });

    expect(await failureOf(deactivateCollector(deps, w.actor, first.collectorId))).toMatchObject({
      code: "COLLECTOR_HAS_ACTIVE_ROUTE",
    });

    const extra = await pool.query<{ id: string }>(
      "select id from public.collectors where business_id = $1 and id <> $2 limit 1",
      [w.businessId, first.collectorId],
    );
    await deactivateCollector(deps, w.actor, extra.rows[0]!.id);
    // Entra uno nuevo en su lugar: el plan queda lleno y el inactivo no puede volver.
    await newCollector(w, "Reemplazo");
    expect(await failureOf(reactivateCollector(deps, w.actor, extra.rows[0]!.id))).toMatchObject({
      code: "COLLECTOR_LIMIT_REACHED",
    });
  });

  it("restablecer da una contraseña temporal nueva y un cobrador de otro negocio es «no encontrado»", async () => {
    const w = await world();
    const other = await world();
    const c = await newCollector(w);
    const outsider = await newCollector(other);

    const reset = await resetCollectorPassword(deps, w.actor, c.collectorId);
    expect(reset.temporaryPassword).not.toBe(c.temporaryPassword);
    expect(
      await signInWithUsername(
        { supabase: createAnonClient(), db: pool, syntheticEmailDomain: TEST_EMAIL_DOMAIN },
        { username: reset.username, password: reset.temporaryPassword },
      ),
    ).toMatchObject({ role: "COBRADOR", mustChangePassword: true });

    for (const run of [
      () => resetCollectorPassword(deps, w.actor, outsider.collectorId),
      () => deactivateCollector(deps, w.actor, outsider.collectorId),
      () => reactivateCollector(deps, w.actor, outsider.collectorId),
    ]) {
      expect(await failureOf(run())).toMatchObject({ code: "COLLECTOR_NOT_FOUND", status: 404 });
    }
  });

  it("bajar de plan con más cobradores activos que el tope se rechaza con un 409 claro", async () => {
    const w = await world();
    for (let i = 0; i < 6; i++) await newCollector(w, `C${i}`);
    const superAccount = await fixtures.account({ role: "SUPER_ADMIN", businessId: null });
    const superAdmin = await loadSessionContext(superAccount.userId, pool);

    expect(
      await failureOf(
        changePlan({ db: pool }, superAdmin, { businessId: w.businessId, planCode: "SEMANAL" }),
      ),
    ).toMatchObject({ code: "COLLECTOR_LIMIT_EXCEEDED", status: 409 });
    const plan = await pool.query(
      "select plan_code from public.subscriptions where business_id = $1",
      [w.businessId],
    );
    expect(plan.rows[0]!.plan_code).toBe("MENSUAL");
  });
});

describe("rutas y asignaciones", () => {
  it("una ruta activa por cobrador, no se crea para uno inactivo y no se cierra con clientes", async () => {
    const w = await world();
    const c = await newCollector(w);
    const route = await createRoute({ db: pool }, w.actor, {
      collectorId: c.collectorId,
      name: "Norte",
    });

    expect(
      await failureOf(
        createRoute({ db: pool }, w.actor, { collectorId: c.collectorId, name: "Sur" }),
      ),
    ).toMatchObject({ code: "COLLECTOR_HAS_ACTIVE_ROUTE", status: 409 });

    const client = await newClient(w);
    await assignClient({ db: pool }, w.actor, { clientId: client.id, routeId: route.routeId });
    expect(await failureOf(closeRoute({ db: pool }, w.actor, route.routeId))).toMatchObject({
      code: "ROUTE_HAS_CLIENTS",
    });

    // Con otra ruta, el cliente se reasigna y la primera ya se cierra.
    const c2 = await newCollector(w, "Luis");
    const route2 = await createRoute({ db: pool }, w.actor, {
      collectorId: c2.collectorId,
      name: "Sur",
    });
    const moved = await assignClient({ db: pool }, w.actor, {
      clientId: client.id,
      routeId: route2.routeId,
    });
    expect(moved.reassigned).toBe(true);
    await closeRoute({ db: pool }, w.actor, route.routeId);
    expect(await failureOf(closeRoute({ db: pool }, w.actor, route.routeId))).toMatchObject({
      code: "ROUTE_ALREADY_CLOSED",
    });
    expect(
      await failureOf(
        assignClient({ db: pool }, w.actor, { clientId: client.id, routeId: route.routeId }),
      ),
    ).toMatchObject({ code: "ROUTE_CLOSED" });

    // Un cobrador inactivo no recibe rutas.
    const c3 = await newCollector(w, "Tres");
    await deactivateCollector(deps, w.actor, c3.collectorId);
    expect(
      await failureOf(
        createRoute({ db: pool }, w.actor, { collectorId: c3.collectorId, name: "X" }),
      ),
    ).toMatchObject({ code: "COLLECTOR_INACTIVE" });
  });

  it("asignar y reasignar cierran la anterior sin borrar historia y se auditan con origen y destino", async () => {
    const w = await world();
    const c1 = await newCollector(w, "Uno");
    const c2 = await newCollector(w, "Dos");
    const r1 = await createRoute({ db: pool }, w.actor, { collectorId: c1.collectorId, name: "A" });
    const r2 = await createRoute({ db: pool }, w.actor, { collectorId: c2.collectorId, name: "B" });
    const client = await newClient(w);

    const first = await assignClient({ db: pool }, w.actor, {
      clientId: client.id,
      routeId: r1.routeId,
    });
    expect(first.reassigned).toBe(false);
    expect(
      await failureOf(
        assignClient({ db: pool }, w.actor, { clientId: client.id, routeId: r1.routeId }),
      ),
    ).toMatchObject({ code: "CLIENT_ALREADY_ASSIGNED" });
    const second = await assignClient({ db: pool }, w.actor, {
      clientId: client.id,
      routeId: r2.routeId,
    });
    expect(second).toMatchObject({ reassigned: true, collectorId: c2.collectorId });

    const history = await pool.query<{ status: string; collector_id: string; ended: boolean }>(
      `select status, collector_id, ended_at is not null as ended from public.client_assignments
        where client_id = $1 order by started_at, status desc`,
      [client.id],
    );
    expect(history.rows).toHaveLength(2);
    expect(history.rows.find((r) => r.status === "CERRADA")).toMatchObject({
      collector_id: c1.collectorId,
      ended: true,
    });
    expect(history.rows.find((r) => r.status === "ACTIVA")!.collector_id).toBe(c2.collectorId);
    const reassigned = await audit(w.businessId, "ClienteReasignado");
    expect(reassigned).toHaveLength(1);
    expect(reassigned[0]!.summary).toMatchObject({
      fromRouteId: r1.routeId,
      routeId: r2.routeId,
      fromCollectorId: c1.collectorId,
    });
    expect(await audit(w.businessId, "ClienteAsignado")).toHaveLength(1);
  });

  it("un cliente o ruta de otro negocio es «no encontrado» y un cobrador no asigna", async () => {
    const w = await world();
    const other = await world();
    const c = await newCollector(w);
    const outsider = await newCollector(other);
    const route = await createRoute({ db: pool }, w.actor, {
      collectorId: c.collectorId,
      name: "A",
    });
    const foreignRoute = await createRoute({ db: pool }, other.actor, {
      collectorId: outsider.collectorId,
      name: "Z",
    });
    const mine = await newClient(w);
    const foreign = await newClient(other);

    expect(
      await failureOf(
        assignClient({ db: pool }, w.actor, { clientId: foreign.id, routeId: route.routeId }),
      ),
    ).toMatchObject({ code: "CLIENT_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        assignClient({ db: pool }, w.actor, { clientId: mine.id, routeId: foreignRoute.routeId }),
      ),
    ).toMatchObject({ code: "ROUTE_NOT_FOUND", status: 404 });
    expect(
      await failureOf(
        createRoute({ db: pool }, w.actor, { collectorId: outsider.collectorId, name: "X" }),
      ),
    ).toMatchObject({ code: "COLLECTOR_NOT_FOUND" });
    expect(await failureOf(closeRoute({ db: pool }, w.actor, foreignRoute.routeId))).toMatchObject({
      code: "ROUTE_NOT_FOUND",
    });

    const cobrador = await loadSessionContext(c.userId, pool);
    expect(
      await failureOf(
        assignClient({ db: pool }, cobrador, { clientId: mine.id, routeId: route.routeId }),
      ),
    ).toMatchObject({ status: 403 });
    expect(await failureOf(closeRoute({ db: pool }, cobrador, route.routeId))).toMatchObject({
      status: 403,
    });
  });

  it("dos asignaciones simultáneas del mismo cliente dejan exactamente una activa", async () => {
    const w = await world();
    const c1 = await newCollector(w, "Uno");
    const c2 = await newCollector(w, "Dos");
    const r1 = await createRoute({ db: pool }, w.actor, { collectorId: c1.collectorId, name: "A" });
    const r2 = await createRoute({ db: pool }, w.actor, { collectorId: c2.collectorId, name: "B" });
    const client = await newClient(w);

    const results = await Promise.allSettled([
      assignClient({ db: pool }, w.actor, { clientId: client.id, routeId: r1.routeId }),
      assignClient({ db: pool }, w.actor, { clientId: client.id, routeId: r2.routeId }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    const active = await pool.query(
      "select 1 from public.client_assignments where client_id = $1 and status = 'ACTIVA'",
      [client.id],
    );
    expect(active.rowCount).toBe(1);
  });
});
