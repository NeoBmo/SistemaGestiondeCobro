"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import { LOAN_FREQUENCIES, type LoanFrequency } from "@/modules/portfolio/loan-calculation";
import { formatIsoDate, isoDate } from "@/shared/dates/dates";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { SelectField } from "@/shared/ui/select-field";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "../../_components/cash-feedback";
import { parsePercent } from "./percent";

const FREQUENCY_OPTIONS = LOAN_FREQUENCIES.map((value) => ({
  value,
  label: { DIARIA: "Diaria", SEMANAL: "Semanal", MENSUAL: "Mensual" }[value],
}));

type Preview = {
  previousContractNumber: string;
  refinancedBalance: number;
  additionalAmount: number;
  plan: {
    principal: number;
    interest: number;
    total: number;
    installments: { number: number; dueOn: string; amount: number }[];
  };
  disbursedOn: string;
  cashBalance: number;
  sufficientFunds: boolean;
};

type Done = { newLoanId: string; newContractNumber: string; balance: number };

type Terms = {
  additionalAmount: number;
  interestBps: number;
  frequency: LoanFrequency;
  installmentCount: number;
  firstDueOn: string;
  note?: string;
};

type Props = {
  loanId: string;
  contractNumber: string;
  /** Mañana en la zona del negocio: fecha sugerida para la primera cuota nueva. */
  suggestedFirstDueOn: string;
  /** Con cargos de mora activos no se puede refinanciar: deben pagarse o anularse antes (ADR 0008). */
  blockedByLateFees: boolean;
};

/**
 * Refinanciación en dos pasos: «Calcular» muestra el saldo que pasa al préstamo nuevo (saldo pendiente de
 * las cuotas + adicional) y su calendario sin guardar nada; «Refinanciar» crea el contrato nuevo. El
 * préstamo anterior queda como REFINANCIADO sin editarse; solo el adicional sale de la Caja Mayor.
 */
export function RefinanceLoan({
  loanId,
  contractNumber,
  suggestedFirstDueOn,
  blockedByLateFees,
}: Props) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const preview = useCommand<Preview>(`/api/negocio/prestamos/${loanId}/refinanciar/vista-previa`);
  const confirm = useCommand<Done>(`/api/negocio/prestamos/${loanId}/refinanciar`);
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [open, setOpen] = useState(false);
  const [terms, setTerms] = useState<Terms | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const calculating = preview.state.status === "loading";
  const confirming = confirm.state.status === "loading" || confirm.state.status === "success";
  const busy = calculating || confirming;
  const planned = preview.state.status === "success" && terms ? preview.state.data : null;

  useEffect(() => {
    if (preview.state.status === "error" || confirm.state.status === "error") {
      errorRef.current?.focus();
    }
  }, [preview.state.status, confirm.state.status]);

  useEffect(() => {
    if (open) formRef.current?.querySelector("input")?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

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
    const extraText = text("additionalAmount");
    const additional = extraText === "" ? null : parseAmountInput(extraText);
    if (additional && !additional.ok) next.additionalAmount = additional.message;
    const bps = parsePercent(text("interest"));
    if (bps === null) next.interest = "Escribe un porcentaje, por ejemplo 20 o 12,5.";
    const count = Number(text("installmentCount"));
    if (!Number.isInteger(count) || count < 1)
      next.installmentCount = "Escribe un número de cuotas entero.";
    if (!text("firstDueOn")) next.firstDueOn = "Elige la primera fecha de cobro.";
    setErrors(next);
    if (Object.keys(next).length > 0 || (additional && !additional.ok) || bps === null) return;

    const chosen: Terms = {
      additionalAmount: additional?.ok ? additional.amount : 0,
      interestBps: bps,
      frequency: text("frequency") as LoanFrequency,
      installmentCount: count,
      firstDueOn: text("firstDueOn"),
      ...(text("note") ? { note: text("note") } : {}),
    };
    setTerms(chosen);
    await preview.run(chosen);
  }

  async function onConfirm() {
    if (!terms) return;
    const result = await confirm.run(terms, {
      headers: { "Idempotency-Key": idempotency.current() },
    });
    if (result.status === "success") {
      feedback.announce(
        `Préstamo ${contractNumber} refinanciado en el contrato ${result.data.newContractNumber}. Caja Mayor: ${formatMoney(money(result.data.balance))}.`,
      );
      router.push(`/negocio/prestamos/${result.data.newLoanId}`);
    }
  }

  if (blockedByLateFees) {
    return (
      <Alert variant="warning">
        Para refinanciar, primero paga o anula los cargos de mora activos de este préstamo.
      </Alert>
    );
  }

  if (!open) {
    return (
      <Button ref={openerRef} variant="secondary" onClick={() => setOpen(true)}>
        Refinanciar
      </Button>
    );
  }

  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <form
        ref={formRef}
        method="post"
        onSubmit={onCalculate}
        onChange={discardPreview}
        aria-label={`Refinanciar el contrato ${contractNumber}`}
        className="border-border flex flex-col gap-3 rounded-lg border p-4"
        noValidate
      >
        <Alert variant="info">
          El saldo pendiente de las cuotas pasa a un contrato nuevo, con su propio interés y
          calendario. Este contrato queda refinanciado y no se modifica.
        </Alert>
        <TextField
          label="Monto adicional (pesos)"
          name="additionalAmount"
          inputMode="numeric"
          autoComplete="off"
          readOnly={busy}
          hint="Opcional. Es dinero nuevo que sale de la Caja Mayor y se suma al saldo."
          error={errors.additionalAmount}
          className="font-mono tabular-nums"
        />
        <TextField
          label="Interés (%)"
          name="interest"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue="20"
          readOnly={busy}
          error={errors.interest}
        />
        <SelectField
          label="Frecuencia de cobro"
          name="frequency"
          options={FREQUENCY_OPTIONS}
          defaultValue="SEMANAL"
          disabled={busy}
        />
        <TextField
          label="Número de cuotas"
          name="installmentCount"
          inputMode="numeric"
          autoComplete="off"
          required
          defaultValue="4"
          readOnly={busy}
          error={errors.installmentCount}
        />
        <TextField
          label="Primera fecha de cobro"
          name="firstDueOn"
          type="date"
          required
          defaultValue={suggestedFirstDueOn}
          readOnly={busy}
          error={errors.firstDueOn}
        />
        <TextAreaField
          label="Comentario"
          name="note"
          maxLength={500}
          readOnly={busy}
          hint="Opcional."
        />
        <div className="flex flex-wrap gap-3">
          <Button
            type="submit"
            variant="secondary"
            loading={calculating}
            loadingText="Calculando…"
            disabled={confirming}
          >
            Calcular
          </Button>
          {busy ? null : (
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
          )}
        </div>
      </form>

      {preview.state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {preview.state.error.message}
        </Alert>
      ) : null}

      {planned ? (
        <section
          aria-labelledby="vista-previa-refinanciacion"
          className="border-border rounded-lg border p-4"
        >
          <h3 id="vista-previa-refinanciacion" className="text-lg font-medium">
            Vista previa de la refinanciación
          </h3>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Saldo que se refinancia</dt>
            <dd className="font-mono tabular-nums">
              {formatMoney(money(planned.refinancedBalance))}
            </dd>
            <dt className="text-muted">Monto adicional</dt>
            <dd className="font-mono tabular-nums">
              {formatMoney(money(planned.additionalAmount))}
            </dd>
            <dt className="text-muted">Principal nuevo</dt>
            <dd className="font-mono tabular-nums">{formatMoney(money(planned.plan.principal))}</dd>
            <dt className="text-muted">Interés</dt>
            <dd className="font-mono tabular-nums">{formatMoney(money(planned.plan.interest))}</dd>
            <dt className="text-muted">Total a pagar</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {formatMoney(money(planned.plan.total))}
            </dd>
            <dt className="text-muted">Sale de la Caja Mayor</dt>
            <dd className="font-mono tabular-nums">
              {formatMoney(money(planned.additionalAmount))}
            </dd>
          </dl>
          {planned.sufficientFunds ? null : (
            <Alert variant="warning">
              La Caja Mayor ({formatMoney(money(planned.cashBalance))}) no alcanza para el monto
              adicional.
            </Alert>
          )}
          <h4 className="mt-4 text-base font-medium">Calendario</h4>
          <ol className="mt-2 grid max-h-72 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
            {planned.plan.installments.map((installment) => (
              <li
                key={installment.number}
                className="border-border flex justify-between gap-3 border-b py-1"
              >
                <span>
                  {installment.number}. {formatIsoDate(isoDate(installment.dueOn))}
                </span>
                <span className="font-mono tabular-nums">
                  {formatMoney(money(installment.amount))}
                </span>
              </li>
            ))}
          </ol>
          {confirm.state.status === "error" ? (
            <div className="mt-3">
              <Alert variant="error" ref={errorRef}>
                {confirm.state.error.message}
              </Alert>
            </div>
          ) : null}
          <Button
            className="mt-4"
            loading={confirming}
            loadingText="Refinanciando…"
            disabled={!planned.sufficientFunds}
            onClick={onConfirm}
          >
            Refinanciar
          </Button>
        </section>
      ) : null}
    </div>
  );
}
