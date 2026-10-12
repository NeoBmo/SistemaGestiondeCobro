import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getPageSession } from "@/modules/identity/page-session";
import { getLoanDetail } from "@/modules/portfolio/loan-queries";
import { getPool } from "@/shared/database/pg-pool";
import { addDays, formatDateTimeInZone, formatIsoDate, localDateIn } from "@/shared/dates/dates";
import { formatMoney } from "@/shared/money/money";
import { CashFeedbackProvider } from "../../_components/cash-feedback";
import { AnnulLoan } from "../_components/annul-loan";
import { InstallmentBadge } from "../_components/installment-badge";
import { LateFees } from "../_components/late-fees";
import { PaymentHistory } from "../_components/payment-history";
import { RefinanceLoan } from "../_components/refinance-loan";
import { RegisterPayment } from "../_components/register-payment";

export const metadata: Metadata = { title: "Préstamo" };

const FREQUENCY_LABEL = { DIARIA: "Diaria", SEMANAL: "Semanal", MENSUAL: "Mensual" } as const;

const STATUS_BADGE = {
  ACTIVO: { icon: "✓", label: "Activo" },
  PAGADO: { icon: "✓", label: "Pagado" },
  REFINANCIADO: { icon: "↻", label: "Refinanciado" },
  ANULADO: { icon: "▣", label: "Anulado" },
} as const;

/** 2000 → «20 %»; 1250 → «12,5 %». */
const percent = (bps: number) => `${String(bps / 100).replace(".", ",")} %`;

export default async function LoanPage({ params }: { params: Promise<{ loanId: string }> }) {
  const session = await getPageSession({ roles: ["ADMIN_NEGOCIO"] });
  const { loanId } = await params;
  const loan = await getLoanDetail(getPool(), session, loanId);
  if (!loan) notFound();
  const timeZone = session.businessTimeZone;
  if (!timeZone) throw new Error("El Admin de negocio no tiene zona horaria");
  const voided = loan.loanStatus === "ANULADO";
  const active = loan.loanStatus === "ACTIVO";
  const paid = loan.status === "PAGADO";
  const tomorrow = addDays(localDateIn(new Date(), timeZone), 1);
  const openFees = loan.lateFees.filter((fee) => fee.status === "ACTIVO" && fee.pendingAmount > 0);

  return (
    <CashFeedbackProvider>
      <Link href={`/negocio/clientes/${loan.client.id}`} className="text-primary text-sm underline">
        ← {loan.client.name}
      </Link>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold md:text-3xl">Contrato {loan.contractNumber}</h1>
        <span className="border-border bg-surface inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
          <span aria-hidden="true">{STATUS_BADGE[loan.status].icon}</span>
          {STATUS_BADGE[loan.status].label}
        </span>
      </div>
      <p className="text-muted mt-1 text-sm">
        {loan.origin === "NUEVO" ? "Préstamo nuevo" : "Cartera importada"} · registrado el{" "}
        {formatDateTimeInZone(loan.createdAt, timeZone)}
      </p>
      {voided && loan.voidReason ? (
        <p className="mt-2 text-sm font-medium break-words">
          Anulado el {loan.voidedAt ? formatDateTimeInZone(loan.voidedAt, timeZone) : ""}. Motivo:{" "}
          {loan.voidReason}
        </p>
      ) : null}
      {loan.refinancing.previousLoanId ? (
        <p className="mt-2 text-sm">
          Refinanciación del{" "}
          <Link
            href={`/negocio/prestamos/${loan.refinancing.previousLoanId}`}
            className="text-primary underline"
          >
            préstamo anterior
          </Link>
          .
        </p>
      ) : null}
      {loan.refinancing.nextLoanId ? (
        <p className="mt-2 text-sm">
          Su saldo pasó al{" "}
          <Link
            href={`/negocio/prestamos/${loan.refinancing.nextLoanId}`}
            className="text-primary underline"
          >
            préstamo nuevo
          </Link>
          .
        </p>
      ) : null}
      {loan.contractComment ? (
        <p className="mt-2 text-sm break-words whitespace-pre-line">{loan.contractComment}</p>
      ) : null}

      <section aria-labelledby="resumen" className="border-border mt-6 rounded-lg border p-4">
        <h2 id="resumen" className="text-xl font-semibold">
          Resumen
        </h2>
        <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
          <dt className="text-muted">Monto prestado</dt>
          <dd className="font-mono tabular-nums">{formatMoney(loan.principal)}</dd>
          <dt className="text-muted">Interés ({percent(loan.interestBps)})</dt>
          <dd className="font-mono tabular-nums">{formatMoney(loan.interest)}</dd>
          <dt className="text-muted">Total a pagar</dt>
          <dd className="font-mono font-semibold tabular-nums">{formatMoney(loan.total)}</dd>
          <dt className="text-muted">Frecuencia</dt>
          <dd>
            {FREQUENCY_LABEL[loan.frequency]} · {loan.installmentCount}{" "}
            {loan.installmentCount === 1 ? "cuota" : "cuotas"}
          </dd>
          <dt className="text-muted">
            {loan.origin === "IMPORTADO" ? "Fecha original" : "Desembolso"}
          </dt>
          <dd>{formatIsoDate(loan.disbursedOn)}</dd>
          {loan.historicalPaid !== null ? (
            <>
              <dt className="text-muted">Pagado antes de importar</dt>
              <dd className="font-mono tabular-nums">{formatMoney(loan.historicalPaid)}</dd>
            </>
          ) : null}
          <dt className="text-muted">
            {loan.origin === "IMPORTADO" ? "Próxima cuota al importar" : "Primera cuota"}
          </dt>
          <dd>{formatIsoDate(loan.firstDueOn)}</dd>
        </dl>
      </section>

      {voided ? null : (
        <section aria-labelledby="saldos" className="border-border mt-4 rounded-lg border p-4">
          <h2 id="saldos" className="text-xl font-semibold">
            Saldos
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Saldo pendiente</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {formatMoney(loan.pendingBalance)}
            </dd>
            <dt className="text-muted">Vencido</dt>
            <dd className="font-mono tabular-nums">
              {loan.overdueBalance > 0 ? <span aria-hidden="true">⚠ </span> : null}
              {formatMoney(loan.overdueBalance)}
            </dd>
            <dt className="text-muted">Cargos de mora activos</dt>
            <dd className="font-mono tabular-nums">{formatMoney(loan.lateFeeBalance)}</dd>
            <dt className="text-muted">Próxima cuota</dt>
            <dd>
              {loan.nextDue ? (
                <>
                  {formatIsoDate(loan.nextDue.dueOn)} ·{" "}
                  <span className="font-mono tabular-nums">{formatMoney(loan.nextDue.amount)}</span>
                </>
              ) : (
                "—"
              )}
            </dd>
          </dl>
        </section>
      )}

      {voided || !active ? null : (
        <section aria-labelledby="acciones" className="mt-8">
          <h2 id="acciones" className="text-xl font-semibold">
            Acciones
          </h2>
          <div className="mt-3 flex flex-col gap-4">
            {active && !paid ? (
              <RegisterPayment
                loanId={loan.loanId}
                installments={loan.installments.map((i) => ({
                  number: i.number,
                  pendingAmount: i.pendingAmount,
                }))}
                lateFees={openFees.map((fee) => ({
                  id: fee.id,
                  reason: fee.reason,
                  pendingAmount: fee.pendingAmount,
                }))}
              />
            ) : null}
            <div className="flex flex-wrap items-start gap-3">
              {active && !paid ? (
                <RefinanceLoan
                  loanId={loan.loanId}
                  contractNumber={loan.contractNumber}
                  suggestedFirstDueOn={tomorrow}
                  blockedByLateFees={loan.lateFeeBalance > 0}
                />
              ) : null}
              {active ? (
                <AnnulLoan loanId={loan.loanId} contractNumber={loan.contractNumber} />
              ) : null}
            </div>
          </div>
        </section>
      )}

      <section aria-labelledby="calendario" className="mt-8">
        <h2 id="calendario" className="text-xl font-semibold">
          Calendario de cuotas
        </h2>
        <ol className="mt-3 flex flex-col gap-2">
          {loan.installments.map((installment) => (
            <li
              key={installment.number}
              className="border-border flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
              data-testid="cuota"
            >
              <span className="font-medium">
                Cuota {installment.number} · {formatIsoDate(installment.dueOn)}
              </span>
              <dl className="grid w-full grid-cols-3 gap-2 text-sm">
                <div>
                  <dt className="text-muted">Esperado</dt>
                  <dd className="font-mono tabular-nums">{formatMoney(installment.amount)}</dd>
                </div>
                <div>
                  <dt className="text-muted">Aplicado</dt>
                  <dd className="font-mono tabular-nums">
                    {formatMoney(installment.appliedAmount)}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">Pendiente</dt>
                  <dd className="font-mono tabular-nums">
                    {formatMoney(installment.pendingAmount)}
                  </dd>
                </div>
              </dl>
              <InstallmentBadge
                status={
                  voided
                    ? "ANULADA"
                    : loan.loanStatus === "REFINANCIADO"
                      ? "REFINANCIADA"
                      : installment.status
                }
                daysLate={installment.daysLate}
                partial={installment.appliedAmount > 0}
              />
            </li>
          ))}
        </ol>
      </section>

      <PaymentHistory
        timeZone={timeZone}
        payments={loan.payments.map((payment) => ({
          ...payment,
          createdAt: payment.createdAt.toISOString(),
          reversal: payment.reversal
            ? { ...payment.reversal, createdAt: payment.reversal.createdAt.toISOString() }
            : null,
        }))}
      />

      <LateFees
        loanId={loan.loanId}
        canManage={active}
        fees={loan.lateFees.map((fee) => ({
          id: fee.id,
          amount: fee.amount,
          appliedAmount: fee.appliedAmount,
          pendingAmount: fee.pendingAmount,
          reason: fee.reason,
          status: fee.status,
          voidReason: fee.voidReason,
        }))}
      />
    </CashFeedbackProvider>
  );
}
