"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import { explainPayment } from "@/modules/portfolio/payment-explanation";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { SelectField } from "@/shared/ui/select-field";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "../../_components/cash-feedback";

type Registered = {
  amount: number;
  kind: "CUOTAS" | "CARGO_MORA";
  applications: { installmentNumber: number | null; applied: number; pendingAfter: number }[];
  balance: number;
  loanPendingBalance: number;
  loanPaid: boolean;
};

type Props = {
  loanId: string;
  installments: { number: number; pendingAmount: number }[];
  /** Cargos de mora activos con saldo (se pagan de forma explícita, 02 §3.1). */
  lateFees: { id: string; reason: string; pendingAmount: number }[];
};

const CUOTAS = "CUOTAS";

/**
 * Registro de un pago. Mientras se escribe el monto se explica cómo se aplicaría (la cuota más antigua
 * primero, el excedente a la siguiente, sin saldo a favor); la aplicación real y su resultado verificable
 * los devuelve el servidor y se anuncian en la región compartida.
 */
export function RegisterPayment({ loanId, installments, lateFees }: Props) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run, reset } = useCommand<Registered>("/api/negocio/pagos");
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [target, setTarget] = useState<string>(CUOTAS);
  const [amountText, setAmountText] = useState("");
  const [amountError, setAmountError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  const fee = lateFees.find((candidate) => candidate.id === target);
  const parsed = parseAmountInput(amountText);
  const explanation = !fee && parsed.ok ? explainPayment(installments, parsed.amount) : null;
  const feeExcess = Boolean(fee && parsed.ok && parsed.amount > fee.pendingAmount);

  const options = [
    { value: CUOTAS, label: "Cuotas del préstamo" },
    ...lateFees.map((candidate) => ({
      value: candidate.id,
      label: `Cargo de mora: ${candidate.reason} (${formatMoney(money(candidate.pendingAmount))})`,
    })),
  ];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const formElement = event.currentTarget;
    const note = String(new FormData(formElement).get("note") ?? "").trim();
    if (!parsed.ok) {
      setAmountError(parsed.message);
      return;
    }
    if (explanation && !explanation.ok) {
      setAmountError(
        `El pago supera el saldo pendiente de las cuotas (${formatMoney(money(explanation.pending))}).`,
      );
      return;
    }
    if (fee && feeExcess) {
      setAmountError(
        `El pago supera el saldo del cargo (${formatMoney(money(fee.pendingAmount))}).`,
      );
      return;
    }
    setAmountError(undefined);
    const result = await run(
      {
        loanId,
        amount: parsed.amount,
        ...(fee ? { lateFeeChargeId: fee.id } : {}),
        ...(note ? { note } : {}),
      },
      { headers: { "Idempotency-Key": idempotency.current() } },
    );
    if (result.status === "success") {
      idempotency.renew();
      formElement.reset();
      setAmountText("");
      setTarget(CUOTAS);
      reset();
      const data = result.data;
      const detail = data.applications
        .map((line) =>
          line.installmentNumber === null
            ? `cargo de mora ${formatMoney(money(line.applied))}`
            : `cuota ${line.installmentNumber} ${formatMoney(money(line.applied))}`,
        )
        .join(", ");
      feedback.announce(
        `Pago de ${formatMoney(money(data.amount))} registrado (${detail}). ${
          data.loanPaid
            ? "El préstamo quedó pagado."
            : `Saldo pendiente de las cuotas: ${formatMoney(money(data.loanPendingBalance))}.`
        } Caja Mayor: ${formatMoney(money(data.balance))}.`,
      );
      router.refresh();
    }
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      onChange={() => idempotency.renew()}
      aria-labelledby="registrar-pago"
      className="border-border flex max-w-xl flex-col gap-3 rounded-lg border p-4"
      noValidate
    >
      <h3 id="registrar-pago" className="text-lg font-medium">
        Registrar pago
      </h3>
      {lateFees.length > 0 ? (
        <SelectField
          label="¿Qué se paga?"
          name="target"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          options={options}
          disabled={busy}
        />
      ) : null}
      <TextField
        label="Monto (pesos)"
        name="amount"
        inputMode="numeric"
        autoComplete="off"
        required
        readOnly={busy}
        value={amountText}
        onChange={(event) => setAmountText(event.target.value)}
        hint="Pesos enteros, por ejemplo 150000 o 150.000."
        error={amountError}
        className="font-mono tabular-nums"
      />

      <div aria-live="polite" data-testid="explicacion-pago">
        {explanation?.ok ? (
          <div className="border-border bg-surface rounded-lg border p-3 text-sm">
            <p className="font-medium">Así se aplicaría:</p>
            <ul className="mt-1 flex flex-col gap-1">
              {explanation.lines.map((line) => (
                <li key={line.installmentNumber}>
                  Cuota {line.installmentNumber}:{" "}
                  <span className="font-mono tabular-nums">{formatMoney(money(line.applied))}</span>
                  {line.pendingAfter > 0
                    ? ` (le quedan ${formatMoney(money(line.pendingAfter))})`
                    : " (queda saldada)"}
                </li>
              ))}
            </ul>
            <p className="text-muted mt-1">
              Saldo pendiente después:{" "}
              <span className="font-mono tabular-nums">
                {formatMoney(money(explanation.loanPendingAfter))}
              </span>
            </p>
          </div>
        ) : null}
        {fee && parsed.ok && !feeExcess ? (
          <p className="text-sm">
            Se aplica al cargo de mora; le quedarían{" "}
            <span className="font-mono tabular-nums">
              {formatMoney(money(fee.pendingAmount - parsed.amount))}
            </span>
            .
          </p>
        ) : null}
      </div>

      <TextAreaField
        label="Observación"
        name="note"
        maxLength={500}
        readOnly={busy}
        hint="Opcional."
      />

      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      <Button type="submit" loading={busy} loadingText="Registrando…" className="self-start">
        Registrar pago
      </Button>
    </form>
  );
}
