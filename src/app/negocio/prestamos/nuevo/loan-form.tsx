"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import type { ConfirmedContract, LoanPreview } from "@/modules/portfolio/contracts";
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
import { UsuryNotice } from "../_components/usury-notice";

const FREQUENCY_OPTIONS = LOAN_FREQUENCIES.map((value) => ({
  value,
  label: { DIARIA: "Diaria", SEMANAL: "Semanal", MENSUAL: "Mensual" }[value],
}));

type Props = {
  clientId: string;
  clientName: string;
  /** Fecha sugerida para la primera cuota (mañana, en la zona del negocio). */
  suggestedFirstDueOn: string;
};

type Terms = {
  clientId: string;
  principal: number;
  interestBps: number;
  frequency: string;
  installmentCount: number;
  firstDueOn: string;
};

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
 * Préstamo nuevo en dos pasos sin guardar nada hasta el segundo: «Calcular» pide al servidor la vista
 * previa (interés, total y calendario) y «Confirmar» crea contrato, préstamo, cuotas y desembolso. Cambiar
 * cualquier condición descarta la vista previa: lo que se confirma es siempre lo que se calculó.
 */
export function LoanForm({ clientId, clientName, suggestedFirstDueOn }: Props) {
  const router = useRouter();
  const preview = useCommand<LoanPreview>("/api/negocio/prestamos/vista-previa");
  const confirm = useCommand<ConfirmedContract>("/api/negocio/prestamos");
  const [terms, setTerms] = useState<(Terms & { comment?: string }) | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [usuryAcknowledged, setUsuryAcknowledged] = useState(false);
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
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
    setUsuryAcknowledged(false);
    idempotency.renew();
  }

  async function onCalculate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();

    const next: Record<string, string> = {};
    const principal = parseAmountInput(text("principal"));
    if (!principal.ok) next.principal = principal.message;
    const bps = parsePercent(text("interest"));
    if (bps === null) next.interest = "Escribe un porcentaje, por ejemplo 20 o 12,5.";
    const count = Number(text("installmentCount"));
    if (!Number.isInteger(count) || count < 1)
      next.installmentCount = "Escribe un número de cuotas entero.";
    if (!text("firstDueOn")) next.firstDueOn = "Elige la primera fecha de cobro.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !principal.ok || bps === null) return;

    const chosen = {
      clientId,
      principal: principal.amount,
      interestBps: bps,
      frequency: text("frequency"),
      installmentCount: count,
      firstDueOn: text("firstDueOn"),
    };
    setTerms({ ...chosen, comment: text("comment") || undefined });
    await preview.run(chosen);
  }

  async function onConfirm() {
    if (!terms || !planned) return;
    const body = planned.usury.exceeds
      ? { ...terms, acknowledgeUsuryWarning: usuryAcknowledged }
      : terms;
    const result = await confirm.run(body, {
      headers: { "Idempotency-Key": idempotency.current() },
    });
    // Entre la vista previa y la confirmación pudo registrarse otra usura: se recalcula para mostrar la
    // advertencia (y su casilla) con lo que el servidor exige ahora. El error explica el motivo.
    if (result.status === "error" && result.error.code === "USURY_WARNING_NOT_ACKNOWLEDGED") {
      setUsuryAcknowledged(false);
      await preview.run(terms);
      return;
    }
    if (result.status === "success") {
      router.push(`/negocio/prestamos/${result.data.loanId}`);
    }
  }

  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-6">
      <form
        ref={formRef}
        method="post"
        onSubmit={onCalculate}
        onChange={discardPreview}
        aria-label="Condiciones del préstamo"
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="text-sm">
          Cliente: <span className="font-medium">{clientName}</span>
        </p>
        <TextField
          label="Monto a prestar (pesos)"
          name="principal"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          className="font-mono tabular-nums"
          hint="Pesos enteros, por ejemplo 1000000 o 1.000.000."
          error={errors.principal}
        />
        <TextField
          label="Interés (%)"
          name="interest"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue="20"
          readOnly={busy}
          hint="Total sobre el monto prestado, por ejemplo 20 o 12,5."
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
          label="Número de cuotas"
          name="installmentCount"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue="12"
          readOnly={busy}
          hint="Lo más frecuente: 6, 12 o 24."
          error={errors.installmentCount}
        />
        <TextField
          label="Primera fecha de cobro"
          name="firstDueOn"
          type="date"
          required
          defaultValue={suggestedFirstDueOn}
          readOnly={busy}
          hint="Las demás cuotas se calculan desde esta fecha, en calendario corrido."
          error={errors.firstDueOn}
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
            <dt className="text-muted">Monto prestado</dt>
            <dd className="font-mono tabular-nums">{formatMoney(money(planned.plan.principal))}</dd>
            <dt className="text-muted">Interés</dt>
            <dd className="font-mono tabular-nums">{formatMoney(money(planned.plan.interest))}</dd>
            <dt className="text-muted">Total a pagar</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {formatMoney(money(planned.plan.total))}
            </dd>
            <dt className="text-muted">Cuotas</dt>
            <dd>
              {planned.plan.installments.length} de{" "}
              <span className="font-mono tabular-nums">
                {formatMoney(money(planned.plan.installments[0]!.amount))}
              </span>
              {planned.plan.installments.at(-1)!.amount !== planned.plan.installments[0]!.amount ? (
                <>
                  {" "}
                  (la última, de{" "}
                  <span className="font-mono tabular-nums">
                    {formatMoney(money(planned.plan.installments.at(-1)!.amount))}
                  </span>
                  )
                </>
              ) : null}
            </dd>
            <dt className="text-muted">Desembolso</dt>
            <dd>{formatIsoDate(planned.disbursedOn)} (hoy)</dd>
          </dl>

          <h3 className="mt-4 text-lg font-medium">Calendario</h3>
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

          {planned.sufficientFunds ? (
            <p className="text-muted mt-4 text-sm">
              Caja Mayor al calcular: {formatMoney(money(planned.cashBalance))}. Quedará en{" "}
              <span className="font-mono tabular-nums">
                {formatMoney(money(planned.cashBalance - planned.plan.principal))}
              </span>{" "}
              tras el desembolso.
            </p>
          ) : (
            <div className="mt-4">
              <Alert variant="warning" title="La Caja Mayor no alcanza para este desembolso">
                Tiene {formatMoney(money(planned.cashBalance))} y el préstamo necesita{" "}
                {formatMoney(money(planned.plan.principal))}. Registra un ingreso de capital o
                reduce el monto.
              </Alert>
            </div>
          )}

          <UsuryNotice
            usury={planned.usury}
            acknowledged={usuryAcknowledged}
            onAcknowledgedChange={setUsuryAcknowledged}
            disabled={confirming}
          />

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
                Contrato {confirm.state.data.contractNumber} confirmado.{" "}
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
            loadingText="Confirmando…"
            disabled={
              !planned.sufficientFunds ||
              calculating ||
              (planned.usury.exceeds && !usuryAcknowledged)
            }
          >
            Confirmar préstamo y desembolsar
          </Button>
        </section>
      ) : null}
    </div>
  );
}
