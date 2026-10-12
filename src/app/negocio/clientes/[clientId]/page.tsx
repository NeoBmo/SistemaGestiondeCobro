import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { getClientDetail } from "@/modules/portfolio/client-queries";
import { getPool } from "@/shared/database/pg-pool";
import { formatIsoDate } from "@/shared/dates/dates";
import { formatMoney } from "@/shared/money/money";
import { ClientForm } from "../_components/client-form";

export const metadata: Metadata = { title: "Cliente" };

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
  const { client, loans } = detail;

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
    </>
  );
}
