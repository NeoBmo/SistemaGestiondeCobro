import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import {
  SUBSCRIPTION_STATUSES,
  listBusinesses,
  parseListFilters,
} from "@/modules/subscriptions/business-queries";
import { PLAN_CATALOG } from "@/modules/subscriptions/plan-catalog";
import { STATUS_PRESENTATION } from "@/modules/subscriptions/status-presentation";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate } from "@/shared/dates/dates";
import { StatusBadge } from "./_components/status-badge";

export const metadata: Metadata = { title: "Negocios" };

const buttonBase =
  "inline-flex min-h-11 items-center justify-center rounded-lg border px-4 py-2 text-base font-medium";
const controlClass = "border-border-strong bg-surface min-h-11 rounded-lg border px-3 font-normal";

export default async function SuperAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Los layouts no se vuelven a ejecutar al navegar: cada página protegida comprueba también.
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  const filters = parseListFilters(await searchParams);
  const businesses = await listBusinesses(getPool(), session, filters);
  const filtered = Object.keys(filters).length > 0;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Negocios</h1>
        <Link
          href="/super-admin/negocios/nuevo"
          className={`${buttonBase} bg-primary text-primary-foreground border-transparent`}
        >
          Nuevo negocio
        </Link>
      </div>

      {/* GET: los filtros viven en la URL (se pueden compartir y recargar) y no requieren JavaScript. */}
      <form method="get" aria-label="Filtrar negocios" className="mt-4 grid gap-3 md:grid-cols-4">
        <label className="flex flex-col gap-1 text-base font-medium">
          Nombre
          <input
            type="search"
            name="q"
            defaultValue={filters.search ?? ""}
            maxLength={120}
            className={controlClass}
          />
        </label>
        <label className="flex flex-col gap-1 text-base font-medium">
          Plan
          <select name="plan" defaultValue={filters.planCode ?? ""} className={controlClass}>
            <option value="">Todos</option>
            {PLAN_CATALOG.map((plan) => (
              <option key={plan.code} value={plan.code}>
                {plan.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-base font-medium">
          Estado
          <select name="estado" defaultValue={filters.status ?? ""} className={controlClass}>
            <option value="">Todos</option>
            {SUBSCRIPTION_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_PRESENTATION[status].label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className={`${buttonBase} border-border-strong bg-surface hover:bg-surface-2`}
          >
            Filtrar
          </button>
          {filtered ? (
            <Link href="/super-admin" className="text-primary min-h-11 content-center underline">
              Quitar filtros
            </Link>
          ) : null}
        </div>
      </form>

      <p className="text-muted mt-4 text-sm" role="status">
        {businesses.length === 1 ? "1 negocio" : `${businesses.length} negocios`}
        {filtered ? " con estos filtros" : ""}
      </p>

      {businesses.length === 0 ? (
        <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">
            {filtered ? "Ningún negocio coincide con los filtros." : "Aún no hay negocios."}
          </p>
          <p className="text-muted mt-1 text-sm">
            {filtered
              ? "Prueba con otros criterios o quita los filtros."
              : "Crea el primero para dar de alta a su administrador."}
          </p>
        </div>
      ) : (
        <ul className="mt-3 grid gap-3 lg:grid-cols-2">
          {businesses.map((business) => (
            <li key={business.id} className="border-border rounded-lg border p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <h2 className="text-lg font-medium">
                  <Link
                    href={`/super-admin/negocios/${business.id}`}
                    className="text-primary break-words underline"
                  >
                    {business.name}
                  </Link>
                </h2>
                <StatusBadge status={business.status} />
              </div>
              <dl className="text-muted mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                <dt>Responsable</dt>
                <dd className="text-foreground min-w-0 break-words">{business.ownerName}</dd>
                <dt>Plan</dt>
                <dd className="text-foreground min-w-0 break-words">{business.planName}</dd>
                <dt>Vence</dt>
                <dd className="text-foreground">{formatIsoDate(business.expiresOn)}</dd>
                <dt>Cobradores</dt>
                <dd className="text-foreground min-w-0 break-words" data-testid="cobradores">
                  {business.activeCollectors} activos
                  {business.collectorLimit === null
                    ? " (sin límite)"
                    : ` de ${business.collectorLimit}`}
                </dd>
                <dt>Administrador</dt>
                <dd className="text-foreground min-w-0 break-all">
                  {business.adminUsername ?? "—"}
                </dd>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
