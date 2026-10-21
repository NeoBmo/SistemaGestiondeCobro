import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { getClientDetail } from "@/modules/portfolio/client-queries";
import { getPool } from "@/shared/database/pg-pool";
import { localDateIn } from "@/shared/dates/dates";
import { ImportLoanForm } from "./import-loan-form";

export const metadata: Metadata = { title: "Importar préstamo anterior" };

export default async function ImportLoanPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const params = await searchParams;
  const clientId = Array.isArray(params.cliente) ? params.cliente[0] : params.cliente;
  const detail = clientId ? await getClientDetail(getPool(), session, clientId) : null;
  if (!detail) notFound();

  // Un Admin siempre pertenece a un negocio con zona horaria (getClientDetail ya lo exige).
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El Admin de negocio no tiene zona horaria");

  return (
    <>
      <Link
        href={`/negocio/clientes/${detail.client.id}`}
        className="text-primary text-sm break-words underline"
      >
        ← {detail.client.name}
      </Link>
      <h1 className="mt-2 text-2xl font-semibold md:text-3xl">Importar préstamo anterior</h1>
      <p className="text-muted mt-2 text-sm">
        Carga un préstamo que ya existía antes de usar el sistema. Solo se guardan las cuotas que
        faltan; lo ya pagado queda como referencia y no se crea ningún pago ni movimiento de caja.
      </p>
      <ImportLoanForm
        clientId={detail.client.id}
        clientName={detail.client.name}
        today={localDateIn(new Date(), timeZone)}
      />
    </>
  );
}
