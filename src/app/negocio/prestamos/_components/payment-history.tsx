"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatDateTimeInZone } from "@/shared/dates/dates";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "../../_components/cash-feedback";

export type PaymentItem = {
  id: string;
  kind: "CUOTAS" | "CARGO_MORA";
  amount: number;
  note: string | null;
  registeredByName: string;
  createdAt: string;
  applications: { installmentNumber: number | null; amount: number }[];
  reversal: { reason: string; reversedByName: string; createdAt: string } | null;
  canReverse: boolean;
};

/**
 * Historial de pagos del préstamo. Un pago reversado sigue visible con su motivo (nada se borra); solo el
 * último pago vigente de un préstamo activo se puede reversar (ADR 0008).
 */
export function PaymentHistory({
  payments,
  timeZone,
}: {
  payments: PaymentItem[];
  timeZone: string;
}) {
  return (
    <section aria-labelledby="pagos" className="mt-8">
      <h2 id="pagos" tabIndex={-1} className="text-xl font-semibold outline-offset-4">
        Pagos
      </h2>
      {payments.length === 0 ? (
        <p className="text-muted mt-3">Todavía no hay pagos registrados.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {payments.map((payment) => (
            <li
              key={payment.id}
              data-testid="pago"
              className="border-border flex flex-col gap-2 rounded-lg border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium">
                  {formatDateTimeInZone(new Date(payment.createdAt), timeZone)}
                </span>
                <span
                  className={`font-mono tabular-nums ${payment.reversal ? "line-through" : "font-semibold"}`}
                >
                  {formatMoney(money(payment.amount))}
                </span>
                {payment.reversal ? (
                  <span className="border-danger bg-danger-subtle text-danger-strong inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-sm font-medium">
                    <span aria-hidden="true">↩</span>
                    Reversado
                  </span>
                ) : null}
              </div>
              <p className="text-muted text-sm break-words">
                {payment.kind === "CARGO_MORA" ? "Pago de cargo de mora" : "Pago de cuotas"} ·{" "}
                {payment.applications
                  .map((line) =>
                    line.installmentNumber === null
                      ? `cargo ${formatMoney(money(line.amount))}`
                      : `cuota ${line.installmentNumber}: ${formatMoney(money(line.amount))}`,
                  )
                  .join(" · ")}{" "}
                · registrado por {payment.registeredByName}
                {payment.note ? ` · ${payment.note}` : ""}
              </p>
              {payment.reversal ? (
                <p className="text-sm break-words">
                  Reversado por {payment.reversal.reversedByName} el{" "}
                  {formatDateTimeInZone(new Date(payment.reversal.createdAt), timeZone)}. Motivo:{" "}
                  {payment.reversal.reason}
                </p>
              ) : null}
              {payment.canReverse ? <ReversePayment paymentId={payment.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ReversePayment({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run } = useCommand<{
    amount: number;
    balance: number;
    loanPendingBalance: number;
  }>(`/api/negocio/pagos/${paymentId}/reversar`);
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [open, setOpen] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const busy = state.status === "loading" || state.status === "success";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (open) formRef.current?.querySelector("textarea")?.focus();
    else if (wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason === "") {
      setReasonError("Escribe el motivo del reverso.");
      return;
    }
    setReasonError(undefined);
    const result = await run({ reason }, { headers: { "Idempotency-Key": idempotency.current() } });
    if (result.status === "success") {
      feedback.announce(
        `Pago de ${formatMoney(money(result.data.amount))} reversado. Las cuotas vuelven a su saldo; saldo pendiente: ${formatMoney(money(result.data.loanPendingBalance))}. Caja Mayor: ${formatMoney(money(result.data.balance))}.`,
      );
      router.refresh();
      // El formulario se desmonta al actualizarse: el foco pasa a un destino estable.
      document.getElementById("pagos")?.focus();
    }
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="secondary"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        Reversar pago
      </Button>
    );
  }
  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={onSubmit}
      onChange={() => idempotency.renew()}
      aria-label="Reversar el pago"
      className="flex flex-col gap-3"
      noValidate
    >
      <Alert variant="warning">
        El pago se conserva en el historial como reversado, las cuotas recuperan su saldo y el
        dinero sale de la Caja Mayor. No se puede deshacer.
      </Alert>
      <TextAreaField
        label="Motivo del reverso"
        name="reason"
        required
        maxLength={500}
        readOnly={busy}
        error={reasonError}
      />
      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant="danger" loading={busy} loadingText="Reversando…">
          Confirmar reverso
        </Button>
        {busy ? null : (
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
