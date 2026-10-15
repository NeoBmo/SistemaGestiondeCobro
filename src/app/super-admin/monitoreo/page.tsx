import type { Metadata } from "next";
import Link from "next/link";
import { getPageSession } from "@/modules/identity/page-session";
import { getPlatformIndicators, STALE_AFTER_MINUTES } from "@/modules/monitoring/indicators";
import { DEFAULT_TIME_ZONE } from "@/modules/subscriptions/create-business";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone, formatIsoDate, isoDate, localDateIn } from "@/shared/dates/dates";
import { Alert } from "@/shared/ui/alert";
import { BackupCheckForm } from "../../_components/ticket-forms";
import { CashFeedbackProvider } from "../../negocio/_components/cash-feedback";

export const metadata: Metadata = { title: "Monitoreo" };

const BACKUP_ALERT = {
  SIN_REGISTRO: "Todavía no hay ninguna verificación de backup registrada.",
  FALLO: "La última verificación de backup falló.",
  VENCIDO: "Pasó más de un día sin verificar el backup (se espera una verificación diaria).",
  INCOMPLETO: "No hay una verificación correcta por cada uno de los últimos 7 días.",
} as const;

const percent = (value: number | null) => (value === null ? "—" : `${value} %`);
const ms = (value: number | null) => (value === null ? "—" : `${value} ms`);

export default async function MonitoringPage() {
  const session = await getPageSession({ roles: ["SUPER_ADMIN"] });
  const now = new Date();
  const data = await getPlatformIndicators(getPool(), session, now);
  const when = (date: Date) => formatDateTimeInZone(date, DEFAULT_TIME_ZONE);
  const open = data.tickets.ALTA + data.tickets.MEDIA + data.tickets.BAJA;

  return (
    <CashFeedbackProvider>
      <h1 className="text-2xl font-semibold md:text-3xl">Monitoreo</h1>
      <p className="text-muted mt-1 text-sm">Salud básica de la plataforma, con datos propios.</p>

      {data.stale ? (
        <div className="mt-4" data-testid="interrupcion">
          <Alert variant="error" title="Posible interrupción">
            {data.lastCheckAt
              ? `No hay chequeos desde hace ${data.minutesSinceLastCheck} minutos (el límite es ${STALE_AFTER_MINUTES}). Último: ${when(data.lastCheckAt)}.`
              : "Todavía no hay chequeos de disponibilidad: configura el servicio que llama a /api/monitoreo/chequeo."}
          </Alert>
        </div>
      ) : null}

      <section aria-labelledby="disponibilidad" className="mt-6">
        <h2 id="disponibilidad" className="text-xl font-semibold">
          Disponibilidad y latencia
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {[
            ["Últimas 24 horas", data.last24h],
            ["Últimos 7 días", data.last7d],
          ].map(([label, window]) => {
            const w = window as typeof data.last24h;
            return (
              <div key={label as string} className="border-border rounded-lg border p-4">
                <h3 className="text-muted text-sm font-medium">{label as string}</h3>
                <p
                  className="mt-1 font-mono text-2xl font-semibold tabular-nums"
                  data-testid={`disp-${label}`}
                >
                  {percent(w.availability)}
                </p>
                <p className="text-sm">
                  {w.checks} {w.checks === 1 ? "chequeo" : "chequeos"} · promedio{" "}
                  {ms(w.averageLatencyMs)} · p95 {ms(w.p95LatencyMs)}
                </p>
              </div>
            );
          })}
        </div>
        {data.interruptions.length > 0 ? (
          <ul
            className="mt-3 flex flex-col gap-1 text-sm"
            aria-label="Chequeos fallidos de las últimas 24 horas"
          >
            {data.interruptions.map((item) => (
              <li key={item.checkedAt.toISOString()}>
                <span aria-hidden="true">⚠ </span>
                {when(item.checkedAt)}: {!item.databaseOk ? "base de datos" : "autenticación"} sin
                respuesta ({item.latencyMs} ms)
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      <section aria-labelledby="errores" className="mt-8">
        <h2 id="errores" className="text-xl font-semibold">
          Errores
        </h2>
        <p className="mt-2 text-sm" data-testid="errores24h">
          {data.errors24h} {data.errors24h === 1 ? "error" : "errores"} en las últimas 24 horas.
        </p>
        {data.recentErrors.length === 0 ? (
          <p className="text-muted mt-1 text-sm">Sin errores registrados.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {data.recentErrors.map((error) => (
              <li key={error.id}>
                {when(error.occurredAt)} · <span className="font-mono">{error.route}</span>
                {error.errorName ? ` · ${error.errorName}` : ""}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="backups" className="mt-8">
        <h2 id="backups" className="text-xl font-semibold">
          Backups
        </h2>
        {data.backup.last ? (
          <p className="mt-2 text-sm" data-testid="ultimo-backup">
            Última verificación: {formatIsoDate(isoDate(data.backup.last.checkedOn))} ·{" "}
            {data.backup.last.result === "OK" ? "correcta" : "con fallo"} ·{" "}
            {data.backup.okDaysLast7} de 7 días correctos
            {data.backup.last.note ? ` · ${data.backup.last.note}` : ""}
          </p>
        ) : null}
        {data.backup.alert ? (
          <div className="mt-2">
            <Alert variant="warning">{BACKUP_ALERT[data.backup.alert]}</Alert>
          </div>
        ) : null}
        <div className="mt-3">
          <BackupCheckForm today={localDateIn(now, "UTC")} />
        </div>
      </section>

      <section aria-labelledby="tickets" className="mt-8">
        <h2 id="tickets" className="text-xl font-semibold">
          Tickets abiertos
        </h2>
        <p className="mt-2 text-sm" data-testid="tickets-abiertos">
          {open} abiertos: {data.tickets.ALTA} de prioridad alta, {data.tickets.MEDIA} media y{" "}
          {data.tickets.BAJA} baja.{" "}
          <Link href="/super-admin/soporte" className="text-primary underline">
            Ver soporte
          </Link>
        </p>
      </section>

      <section aria-labelledby="suscripciones" className="mt-8">
        <h2 id="suscripciones" className="text-xl font-semibold">
          Suscripciones por vencer
        </h2>
        <p className="text-muted mt-1 text-sm">
          Es solo un aviso: nunca se suspende un negocio por vencer.
        </p>
        {data.subscriptions.length === 0 ? (
          <p className="text-muted mt-2 text-sm">Ninguna suscripción vence pronto.</p>
        ) : (
          <ul className="mt-2 flex flex-col gap-2">
            {data.subscriptions.map((item) => (
              <li key={item.businessId} className="border-border rounded-lg border p-3 text-sm">
                <Link
                  href={`/super-admin/negocios/${item.businessId}`}
                  className="text-primary font-medium underline"
                >
                  {item.businessName}
                </Link>{" "}
                · {item.status === "VENCIDA" ? "Venció" : "Vence"} el{" "}
                {formatIsoDate(item.expiresOn)} · acceso{" "}
                {item.accessStatus === "ACTIVO" ? "activo" : "suspendido"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </CashFeedbackProvider>
  );
}
