import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollectorClient } from "@/modules/collections/collector-queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatDateTimeInZone, formatIsoDate } from "@/shared/dates/dates";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { CashFeedbackProvider } from "../../../negocio/_components/cash-feedback";
import { InstallmentBadge } from "../../../negocio/prestamos/_components/installment-badge";
import { RegisterPayment } from "../../../negocio/prestamos/_components/register-payment";
import { AttemptForms } from "../../_components/collector-forms";

export const metadata: Metadata = { title: "Cliente" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const cash = (value: number) => formatMoney(money(value));

const REASON_LABEL: Record<string, string> = {
  CLIENTE_AUSENTE: "El cliente no estaba",
  LUGAR_CERRADO: "Lugar cerrado",
  SIN_DINERO: "Sin dinero",
  DIRECCION_INCORRECTA: "Dirección incorrecta",
  OTRO: "Otro",
};

const linkClass =
  "border-border bg-background hover:bg-surface inline-flex min-h-11 items-center justify-center rounded-lg border px-4 font-medium";

export default async function CollectorClientPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const session = await getPageSession({ roles: ["COBRADOR"] });
  const { clientId } = await params;
  if (!UUID.test(clientId)) notFound();
  const detail = await getCollectorClient(getPool(), session, clientId);
  if (!detail) notFound();
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El cobrador no tiene zona horaria");
  const { client } = detail;
  const whatsappDigits = client.whatsapp?.replace(/\D/g, "") ?? "";
  const phoneLink = client.phone?.replace(/[^+\d]/g, "") ?? "";

  return (
    <CashFeedbackProvider>
      <Link
        href="/cobrador"
        className="text-primary inline-flex min-h-11 items-center text-sm underline"
      >
        ← Mi ruta
      </Link>
      <h1 className="mt-2 text-2xl font-semibold break-words">{client.name}</h1>
      {client.nickname ? <p className="text-muted text-sm">«{client.nickname}»</p> : null}
      {client.address ? <p className="mt-1 text-sm break-words">{client.address}</p> : null}

      <div className="mt-3 flex flex-wrap gap-2" aria-label="Contactar">
        {phoneLink ? (
          <a href={`tel:${phoneLink}`} className={linkClass}>
            Llamar
          </a>
        ) : null}
        {whatsappDigits ? (
          <a
            href={`https://wa.me/${whatsappDigits}`}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            WhatsApp
          </a>
        ) : null}
        {client.address ? (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(client.address)}`}
            target="_blank"
            rel="noopener noreferrer"
            className={linkClass}
          >
            Mapa
          </a>
        ) : null}
      </div>

      {detail.loans.length === 0 ? (
        <div className="border-border mt-6 rounded-lg border border-dashed p-6 text-center">
          <p className="font-medium">Este cliente no tiene préstamos activos.</p>
        </div>
      ) : (
        detail.loans.map((loan) => (
          <section
            key={loan.loanId}
            aria-labelledby={`prestamo-${loan.loanId}`}
            className="border-border mt-6 rounded-lg border p-4"
          >
            <h2 id={`prestamo-${loan.loanId}`} className="text-xl font-semibold">
              Contrato {loan.contractNumber}
            </h2>
            <p className="mt-1 text-sm">
              Saldo pendiente{" "}
              <span className="font-mono font-semibold tabular-nums">
                {cash(loan.pendingBalance)}
              </span>
            </p>
            <ol className="mt-3 flex flex-col gap-2">
              {loan.installments
                .filter((item) => item.pendingAmount > 0)
                .map((item) => (
                  <li
                    key={item.number}
                    className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3 text-sm"
                  >
                    <span>
                      Cuota {item.number} · {formatIsoDate(item.dueOn)}
                    </span>
                    <span className="font-mono tabular-nums">{cash(item.pendingAmount)}</span>
                    <InstallmentBadge
                      status={item.status}
                      daysLate={item.daysLate}
                      partial={item.appliedAmount > 0}
                    />
                  </li>
                ))}
            </ol>
            <div className="mt-4">
              {detail.sessionStatus === "ABIERTA" ? (
                <RegisterPayment
                  url="/api/cobrador/pagos"
                  loanId={loan.loanId}
                  installments={loan.installments.map((item) => ({
                    number: item.number,
                    pendingAmount: item.pendingAmount,
                  }))}
                  lateFees={loan.lateFees}
                />
              ) : (
                <Alert variant="info">
                  {detail.sessionStatus === "PENDIENTE_LIQUIDACION"
                    ? "Tu entrega está pendiente de confirmación: no se registran más cobros en esa jornada."
                    : "Abre tu jornada para registrar cobros de este cliente."}
                </Alert>
              )}
            </div>
          </section>
        ))
      )}

      <section aria-labelledby="intentos" className="mt-8">
        <h2 id="intentos" className="text-xl font-semibold">
          Visitas sin cobro
        </h2>
        <div className="mt-3">
          <AttemptForms clientId={client.id} />
        </div>
        {detail.attempts.length === 0 ? (
          <p className="text-muted mt-3 text-sm">Todavía no registraste visitas sin cobro.</p>
        ) : (
          <ul className="mt-3 flex flex-col gap-2">
            {detail.attempts.map((attempt) => (
              <li key={attempt.id} className="border-border rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {attempt.type === "INTENTO_FALLIDO"
                    ? `No se pudo cobrar: ${REASON_LABEL[attempt.reason ?? ""] ?? attempt.reason}`
                    : "Volver a cobrar"}
                </p>
                <p className="text-muted break-words">
                  {formatDateTimeInZone(attempt.createdAt, timeZone)}
                  {attempt.retryAt
                    ? ` · volver el ${formatDateTimeInZone(attempt.retryAt, timeZone)}`
                    : ""}
                  {attempt.note ? ` · ${attempt.note}` : ""}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </CashFeedbackProvider>
  );
}
