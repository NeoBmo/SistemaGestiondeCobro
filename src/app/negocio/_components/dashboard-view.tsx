import Link from "next/link";
import type { DashboardAlert, DashboardData } from "@/modules/dashboard/queries";
import { PERIOD_LABEL } from "@/modules/dashboard/periods";
import { WIDGET_LABEL, type Widget } from "@/modules/dashboard/widgets";
import { formatIsoDate } from "@/shared/dates/dates";
import { formatMoney, type Money } from "@/shared/money/money";

const cash = formatMoney;

function Card({ id, title, children }: { id: Widget; title: string; children: React.ReactNode }) {
  return (
    <section
      aria-labelledby={`w-${id}`}
      data-testid={`widget-${id}`}
      className="border-border rounded-lg border p-4"
    >
      <h3 id={`w-${id}`} className="text-muted text-sm font-medium">
        {title}
      </h3>
      {children}
    </section>
  );
}

const Figure = ({ value, testId }: { value: Money; testId?: string }) => (
  <p className="mt-1 font-mono text-2xl font-semibold tabular-nums" data-testid={testId}>
    {cash(value)}
  </p>
);

function alertText(alert: DashboardAlert): { text: string; href?: string } {
  switch (alert.kind) {
    case "OVERDUE":
      return {
        text: `${alert.clients} ${alert.clients === 1 ? "cliente tiene" : "clientes tienen"} cuotas vencidas por ${cash(alert.amount)}.`,
        href: "/negocio/cartera?estado=EN_MORA",
      };
    case "PENDING_SESSIONS":
      return {
        text: `${alert.count} ${alert.count === 1 ? "jornada espera" : "jornadas esperan"} su liquidación.`,
        href: "/negocio/jornadas",
      };
    case "UNRESOLVED_DIFFERENCES":
      return {
        text: `${alert.count} ${alert.count === 1 ? "diferencia de caja sin resolver" : "diferencias de caja sin resolver"} (${cash(alert.amount)}).`,
        href: "/negocio/jornadas",
      };
    case "SUBSCRIPTION":
      return {
        text:
          alert.status === "VENCIDA"
            ? `Tu suscripción venció el ${formatIsoDate(alert.expiresOn)}.`
            : `Tu suscripción vence el ${formatIsoDate(alert.expiresOn)}.`,
      };
  }
}

/** Dashboard del Admin (ADR 0010): alertas derivadas arriba y los indicadores en el orden configurado. */
export function DashboardView({ data }: { data: DashboardData }) {
  const { config } = data;
  return (
    <section aria-labelledby="dashboard">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="dashboard" className="text-xl font-semibold">
          Resumen
        </h2>
        <p className="text-muted text-sm">
          {PERIOD_LABEL[config.period]} · {formatIsoDate(data.range.from)} al{" "}
          {formatIsoDate(data.range.to)}
        </p>
      </div>

      {data.alerts.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-2" aria-label="Alertas" data-testid="alertas">
          {data.alerts.map((alert) => {
            const { text, href } = alertText(alert);
            return (
              <li
                key={alert.kind}
                className="border-warning bg-warning-subtle text-warning-strong rounded-lg border p-3 text-sm font-medium"
              >
                <span aria-hidden="true">! </span>
                {href ? (
                  <Link href={href} className="underline">
                    {text}
                  </Link>
                ) : (
                  text
                )}
              </li>
            );
          })}
        </ul>
      ) : null}

      {config.widgets.length === 0 ? (
        <p className="text-muted mt-4 text-sm">No elegiste ningún indicador: configúralos abajo.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {config.widgets.map((widget) => (
            <Widget key={widget} widget={widget} data={data} />
          ))}
        </div>
      )}
    </section>
  );
}

function Widget({ widget, data }: { widget: Widget; data: DashboardData }) {
  const title = WIDGET_LABEL[widget];
  switch (widget) {
    case "CASH_BALANCE":
      return (
        <Card id={widget} title={title}>
          <Figure value={data.cashBalance} testId="saldo-caja" />
          <Link href="/negocio/caja" className="text-primary text-sm underline">
            Ver caja
          </Link>
        </Card>
      );
    case "PORTFOLIO_PENDING":
      return (
        <Card id={widget} title={title}>
          <Figure value={data.portfolio.pending} testId="cartera-pendiente" />
          <p className="text-muted text-sm">
            {data.portfolio.activeLoans}{" "}
            {data.portfolio.activeLoans === 1 ? "préstamo" : "préstamos"} con saldo
          </p>
        </Card>
      );
    case "PORTFOLIO_OVERDUE":
      return (
        <Card id={widget} title={title}>
          <Figure value={data.portfolio.overdue} testId="cartera-vencida" />
          <p className="text-sm">
            {data.portfolio.clientsInArrears > 0 ? <span aria-hidden="true">⚠ </span> : null}
            {data.portfolio.clientsInArrears}{" "}
            {data.portfolio.clientsInArrears === 1 ? "cliente en mora" : "clientes en mora"}
          </p>
        </Card>
      );
    case "COLLECTED":
      return (
        <Card id={widget} title={title}>
          <Figure value={data.collected} testId="cobrado" />
          <p className="text-muted text-sm">Neto de reversos</p>
        </Card>
      );
    case "SPENT":
      return (
        <Card id={widget} title={title}>
          <Figure value={data.spent} testId="gastos" />
          <p className="text-muted text-sm">Caja Mayor y cobradores</p>
        </Card>
      );
    case "SETTLEMENTS":
      return (
        <Card id={widget} title={title}>
          <p className="mt-1 text-lg font-semibold" data-testid="jornadas">
            {data.sessions.pending} {data.sessions.pending === 1 ? "pendiente" : "pendientes"} de
            liquidar
          </p>
          <p className="text-sm">
            {data.sessions.unresolvedDifferences}{" "}
            {data.sessions.unresolvedDifferences === 1
              ? "diferencia sin resolver"
              : "diferencias sin resolver"}
            {data.sessions.unresolvedDifferences > 0
              ? ` (${cash(data.sessions.unresolvedAmount)})`
              : ""}
          </p>
          <Link href="/negocio/jornadas" className="text-primary text-sm underline">
            Ver jornadas
          </Link>
        </Card>
      );
    case "PROJECTION":
      return (
        <Card id={widget} title={title}>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {data.projection.map((day) => (
              <li key={day.date} className="flex justify-between gap-3">
                <span>{formatIsoDate(day.date)}</span>
                <span className="font-mono tabular-nums">{cash(day.amount)}</span>
              </li>
            ))}
          </ul>
        </Card>
      );
  }
}
