import type { Metadata } from "next";
import Link from "next/link";
import { listCollectors, listRoutes } from "@/modules/collections/queries";
import {
  PORTFOLIO_STATUSES,
  PORTFOLIO_STATUS_LABEL,
  listPortfolio,
  parsePortfolioFilters,
} from "@/modules/dashboard/portfolio";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate } from "@/shared/dates/dates";
import { formatMoney } from "@/shared/money/money";

export const metadata: Metadata = { title: "Cartera" };

const STATUS_ICON = { AL_DIA: "✓", EN_MORA: "⚠", SIN_PRESTAMO: "○" } as const;

export default async function PortfolioPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const params = await searchParams;
  const filters = parsePortfolioFilters(params);
  const db = getPool();
  const [page, collectors, routes] = await Promise.all([
    listPortfolio(db, session, filters),
    listCollectors(db, session),
    listRoutes(db, session),
  ]);
  const pages = Math.max(1, Math.ceil(page.total / page.pageSize));

  const link = (target: number) => {
    const next = new URLSearchParams();
    if (filters.collectorId) next.set("cobrador", filters.collectorId);
    if (filters.routeId) next.set("ruta", filters.routeId);
    if (filters.status) next.set("estado", filters.status);
    if (filters.search) next.set("q", filters.search);
    if (target > 1) next.set("pagina", String(target));
    const query = next.toString();
    return query ? `/negocio/cartera?${query}` : "/negocio/cartera";
  };

  return (
    <>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Cartera</h1>
      <p className="text-muted mt-1 text-sm">
        Tus clientes ordenados por prioridad: más mora, más saldo vencido y vencimiento más antiguo.
      </p>

      <form
        // Se remonta al cambiar los filtros: así los campos reflejan la URL (p. ej. tras «Quitar filtros»).
        key={link(1)}
        method="get"
        aria-label="Filtros de la cartera"
        className="mt-4 grid max-w-3xl gap-3 sm:grid-cols-2"
      >
        <div className="flex flex-col gap-1 sm:col-span-2">
          <label htmlFor="q" className="font-medium">
            Buscar
          </label>
          <input
            id="q"
            name="q"
            type="search"
            defaultValue={filters.search ?? ""}
            placeholder="Nombre o identificación"
            className="border-border bg-background min-h-11 rounded-lg border px-3"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="estado" className="font-medium">
            Estado
          </label>
          <select
            id="estado"
            name="estado"
            defaultValue={filters.status ?? ""}
            className="border-border bg-background min-h-11 rounded-lg border px-3"
          >
            <option value="">Todos</option>
            {PORTFOLIO_STATUSES.map((status) => (
              <option key={status} value={status}>
                {PORTFOLIO_STATUS_LABEL[status]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cobrador" className="font-medium">
            Cobrador
          </label>
          <select
            id="cobrador"
            name="cobrador"
            defaultValue={filters.collectorId ?? ""}
            className="border-border bg-background min-h-11 rounded-lg border px-3"
          >
            <option value="">Todos</option>
            {collectors.map((collector) => (
              <option key={collector.id} value={collector.id}>
                {collector.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ruta" className="font-medium">
            Ruta
          </label>
          <select
            id="ruta"
            name="ruta"
            defaultValue={filters.routeId ?? ""}
            className="border-border bg-background min-h-11 rounded-lg border px-3"
          >
            <option value="">Todas</option>
            {routes.map((route) => (
              <option key={route.id} value={route.id}>
                {route.name} · {route.collector.name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end gap-3">
          <button
            type="submit"
            className="bg-primary text-primary-foreground min-h-11 rounded-lg px-4 font-medium"
          >
            Filtrar
          </button>
          <Link href="/negocio/cartera" className="text-primary min-h-11 content-center underline">
            Quitar filtros
          </Link>
        </div>
      </form>

      <p className="mt-4 text-sm" aria-live="polite" data-testid="total">
        {page.total} {page.total === 1 ? "cliente" : "clientes"}
      </p>

      {page.rows.length === 0 ? (
        <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Ningún cliente coincide con los filtros.</p>
          <Link href="/negocio/cartera" className="text-primary mt-2 inline-block underline">
            Quitar filtros
          </Link>
        </div>
      ) : (
        <ol className="mt-3 flex flex-col gap-2">
          {page.rows.map((row) => (
            <li key={row.id} data-testid="fila" className="border-border rounded-lg border p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/negocio/clientes/${row.id}`}
                  className="text-primary font-medium underline"
                >
                  {row.name}
                </Link>
                <span className="border-border bg-surface inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
                  <span aria-hidden="true">{STATUS_ICON[row.status]}</span>
                  {PORTFOLIO_STATUS_LABEL[row.status]}
                  {row.maxDaysLate > 0
                    ? ` · ${row.maxDaysLate} ${row.maxDaysLate === 1 ? "día" : "días"}`
                    : ""}
                </span>
              </div>
              <p className="text-muted text-sm">
                {row.identification}
                {row.collectorName ? ` · ${row.collectorName}` : " · Sin cobrador"}
                {row.routeName ? ` · ${row.routeName}` : ""}
              </p>
              <p className="mt-1 text-sm">
                Vencido <span className="font-mono tabular-nums">{formatMoney(row.overdue)}</span> ·
                saldo{" "}
                <span className="font-mono tabular-nums">{formatMoney(row.totalPending)}</span>
                {row.oldestDue ? ` · desde ${formatIsoDate(row.oldestDue)}` : ""}
              </p>
            </li>
          ))}
        </ol>
      )}

      {pages > 1 ? (
        <nav aria-label="Páginas" className="mt-4 flex flex-wrap items-center gap-3">
          {page.page > 1 ? (
            <Link
              href={link(page.page - 1)}
              className="text-primary min-h-11 content-center underline"
            >
              ← Anterior
            </Link>
          ) : null}
          <span className="text-sm">
            Página {page.page} de {pages}
          </span>
          {page.page < pages ? (
            <Link
              href={link(page.page + 1)}
              className="text-primary min-h-11 content-center underline"
            >
              Siguiente →
            </Link>
          ) : null}
        </nav>
      ) : null}
    </>
  );
}
