import type { Metadata } from "next";
import Link from "next/link";
import { getCashSummary } from "@/modules/cash/queries";
import { getDashboard } from "@/modules/dashboard/queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatMoney } from "@/shared/money/money";
import { CashFeedbackProvider } from "./_components/cash-feedback";
import { DashboardSettings } from "./_components/dashboard-settings";
import { DashboardView } from "./_components/dashboard-view";

export const metadata: Metadata = { title: "Negocio" };

export default async function NegocioPage() {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const db = getPool();
  const [summary, dashboard] = await Promise.all([
    getCashSummary(db, session),
    getDashboard(db, session),
  ]);

  return (
    <CashFeedbackProvider>
      <h1 className="text-2xl font-semibold md:text-3xl">Negocio</h1>
      <div className="mt-4">
        <DashboardView data={dashboard} />
        {dashboard.config.configurable ? (
          <div className="mt-4">
            <DashboardSettings
              initial={{ period: dashboard.config.period, widgets: dashboard.config.widgets }}
            />
          </div>
        ) : (
          <p className="text-muted mt-3 text-sm">
            Tu plan muestra el resumen predeterminado de los últimos 7 días.
          </p>
        )}
      </div>

      <section aria-labelledby="caja" className="border-border mt-6 max-w-md rounded-lg border p-4">
        <h2 id="caja" className="text-lg font-medium">
          Caja Mayor
        </h2>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
          {formatMoney(summary.balance)}
        </p>
        <Link
          href="/negocio/caja"
          className="bg-primary text-primary-foreground mt-3 inline-flex min-h-11 items-center rounded-lg px-4 font-medium"
        >
          {summary.hasOpeningBalance
            ? "Ver y registrar movimientos"
            : "Registrar saldo de apertura"}
        </Link>
      </section>

      <section
        aria-labelledby="cobranza"
        className="border-border mt-4 max-w-md rounded-lg border p-4"
      >
        <h2 id="cobranza" className="text-lg font-medium">
          Cobranza
        </h2>
        <p className="text-muted mt-1 text-sm">
          Cobradores, rutas, fondo de cada jornada y liquidaciones.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {[
            ["/negocio/cobradores", "Cobradores"],
            ["/negocio/rutas", "Rutas"],
            ["/negocio/jornadas", "Jornadas"],
            ["/negocio/cartera", "Cartera"],
            ["/negocio/soporte", "Soporte"],
          ].map(([href, label]) => (
            <Link
              key={href}
              href={href!}
              className="border-border bg-background hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
            >
              {label}
            </Link>
          ))}
        </div>
      </section>

      <section
        aria-labelledby="clientes"
        className="border-border mt-4 max-w-md rounded-lg border p-4"
      >
        <h2 id="clientes" className="text-lg font-medium">
          Clientes
        </h2>
        <p className="text-muted mt-1 text-sm">Registra y consulta a quienes te piden prestado.</p>
        <Link
          href="/negocio/clientes"
          className="bg-primary text-primary-foreground mt-3 inline-flex min-h-11 items-center rounded-lg px-4 font-medium"
        >
          Ver clientes
        </Link>
      </section>
    </CashFeedbackProvider>
  );
}
