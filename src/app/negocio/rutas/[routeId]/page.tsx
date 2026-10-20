import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getRouteDetail } from "@/modules/collections/queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { CashFeedbackProvider } from "../../_components/cash-feedback";
import { CloseRouteButton } from "../_components/route-forms";

export const metadata: Metadata = { title: "Ruta" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function RoutePage({ params }: { params: Promise<{ routeId: string }> }) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const { routeId } = await params;
  if (!UUID.test(routeId)) notFound();
  const route = await getRouteDetail(getPool(), session, routeId);
  if (!route) notFound();
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El Admin de negocio no tiene zona horaria");

  return (
    <CashFeedbackProvider>
      <Link href="/negocio/rutas" className="text-primary text-sm underline">
        ← Rutas
      </Link>
      <h1 className="mt-2 text-2xl font-semibold break-words md:text-3xl">{route.name}</h1>
      <p className="text-muted text-sm break-words">
        Cobrador {route.collector.name} · {route.status === "ACTIVA" ? "Activa" : "Cerrada"}
      </p>
      {route.status === "ACTIVA" ? (
        <div className="mt-3">
          <CloseRouteButton routeId={route.id} name={route.name} />
        </div>
      ) : null}

      <section aria-labelledby="clientes" className="mt-8">
        <h2 id="clientes" className="text-xl font-semibold">
          Clientes de la ruta
        </h2>
        {route.clients.length === 0 ? (
          <p className="text-muted mt-3">
            Esta ruta no tiene clientes. Asígnalos desde la ficha de cada cliente.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {route.clients.map((client) => (
              <li key={client.id} className="border-border rounded-lg border p-3">
                <Link
                  href={`/negocio/clientes/${client.id}`}
                  className="text-primary break-words underline"
                >
                  {client.name}
                </Link>
                <p className="text-muted text-sm">
                  <span className="break-all">{client.identification}</span> · desde{" "}
                  {formatDateTimeInZone(client.assignedAt, timeZone)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CashFeedbackProvider>
  );
}
