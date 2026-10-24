import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { getClientAssignment, listAssignableRoutes } from "@/modules/collections/queries";
import { getClientBehavior } from "@/modules/dashboard/portfolio";
import { getClientDetail } from "@/modules/portfolio/client-queries";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate } from "@/shared/dates/dates";
import { formatMoney } from "@/shared/money/money";
import { CashFeedbackProvider } from "../../_components/cash-feedback";
import { AssignClientForm } from "../../rutas/_components/route-forms";
import { ClientForm } from "../_components/client-form";
import { DeleteClientButton } from "../_components/delete-client-button";

export const metadata: Metadata = { title: "Cliente" };

/** Por qué no se ofrece eliminar (02 §2.1: solo un cliente sin historial se elimina). */
const DELETION_BLOCKED = {
  HAS_CONTRACTS: "Este cliente tiene contratos o préstamos, así que no se puede eliminar.",
  HAS_COLLECTION_HISTORY:
    "Este cliente tiene historial de rutas o de intentos de cobro, así que no se puede eliminar.",
} as const;

const FREQUENCY_LABEL = {
  DIARIA: ["diaria", "diarias"],
  SEMANAL: ["semanal", "semanales"],
  MENSUAL: ["mensual", "mensuales"],
} as const;

export default async function ClientPage({ params }: { params: Promise<{ clientId: string }> }) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const { clientId } = await params;
  const detail = await getClientDetail(getPool(), session, clientId);
  if (!detail) notFound();
  const { client, loans, deletionBlocker } = detail;
  const db = getPool();
  const [assignment, routes, behavior] = await Promise.all([
    getClientAssignment(db, session, client.id),
    listAssignableRoutes(db, session),
    getClientBehavior(db, session, client.id),
  ]);

  return (
    <>
      <Link href="/negocio/clientes" className="text-primary text-sm underline">
        ← Clientes
      </Link>
      <h1 className="mt-2 text-2xl font-semibold break-words md:text-3xl">{client.name}</h1>
      {client.nickname ? <p className="text-muted text-sm">«{client.nickname}»</p> : null}

      <section aria-labelledby="prestamos" className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="prestamos" className="text-xl font-semibold">
            Préstamos
          </h2>
          <Link
            href={`/negocio/prestamos/nuevo?cliente=${client.id}`}
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-4 font-medium"
          >
            Nuevo préstamo
          </Link>
          <Link
            href={`/negocio/prestamos/importar?cliente=${client.id}`}
            className="border-border bg-background hover:bg-surface inline-flex min-h-11 items-center rounded-lg border px-4 font-medium"
          >
            Importar préstamo anterior
          </Link>
        </div>
        {loans.length === 0 ? (
          <div className="border-border mt-3 rounded-lg border border-dashed p-6 text-center">
            <p className="font-medium">Este cliente aún no tiene préstamos.</p>
          </div>
        ) : (
          <ul className="mt-3 flex flex-col gap-3">
            {loans.map((loan) => (
              <li key={loan.loanId} className="border-border rounded-lg border p-3">
                <p className="font-medium">
                  <Link
                    href={`/negocio/prestamos/${loan.loanId}`}
                    className="text-primary underline"
                  >
                    Contrato {loan.contractNumber}
                  </Link>
                  {loan.status === "ANULADO" ? " · Anulado" : ""}
                </p>
                <p className="text-sm">
                  Prestado{" "}
                  <span className="font-mono tabular-nums">{formatMoney(loan.principal)}</span> ·
                  total <span className="font-mono tabular-nums">{formatMoney(loan.total)}</span> ·{" "}
                  {loan.installmentCount === 1 ? "1 cuota" : `${loan.installmentCount} cuotas`}{" "}
                  {FREQUENCY_LABEL[loan.frequency][loan.installmentCount === 1 ? 0 : 1]} ·
                  desembolsado el {formatIsoDate(loan.disbursedOn)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="comportamiento" className="mt-8">
        <h2 id="comportamiento" className="text-xl font-semibold">
          Historial de comportamiento
        </h2>
        <p className="text-muted mt-1 text-sm">Cifras de sus cuotas; no es un puntaje.</p>
        <dl
          className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3"
          data-testid="comportamiento"
        >
          <div>
            <dt className="text-muted text-sm">Cuotas pagadas a tiempo</dt>
            <dd className="font-mono tabular-nums">{behavior.paidOnTime}</dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Cuotas pagadas tarde</dt>
            <dd className="font-mono tabular-nums">{behavior.paidLate}</dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Cuotas vencidas hoy</dt>
            <dd className="font-mono tabular-nums">{behavior.overdueInstallments}</dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Días de mora actual</dt>
            <dd className="font-mono tabular-nums">{behavior.maxDaysLate}</dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Saldo vencido</dt>
            <dd className="font-mono tabular-nums">{formatMoney(behavior.overdue)}</dd>
          </div>
          <div>
            <dt className="text-muted text-sm">Refinanciaciones</dt>
            <dd className="font-mono tabular-nums">{behavior.refinancings}</dd>
          </div>
        </dl>
      </section>

      <section aria-labelledby="cartera" className="mt-8">
        <h2 id="cartera" className="text-xl font-semibold">
          Ruta de cobro
        </h2>
        <p className="mt-2 text-sm" data-testid="asignacion">
          {assignment ? (
            <>
              Asignado a la ruta <span className="font-medium">{assignment.routeName}</span> de{" "}
              <span className="font-medium">{assignment.collectorName}</span>.
            </>
          ) : (
            "Este cliente no está asignado a ninguna ruta."
          )}
        </p>
        <div className="mt-3">
          <CashFeedbackProvider>
            <AssignClientForm
              clientId={client.id}
              routes={routes}
              currentRouteId={assignment?.routeId ?? null}
            />
          </CashFeedbackProvider>
        </div>
      </section>

      <section aria-labelledby="contacto" className="mt-8">
        <h2 id="contacto" className="text-xl font-semibold">
          Datos del cliente
        </h2>
        <ClientForm
          mode="edit"
          clientId={client.id}
          initial={{
            name: client.name,
            nickname: client.nickname ?? "",
            identification: client.identification,
            address: client.address ?? "",
            phone: client.phone ?? "",
            whatsapp: client.whatsapp ?? "",
            notes: client.notes ?? "",
          }}
        />
      </section>

      <section aria-labelledby="eliminar" className="mt-8">
        <h2 id="eliminar" className="text-xl font-semibold">
          Eliminar cliente
        </h2>
        {deletionBlocker ? (
          <p className="text-muted mt-2 text-sm" data-testid="eliminar-bloqueado">
            {DELETION_BLOCKED[deletionBlocker]}
          </p>
        ) : (
          <div className="mt-3">
            <DeleteClientButton clientId={client.id} name={client.name} />
          </div>
        )}
      </section>
    </>
  );
}
