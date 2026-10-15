import type { Metadata } from "next";
import Link from "next/link";
import { getCollectorHome } from "@/modules/collections/collector-queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate } from "@/shared/dates/dates";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { CashFeedbackProvider } from "../negocio/_components/cash-feedback";
import { DeclareSettlementForm, ExpenseForm, OpenSessionForm } from "./_components/collector-forms";

export const metadata: Metadata = { title: "Cobrador" };

const cash = (value: number) => formatMoney(money(value));

export default async function CobradorPage() {
  const session = await getPageSession({ roles: ["COBRADOR"] });
  const home = await getCollectorHome(getPool(), session);

  if (!home) {
    return (
      <Alert variant="warning" title="Tu cuenta no está activa como cobrador">
        Pide al administrador que revise tu acceso.
      </Alert>
    );
  }
  const { session: jornada } = home;

  return (
    <CashFeedbackProvider>
      <h1 className="text-2xl font-semibold">Hola, {home.collectorName}</h1>
      <p className="text-muted text-sm">Hoy es {formatIsoDate(home.today)}.</p>

      <section aria-labelledby="jornada" className="border-border mt-4 rounded-lg border p-4">
        <h2 id="jornada" className="text-xl font-semibold">
          Mi jornada
        </h2>
        {!jornada ? (
          <div className="mt-3 flex flex-col gap-3">
            <p className="text-sm">Abre tu jornada para empezar a cobrar.</p>
            <OpenSessionForm />
          </div>
        ) : (
          <>
            <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div>
                <dt className="text-muted">Fondo</dt>
                <dd className="font-mono tabular-nums">{cash(jornada.fund)}</dd>
              </div>
              <div>
                <dt className="text-muted">Cobrado</dt>
                <dd className="font-mono tabular-nums">{cash(jornada.collected)}</dd>
              </div>
              <div>
                <dt className="text-muted">Gastos</dt>
                <dd className="font-mono tabular-nums">{cash(jornada.spent)}</dd>
              </div>
              <div>
                <dt className="text-muted">Debes tener</dt>
                <dd className="font-mono text-lg font-semibold tabular-nums" data-testid="esperado">
                  {cash(jornada.expected)}
                </dd>
              </div>
            </dl>
            {jornada.status === "ABIERTA" ? (
              <div className="mt-4 flex flex-col gap-3">
                <ExpenseForm />
                <DeclareSettlementForm expected={jornada.expected} />
              </div>
            ) : (
              <div className="mt-4">
                <Alert variant="info">
                  Declaraste entregar {cash(jornada.declaredAmount ?? 0)}. Espera a que el
                  administrador confirme la liquidación para abrir otra jornada.
                </Alert>
              </div>
            )}
          </>
        )}
      </section>

      <section aria-labelledby="meta" className="border-border mt-4 rounded-lg border p-4">
        <h2 id="meta" className="text-xl font-semibold">
          Meta de hoy
        </h2>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums" data-testid="meta">
          {cash(home.dailyGoal)}
        </p>
        <p className="text-muted text-sm">Cuotas vencidas o que vencen hoy en tu ruta.</p>
      </section>

      <section aria-labelledby="clientes" className="mt-6">
        <h2 id="clientes" className="text-xl font-semibold">
          Mis clientes
        </h2>
        {home.clients.length === 0 ? (
          <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">Aún no tienes clientes asignados.</p>
            <p className="text-muted mt-1 text-sm">El administrador te los asignará a tu ruta.</p>
          </div>
        ) : (
          <ol className="mt-3 flex flex-col gap-2">
            {home.clients.map((client) => (
              <li key={client.id}>
                <Link
                  href={`/cobrador/clientes/${client.id}`}
                  data-testid="cliente"
                  className="border-border hover:bg-surface flex min-h-11 flex-col gap-1 rounded-lg border p-3"
                >
                  <span className="font-medium break-words">{client.name}</span>
                  <span className="text-sm">
                    {client.maxDaysLate > 0 ? (
                      <span className="text-danger-strong font-medium">
                        <span aria-hidden="true">⚠ </span>
                        {client.maxDaysLate} {client.maxDaysLate === 1 ? "día" : "días"} de mora
                        ·{" "}
                      </span>
                    ) : null}
                    Vencido <span className="font-mono tabular-nums">{cash(client.overdue)}</span>
                    {client.dueToday > 0 ? (
                      <>
                        {" "}
                        · Hoy{" "}
                        <span className="font-mono tabular-nums">{cash(client.dueToday)}</span>
                      </>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>
    </CashFeedbackProvider>
  );
}
