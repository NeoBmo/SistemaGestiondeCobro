import type { Metadata } from "next";
import Link from "next/link";
import { getCashSummary, MOVEMENT_PAGE_SIZE } from "@/modules/cash/queries";
import {
  CATEGORY_LABEL,
  DIRECTION_LABEL,
  MOVEMENT_LABEL,
  canReverseMovement,
} from "@/modules/cash/presentation";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { formatMoney } from "@/shared/money/money";
import { CashActions } from "./_components/cash-actions";
import { CashFeedbackProvider } from "./_components/cash-feedback";
import { ReverseMovement } from "./_components/reverse-movement";

export const metadata: Metadata = { title: "Caja Mayor" };

export default async function CajaMayorPage() {
  // Los layouts no se vuelven a ejecutar al navegar: cada página protegida comprueba también.
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const summary = await getCashSummary(getPool(), session);
  // Un Admin siempre pertenece a un negocio con zona horaria (getCashSummary ya lo exige).
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El Admin de negocio no tiene zona horaria");

  return (
    <>
      <Link href="/negocio" className="text-primary text-sm underline">
        ← Negocio
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Caja Mayor</h1>

      <section aria-labelledby="saldo" className="border-border mt-4 rounded-lg border p-4">
        <h2 id="saldo" className="text-muted text-sm font-medium">
          Saldo actual
        </h2>
        <p className="mt-1 font-mono text-3xl font-semibold tabular-nums" data-testid="saldo">
          {formatMoney(summary.balance)}
        </p>
        <p className="text-muted mt-1 text-sm">
          Se calcula sumando los movimientos; nunca se escribe a mano ni queda negativo.
        </p>
        {summary.hasOpeningBalance ? null : (
          <p className="mt-3 text-sm font-medium">
            Aún no hay saldo de apertura: regístralo para empezar a llevar la caja.
          </p>
        )}
      </section>

      <CashFeedbackProvider>
        <CashActions hasOpeningBalance={summary.hasOpeningBalance} />

        <section aria-labelledby="historial" className="mt-8">
          <h2 id="historial" className="text-xl font-semibold">
            Historial
          </h2>
          {summary.movements.length === 0 ? (
            <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
              <p className="font-medium">Aún no hay movimientos.</p>
              <p className="text-muted mt-1 text-sm">
                Registra el saldo de apertura o un ingreso de capital para empezar.
              </p>
            </div>
          ) : (
            <ol className="mt-3 flex flex-col gap-3">
              {summary.movements.map((movement) => {
                const label = MOVEMENT_LABEL[movement.type] ?? movement.type;
                const sign = movement.direction === "ENTRADA" ? "+" : "−";
                return (
                  <li
                    key={movement.id}
                    className="border-border rounded-lg border p-3"
                    data-testid="movimiento"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="font-medium">
                        {label}
                        {movement.category
                          ? ` · ${CATEGORY_LABEL[movement.category] ?? movement.category}`
                          : ""}
                      </p>
                      <p className="font-mono text-lg font-semibold tabular-nums">
                        <span aria-hidden="true">
                          {movement.direction === "ENTRADA" ? "▲" : "▼"}{" "}
                        </span>
                        <span className="sr-only">{DIRECTION_LABEL[movement.direction]}: </span>
                        {sign}
                        {formatMoney(movement.amount)}
                      </p>
                    </div>
                    <p className="text-muted text-sm">
                      {formatDateTimeInZone(movement.createdAt, timeZone)} ·{" "}
                      {movement.createdByName}
                    </p>
                    {movement.reason ? (
                      <p className="mt-1 text-sm break-words whitespace-pre-line">
                        Motivo: {movement.reason}
                      </p>
                    ) : null}
                    {movement.note ? (
                      <p className="mt-1 text-sm break-words whitespace-pre-line">
                        {movement.note}
                      </p>
                    ) : null}
                    {movement.reversesMovementId ? (
                      <p className="mt-1 text-sm font-medium">Anula un movimiento anterior.</p>
                    ) : null}
                    {movement.reversedByMovementId ? (
                      <p className="mt-1 text-sm font-medium">⟲ Reversado</p>
                    ) : null}
                    {canReverseMovement(movement) ? (
                      <div className="mt-2">
                        <ReverseMovement
                          movementId={movement.id}
                          label={`${label} de ${formatMoney(movement.amount)}`}
                        />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
          {summary.truncated ? (
            <p className="text-muted mt-3 text-sm">
              Se muestran los {MOVEMENT_PAGE_SIZE} movimientos más recientes; el saldo incluye
              todos.
            </p>
          ) : null}
        </section>
      </CashFeedbackProvider>
    </>
  );
}
