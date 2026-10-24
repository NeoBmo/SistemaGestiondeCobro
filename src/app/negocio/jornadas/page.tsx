import type { Metadata } from "next";
import Link from "next/link";
import { listSessions } from "@/modules/collections/queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate, isoDate } from "@/shared/dates/dates";
import { formatMoney, money } from "@/shared/money/money";
import { CashFeedbackProvider } from "../_components/cash-feedback";
import {
  ConfirmSettlementForm,
  FundForm,
  AssumeDifferenceForm,
  ResolveDifferenceForm,
} from "./_components/session-forms";

export const metadata: Metadata = { title: "Jornadas" };

const STATUS = {
  ABIERTA: { icon: "●", label: "Abierta" },
  PENDIENTE_LIQUIDACION: { icon: "◐", label: "Pendiente de liquidar" },
  LIQUIDADA: { icon: "✓", label: "Liquidada" },
  LIQUIDADA_CON_DIFERENCIA: { icon: "⚠", label: "Liquidada con diferencia" },
} as const;

const cash = (value: number) => formatMoney(money(value));

export default async function SessionsPage() {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const sessions = await listSessions(getPool(), session);

  return (
    <CashFeedbackProvider>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Jornadas de cobro</h1>
      <p className="text-muted mt-1 text-sm">
        Entrega fondo a cada jornada y confirma la liquidación cuando el cobrador entregue el
        dinero.
      </p>

      {sessions.length === 0 ? (
        <div className="border-border mt-6 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Todavía no hay jornadas.</p>
          <p className="text-muted mt-1 text-sm">Aparecen cuando un cobrador abre la suya.</p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-4">
          {sessions.map((item) => (
            <li key={item.id} data-testid="jornada" className="border-border rounded-lg border p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-lg font-medium break-words">
                  {item.collector.name} · {formatIsoDate(isoDate(item.businessDate))}
                </p>
                <span className="border-border bg-surface inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium">
                  <span aria-hidden="true">{STATUS[item.status].icon}</span>
                  {STATUS[item.status].label}
                </span>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-muted">Fondo</dt>
                  <dd className="font-mono tabular-nums">{cash(item.fund)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Cobrado</dt>
                  <dd className="font-mono tabular-nums">{cash(item.collected)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Gastos</dt>
                  <dd className="font-mono tabular-nums">{cash(item.spent)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Esperado</dt>
                  <dd className="font-mono font-semibold tabular-nums">{cash(item.expected)}</dd>
                </div>
              </dl>

              {item.settlement ? (
                <div className="mt-3 text-sm">
                  <p>
                    Declaró entregar{" "}
                    <span className="font-mono tabular-nums">
                      {cash(item.settlement.declaredAmount)}
                    </span>
                    {item.settlement.receivedAmount !== null ? (
                      <>
                        {" "}
                        · recibido{" "}
                        <span className="font-mono tabular-nums">
                          {cash(item.settlement.receivedAmount)}
                        </span>
                      </>
                    ) : null}
                  </p>
                  {item.settlement.difference ? (
                    <p className="mt-1 font-medium break-words">
                      <span aria-hidden="true">⚠ </span>
                      {item.settlement.difference > 0 ? "Faltante" : "Sobrante"} de{" "}
                      <span className="font-mono tabular-nums">
                        {cash(Math.abs(item.settlement.difference))}
                      </span>
                      {item.settlement.observation ? `: ${item.settlement.observation}` : ""}
                      {item.settlement.resolution === "REPOSICION"
                        ? " · Resuelta por reposición"
                        : item.settlement.resolution === "ASUMIDA"
                          ? " · Asumida por el negocio"
                          : " · Sin resolver"}
                    </p>
                  ) : null}
                </div>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-3">
                {item.status === "ABIERTA" ? (
                  <FundForm sessionId={item.id} collectorName={item.collector.name} />
                ) : null}
                {item.settlement?.status === "PENDIENTE_REVISION" ? (
                  <ConfirmSettlementForm
                    settlementId={item.settlement.id}
                    declaredAmount={item.settlement.declaredAmount}
                    expectedAmount={item.expected}
                  />
                ) : null}
                {item.settlement?.status === "CON_DIFERENCIA" && !item.settlement.resolved ? (
                  <>
                    <ResolveDifferenceForm
                      settlementId={item.settlement.id}
                      difference={item.settlement.difference ?? 0}
                    />
                    <AssumeDifferenceForm
                      settlementId={item.settlement.id}
                      difference={item.settlement.difference ?? 0}
                    />
                  </>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </CashFeedbackProvider>
  );
}
