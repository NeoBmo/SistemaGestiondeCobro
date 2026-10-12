"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import type { ImportPreview, ImportedContract } from "@/modules/portfolio/imports";
import { LOAN_FREQUENCIES } from "@/modules/portfolio/loan-calculation";
import { formatIsoDate } from "@/shared/dates/dates";
import { formatMoney, interestBpsFromPercent, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { SelectField } from "@/shared/ui/select-field";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";

const FREQUENCY_OPTIONS = LOAN_FREQUENCIES.map((value) => ({
  value,
  label: { DIARIA: "Diaria", SEMANAL: "Semanal", MENSUAL: "Mensual" }[value],
}));

type Props = { clientId: string; clientName: string; today: string };

/** «20», «12,5» o «12.5» → puntos básicos; `null` si no es un porcentaje con a lo más dos decimales. */
function parsePercent(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  try {
    return interestBpsFromPercent(Number(normalized));
  } catch {
    return null;
  }
}

/**
 * Importación de un préstamo de cartera previa, en dos pasos y sin tocar ninguna caja: «Calcular» muestra
 * las cuotas que faltan y «Importar» las guarda. Lo ya pagado queda solo como dato de referencia. Cambiar
 * cualquier dato descarta la vista previa.
 */
export function ImportLoanForm({ clientId, clientName, today }: Props) {
  const router = useRouter();
  const preview = useCommand<ImportPreview>("/api/negocio/prestamos/importar/vista-previa");
  const confirm = useCommand<ImportedContract>("/api/negocio/prestamos/importar");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const errorRef = useRef<HTMLDivElement>(null);
  const calculating = preview.state.status === "loading";
  const confirming = confirm.state.status === "loading" || confirm.state.status === "success";
  const busy = calculating || confirming;
  const planned = preview.state.status === "success" && terms ? preview.state.data : null;

  useEffect(() => {
    if (preview.state.status === "error" || confirm.state.status === "error") {
      errorRef.current?.focus();
    }
  }, [preview.state.status, confirm.state.status]);

  function discardPreview() {
    if (preview.state.status !== "idle") preview.reset();
    if (confirm.state.status === "error") confirm.reset();
    idempotency.renew();
  }

  async function onCalculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();

    const next: Record<string, string> = {};
    const principal = parseAmountInput(text("principal"));
    if (!principal.ok) next.principal = principal.message;
    const pending = parseAmountInput(text("pendingBalance"));
    if (!pending.ok) next.pendingBalance = pending.message;
    const paidText = text("historicalPaid");
    const paid =
      paidText === ""
        ? null
        : paidText === "0"
          ? { ok: true as const, amount: 0 }
          : parseAmountInput(paidText);
    if (paid && !paid.ok) next.historicalPaid = paid.message;
    const bps = parsePercent(text("interest"));
    if (bps === null) next.interest = "Escribe un porcentaje, por ejemplo 20 o 12,5.";
    const count = Number(text("installmentCount"));
    if (!Number.isInteger(count) || count < 1)
      next.installmentCount = "Escribe un número de cuotas entero.";
    if (!text("originalDate")) next.originalDate = "Elige la fecha original del préstamo.";
    if (!text("nextDueOn")) next.nextDueOn = "Elige la próxima fecha de cobro.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !principal.ok || !pending.ok || bps === null) return;

    const chosen = {
      clientId,
      originalDate: text("originalDate"),
      principal: principal.amount,
      interestBps: bps,
      frequency: text("frequency"),
      historicalPaid: paid && paid.ok ? paid.amount : undefined,
      pendingBalance: pending.amount,
      installmentCount: count,
      nextDueOn: text("nextDueOn"),
    };
    setTerms({ ...chosen, comment: text("comment") || undefined });
    await preview.run(chosen);
  }

  async function onConfirm() {
    if (!terms) return;
    const result = await confirm.run(terms, {
      headers: { "Idempotency-Key": idempotency.current() },
    });
    if (result.status === "success") router.push(`/negocio/prestamos/${result.data.loanId}`);
  }

  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-6">
      <form
        method="post"
        onSubmit={onCalculate}
        onChange={discardPreview}
        aria-label="Datos del préstamo anterior"
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="text-sm">
          Cliente: <span className="font-medium">{clientName}</span>
        </p>
        <TextField
          label="Fecha original del préstamo"
          name="originalDate"
          type="date"
          required
          max={today}
          readOnly={busy}
          error={errors.originalDate}
        />
        <TextField
          label="Monto prestado originalmente (pesos)"
          name="principal"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          className="font-mono tabular-nums"
          error={errors.principal}
        />
        <TextField
          label="Interés pactado (%)"
          name="interest"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue="20"
          readOnly={busy}
          hint="Con él se calcula el total pactado, como en un préstamo nuevo."
          error={errors.interest}
        />
        <SelectField
          label="Frecuencia de cobro"
          name="frequency"
          options={FREQUENCY_OPTIONS}
          defaultValue="DIARIA"
          disabled={busy}
        />
        <TextField
          label="Ya pagado antes de importar (pesos)"
          name="historicalPaid"
          inputMode="numeric"
          autoComplete="off"
          readOnly={busy}
          className="font-mono tabular-nums"
          hint="Opcional y solo de referencia: no crea pagos ni mueve ninguna caja."
          error={errors.historicalPaid}
        />
        <TextField
          label="Saldo pendiente hoy (pesos)"
          name="pendingBalance"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          className="font-mono tabular-nums"
          hint="Lo que aún debe el cliente. Se reparte en las cuotas que faltan."
          error={errors.pendingBalance}
        />
        <TextField
          label="Cuotas que faltan"
          name="installmentCount"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          error={errors.installmentCount}
        />
        <TextField
          label="Próxima fecha de cobro"
          name="nextDueOn"
          type="date"
          required
          readOnly={busy}
          hint="Si ya pasó, esas cuotas quedarán vencidas y con sus días de mora."
          error={errors.nextDueOn}
        />
        <TextAreaField
          label="Comentario"
          name="comment"
          maxLength={500}
          readOnly={busy}
          hint="Opcional."
        />
        <Button
          type="submit"
          variant="secondary"
          loading={calculating}
          loadingText="Calculando…"
          disabled={confirming}
          className="self-start"
        >
          Calcular
        </Button>
      </form>

      {preview.state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {preview.state.error.message}
        </Alert>
      ) : null}

      {planned ? (
        <section aria-labelledby="vista-previa" className="border-border rounded-lg border p-4">
          <h2 id="vista-previa" className="text-xl font-semibold">
            Vista previa
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Total pactado</dt>
            <dd className="font-mono tabular-nums">{formatMoney(money(planned.plan.total))}</dd>
            {planned.historicalPaid !== null ? (
              <>
                <dt className="text-muted">Ya pagado</dt>
                <dd className="font-mono tabular-nums">
                  {formatMoney(money(planned.historicalPaid))}
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Saldo pendiente</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {formatMoney(money(planned.plan.scheduled))}
            </dd>
            <dt className="text-muted">Cuotas</dt>
            <dd>
              {planned.plan.installments.length} desde el{" "}
              {formatIsoDate(planned.plan.installments[0]!.dueOn)}
            </dd>
          </dl>
          {planned.difference !== null && planned.difference !== 0 ? (
            <div className="mt-3">
              <Alert variant="warning" title="Los datos históricos no cuadran">
                El total pactado menos lo pagado y el saldo pendiente da{" "}
                {formatMoney(money(planned.difference))}. Puede haber abonos, descuentos o un error:
                revisa antes de importar. Se guardará el saldo pendiente que escribiste.
              </Alert>
            </div>
          ) : null}
          {planned.overdueInstallments > 0 ? (
            <div className="mt-3">
              <Alert
                variant="warning"
                title={`${planned.overdueInstallments} cuota(s) ya vencida(s)`}
              >
                Quedarán registradas como vencidas, con sus días de mora.
              </Alert>
            </div>
          ) : null}

          <h3 className="mt-4 text-lg font-medium">Cuotas que faltan</h3>
          <ol className="mt-2 grid max-h-72 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
            {planned.plan.installments.map((installment) => (
              <li
                key={installment.number}
                className="border-border flex justify-between gap-3 border-b py-1"
              >
                <span>
                  {installment.number}. {formatIsoDate(installment.dueOn)}
                </span>
                <span className="font-mono tabular-nums">
                  {formatMoney(money(installment.amount))}
                </span>
              </li>
            ))}
          </ol>
          <p className="text-muted mt-3 text-sm">
            Importar no crea pagos ni movimientos: la Caja Mayor no cambia.
          </p>

          {confirm.state.status === "error" ? (
            <div className="mt-4">
              <Alert variant="error" ref={errorRef}>
                {confirm.state.error.message}
              </Alert>
            </div>
          ) : null}
          <div aria-live="polite" className="mt-4">
            {confirm.state.status === "success" ? (
              <Alert variant="success" announce={false}>
                Contrato {confirm.state.data.contractNumber} importado.{" "}
                <Link
                  href={`/negocio/prestamos/${confirm.state.data.loanId}`}
                  className="underline"
                >
                  Abrir el préstamo
                </Link>
              </Alert>
            ) : null}
          </div>
          <Button
            className="mt-4"
            onClick={onConfirm}
            loading={confirming}
            loadingText="Importando…"
            disabled={calculating}
          >
            Importar préstamo
          </Button>
        </section>
      ) : null}
    </div>
  );
}
