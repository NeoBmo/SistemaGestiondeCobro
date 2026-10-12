import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { loadSessionContext, type SessionContext } from "@/modules/identity/session";
import { getBusinessDetail, listBusinesses } from "@/modules/subscriptions/business-queries";
import { archiveBusiness, suspendBusiness } from "@/modules/subscriptions/lifecycle";
import { TestFixtures, createAdminClient } from "./helpers/auth";
import { createTestPool } from "./helpers/db";

// Lecturas del panel del Super Admin (F1-T5b): estado derivado con «hoy» del negocio, filtros y
// autorización propia (no solo la de la página).

const pool = createTestPool();
const fixtures = new TestFixtures(pool, createAdminClient());

afterAll(async () => {
  await fixtures.purge();
  await pool.end();
});

async function sessionOf(role: "SUPER_ADMIN" | "ADMIN_NEGOCIO", businessId: string | null) {
  const account = await fixtures.account({ role, businessId });
  return loadSessionContext(account.userId, pool);
}

/** Nombre único por ejecución: los filtros por texto no deben chocar con datos de otras pruebas. */
const unique = (label: string) => `${label}-${randomUUID().slice(0, 8)}`;

describe("listBusinesses", () => {
  it("lista con plan y administrador, y deriva el estado con la fecha del negocio", async () => {
    const actor = await sessionOf("SUPER_ADMIN", null);
    const name = unique("Panel");
    const businessId = await fixtures.business(name);
    await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });

    const [row] = await listBusinesses(pool, actor, { search: name });
    expect(row).toMatchObject({
      id: businessId,
      planCode: "MENSUAL",
      accessStatus: "ACTIVO",
      status: "ACTIVA",
    });
    expect(row?.name).toContain(name);
    expect(row?.adminUsername).toBeTruthy();

    // Con «ahora» a 28 días: quedan 2 de los 30 → próxima a vencer; pasado el vencimiento → vencida.
    const near = await listBusinesses(
      pool,
      actor,
      { search: name },
      new Date(Date.now() + 28 * 86_400_000),
    );
    expect(near[0]?.status).toBe("PROXIMA_A_VENCER");
    const late = await listBusinesses(
      pool,
      actor,
      { search: name },
      new Date(Date.now() + 40 * 86_400_000),
    );
    expect(late[0]?.status).toBe("VENCIDA");
  });

  it("filtra por nombre (sin distinguir mayúsculas ni tratar % y _ como comodines), plan y estado", async () => {
    const actor = await sessionOf("SUPER_ADMIN", null);
    const tag = unique("Filtro");
    const active = await fixtures.business(`${tag} Activo`);
    const suspended = await fixtures.business(`${tag} Suspendido`);
    await suspendBusiness({ db: pool }, actor, { businessId: suspended });

    const byName = await listBusinesses(pool, actor, { search: tag.toUpperCase() });
    expect(byName.map((b) => b.id).sort()).toEqual([active, suspended].sort());

    const bySuspended = await listBusinesses(pool, actor, { search: tag, status: "SUSPENDIDA" });
    expect(bySuspended.map((b) => b.id)).toEqual([suspended]);

    expect(await listBusinesses(pool, actor, { search: tag, planCode: "ANUAL" })).toEqual([]);
    expect(await listBusinesses(pool, actor, { search: "%" })).toEqual([]);
    expect(await listBusinesses(pool, actor, { search: "_" })).toEqual([]);
  });

  it("un negocio archivado aparece con su última suscripción archivada", async () => {
    const actor = await sessionOf("SUPER_ADMIN", null);
    const name = unique("Archivado");
    const businessId = await fixtures.business(name);
    await archiveBusiness({ db: pool }, actor, { businessId, reason: "Cierre del negocio" });

    const [row] = await listBusinesses(pool, actor, { search: name });
    expect(row).toMatchObject({ id: businessId, status: "ARCHIVADA", accessStatus: "SUSPENDIDO" });
  });

  it("solo la ejecuta un Super Admin", async () => {
    const businessId = await fixtures.business(unique("Ajeno"));
    const admin = await sessionOf("ADMIN_NEGOCIO", businessId);
    await expect(listBusinesses(pool, admin)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(getBusinessDetail(pool, admin, businessId)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("getBusinessDetail", () => {
  it("devuelve datos, administrador e historial con la vigente primero", async () => {
    const actor: SessionContext = await sessionOf("SUPER_ADMIN", null);
    const businessId = await fixtures.business(unique("Ficha"));
    const admin = await fixtures.account({ role: "ADMIN_NEGOCIO", businessId });
    await archiveBusiness({ db: pool }, actor, { businessId, reason: "Cambio de titular" });

    const detail = await getBusinessDetail(pool, actor, businessId);
    expect(detail).toMatchObject({
      id: businessId,
      accessStatus: "SUSPENDIDO",
      currentStatus: null,
      currentPlan: null,
      status: "ARCHIVADA",
      admin: { username: admin.username },
    });
    expect(detail?.subscriptions).toHaveLength(1);
    expect(detail?.subscriptions[0]).toMatchObject({
      status: "ARCHIVADA",
      note: "Cambio de titular",
      planName: "Mensual",
    });
  });

  it("devuelve null si el negocio no existe o el id no es un UUID", async () => {
    const actor = await sessionOf("SUPER_ADMIN", null);
    expect(await getBusinessDetail(pool, actor, randomUUID())).toBeNull();
    expect(await getBusinessDetail(pool, actor, "no-es-un-uuid")).toBeNull();
  });
});
