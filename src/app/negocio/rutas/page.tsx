import type { Metadata } from "next";
import Link from "next/link";
import { listCollectors, listRoutes } from "@/modules/collections/queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate, isoDate } from "@/shared/dates/dates";
import { CashFeedbackProvider } from "../_components/cash-feedback";
import { CreateRouteForm } from "./_components/route-forms";

export const metadata: Metadata = { title: "Rutas" };

export default async function RoutesPage() {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const db = getPool();
  const [routes, collectors] = await Promise.all([
    listRoutes(db, session),
    listCollectors(db, session),
  ]);
  // Solo los cobradores activos sin ruta activa pueden recibir una ruta nueva.
  const free = collectors.filter((c) => c.status === "ACTIVO" && !c.activeRoute);

  return (
    <CashFeedbackProvider>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Rutas</h1>
      <p className="text-muted mt-1 text-sm">
        Cada ruta es la lista de clientes de un cobrador. Asigna los clientes desde su ficha.
      </p>

      <div className="mt-4">
        {free.length === 0 ? (
          <p className="text-muted text-sm">
            Para crear una ruta necesitas un cobrador activo que aún no tenga una.{" "}
            <Link href="/negocio/cobradores" className="text-primary underline">
              Ir a cobradores
            </Link>
          </p>
        ) : (
          <CreateRouteForm collectors={free.map((c) => ({ id: c.id, name: c.name }))} />
        )}
      </div>

      {routes.length === 0 ? (
        <div className="border-border mt-6 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Aún no hay rutas.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {routes.map((route) => (
            <li key={route.id} data-testid="ruta" className="border-border rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link
                  href={`/negocio/rutas/${route.id}`}
                  className="text-primary text-lg font-medium underline"
                >
                  {route.name}
                </Link>
                <span className="border-border bg-surface inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
                  <span aria-hidden="true">{route.status === "ACTIVA" ? "✓" : "▣"}</span>
                  {route.status === "ACTIVA" ? "Activa" : "Cerrada"}
                </span>
              </div>
              <p className="text-muted text-sm">
                Cobrador {route.collector.name} · desde {formatIsoDate(isoDate(route.startedOn))} ·{" "}
                {route.clientCount} {route.clientCount === 1 ? "cliente" : "clientes"}
              </p>
            </li>
          ))}
        </ul>
      )}
    </CashFeedbackProvider>
  );
}
