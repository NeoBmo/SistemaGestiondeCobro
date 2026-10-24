import type { Metadata } from "next";
import { getPageSession } from "@/modules/identity/page-session";
import { formatRateBps } from "@/modules/portfolio/effective-annual-rate";
import { currentUsuryRate, listUsuryRates } from "@/modules/portfolio/usury";
import { DEFAULT_TIME_ZONE } from "@/modules/subscriptions/create-business";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone, formatIsoDate, localDateIn } from "@/shared/dates/dates";
import { Alert } from "@/shared/ui/alert";
import { UsuryRateForm } from "../_components/usury-rate-form";
import { CashFeedbackProvider } from "../../negocio/_components/cash-feedback";

export const metadata: Metadata = { title: "Tasa de usura" };

export default async function UsuryPage() {
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  const db = getPool();
  // La plataforma opera en Colombia: «hoy» es el de Bogotá.
  const today = localDateIn(new Date(), DEFAULT_TIME_ZONE);
  const [current, history] = await Promise.all([
    currentUsuryRate(db, today),
    listUsuryRates(db, session),
  ]);

  return (
    <CashFeedbackProvider>
      <h1 className="text-2xl font-semibold md:text-3xl">Tasa de usura</h1>
      <p className="text-muted mt-1 text-sm">
        Al crear o refinanciar un préstamo, si su tasa efectiva anual supera la usura vigente, el
        sistema lo advierte y el Admin debe marcarlo para confirmar. No se bloquea.
      </p>

      <section aria-labelledby="vigente" className="mt-6">
        <h2 id="vigente" className="text-xl font-semibold">
          Vigente hoy
        </h2>
        {current ? (
          <div className="border-border mt-3 rounded-lg border p-4" data-testid="usura-vigente">
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatRateBps(current.rateBps)} E.A.
            </p>
            <p className="mt-1 text-sm">
              Desde el {formatIsoDate(current.validFrom)} · {current.source}
            </p>
          </div>
        ) : (
          <div className="mt-3">
            <Alert variant="warning" title="No hay tasa de usura vigente">
              Mientras no registres una, los préstamos nuevos no se comparan con la usura y la vista
              previa lo indica.
            </Alert>
          </div>
        )}
        <div className="mt-4">
          <UsuryRateForm today={today} />
        </div>
      </section>

      <section aria-labelledby="historial" className="mt-8">
        <h2 id="historial" className="text-xl font-semibold">
          Historial
        </h2>
        <p className="text-muted mt-1 text-sm">
          Una tasa registrada no se edita: para corregirla, registra otra con la misma fecha.
        </p>
        {history.length === 0 ? (
          <p className="text-muted mt-2 text-sm">Todavía no se ha registrado ninguna tasa.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {history.map((rate) => (
              <li key={rate.id} className="border-border rounded-lg border p-3 text-sm">
                <span className="font-mono font-medium tabular-nums">
                  {formatRateBps(rate.rateBps)} E.A.
                </span>{" "}
                desde el {formatIsoDate(rate.validFrom)}
                {rate.id === current?.id ? " · vigente" : ""}
                <span className="text-muted block break-words">
                  {rate.source} · registrada el{" "}
                  {formatDateTimeInZone(rate.registeredAt, DEFAULT_TIME_ZONE)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CashFeedbackProvider>
  );
}
