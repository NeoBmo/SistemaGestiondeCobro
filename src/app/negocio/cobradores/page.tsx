import type { Metadata } from "next";
import Link from "next/link";
import { listCollectors } from "@/modules/collections/queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { CashFeedbackProvider } from "../_components/cash-feedback";
import { CollectorActions, CreateCollectorForm } from "./_components/collector-forms";

export const metadata: Metadata = { title: "Cobradores" };

const SESSION_LABEL = {
  ABIERTA: "Jornada abierta",
  PENDIENTE_LIQUIDACION: "Pendiente de liquidar",
} as const;

export default async function CollectorsPage() {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const collectors = await listCollectors(getPool(), session);

  return (
    <CashFeedbackProvider>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Cobradores</h1>
      <p className="text-muted mt-1 text-sm">
        Crea a quienes cobran por ti, asígnales una ruta y dales fondo cada jornada.
      </p>

      <div className="mt-4">
        <CreateCollectorForm />
      </div>

      {collectors.length === 0 ? (
        <div className="border-border mt-6 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Aún no tienes cobradores.</p>
          <p className="text-muted mt-1 text-sm">Crea el primero para asignarle una ruta.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-3">
          {collectors.map((collector) => (
            <li
              key={collector.id}
              data-testid="cobrador"
              className="border-border flex flex-col gap-3 rounded-lg border p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-medium break-words">{collector.name}</p>
                <span className="border-border bg-surface inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
                  <span aria-hidden="true">{collector.status === "ACTIVO" ? "✓" : "▣"}</span>
                  {collector.status === "ACTIVO" ? "Activo" : "Inactivo"}
                </span>
              </div>
              <p className="text-muted text-sm">
                Usuario: <span className="font-mono">{collector.username}</span> ·{" "}
                {collector.activeRoute ? (
                  <Link
                    href={`/negocio/rutas/${collector.activeRoute.id}`}
                    className="text-primary underline"
                  >
                    Ruta {collector.activeRoute.name}
                  </Link>
                ) : (
                  "Sin ruta activa"
                )}{" "}
                · {collector.clientCount} {collector.clientCount === 1 ? "cliente" : "clientes"}
                {collector.session ? ` · ${SESSION_LABEL[collector.session.status]}` : ""}
              </p>
              <CollectorActions
                collectorId={collector.id}
                name={collector.name}
                active={collector.status === "ACTIVO"}
              />
            </li>
          ))}
        </ul>
      )}
    </CashFeedbackProvider>
  );
}
