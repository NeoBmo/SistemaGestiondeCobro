import type { Metadata } from "next";
import Link from "next/link";
import { getCashSummary } from "@/modules/cash/queries";
import { getPageSession } from "@/modules/identity/page-session";
import { getPool } from "@/shared/database/pg-pool";
import { formatMoney } from "@/shared/money/money";

export const metadata: Metadata = { title: "Negocio" };

export default async function NegocioPage() {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const summary = await getCashSummary(getPool(), session);

  return (
    <>
      <h1 className="text-2xl font-semibold md:text-3xl">Negocio</h1>
      <p className="text-muted mt-2 text-sm">
        Tu cuenta está activa. Clientes y préstamos se habilitan en las siguientes fases.
      </p>

      <section aria-labelledby="caja" className="border-border mt-6 max-w-md rounded-lg border p-4">
        <h2 id="caja" className="text-lg font-medium">
          Caja Mayor
        </h2>
        <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">
          {formatMoney(summary.balance)}
        </p>
        <Link
          href="/negocio/caja"
          className="bg-primary text-primary-foreground mt-3 inline-flex min-h-11 items-center rounded-lg px-4 font-medium"
        >
          {summary.hasOpeningBalance
            ? "Ver y registrar movimientos"
            : "Registrar saldo de apertura"}
        </Link>
      </section>
    </>
  );
}
