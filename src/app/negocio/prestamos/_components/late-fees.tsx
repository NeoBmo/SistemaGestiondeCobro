"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "../../_components/cash-feedback";

export type LateFeeItem = {
  id: string;
  amount: number;
  appliedAmount: number;
  pendingAmount: number;
  reason: string;
  status: "ACTIVO" | "PAGADO" | "ANULADO";
  voidReason: string | null;
};

const STATUS = {
  ACTIVO: { label: "Activo", icon: "⚠" },
  PAGADO: { label: "Pagado", icon: "✓" },
  ANULADO: { label: "Anulado", icon: "▣" },
} as const;

/**
 * Cargos de mora (02 §3.4): los decide el Admin a mano, con motivo; nunca se generan solos. Se listan con su
 * estado y se pueden anular (con motivo) mientras no tengan pagos; pagarlos se hace desde «Registrar pago».
 */
export function LateFees({
  loanId,
  fees,
  canManage,
}: {
  loanId: string;
  fees: LateFeeItem[];
  canManage: boolean;
}) {
  return (
    <section aria-labelledby="mora" className="mt-8">
      <h2 id="mora" tabIndex={-1} className="text-xl font-semibold outline-offset-4">
        Cargos de mora
      </h2>
      <p className="text-muted mt-1 text-sm">
        La mora no se cobra sola: se agrega aquí cuando el administrador lo decide.
      </p>
      {fees.length === 0 ? (
        <p className="text-muted mt-3">Este préstamo no tiene cargos de mora.</p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {fees.map((fee) => (
            <li
              key={fee.id}
              data-testid="cargo-mora"
              className="border-border flex flex-col gap-2 rounded-lg border p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium break-words">{fee.reason}</span>
                <span className="font-mono tabular-nums">{formatMoney(money(fee.amount))}</span>
                <span className="border-border bg-surface inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-xs font-medium">
                  <span aria-hidden="true">{STATUS[fee.status].icon}</span>
                  {STATUS[fee.status].label}
                </span>
              </div>
              <p className="text-muted text-sm">
                Aplicado{" "}
                <span className="font-mono tabular-nums">
                  {formatMoney(money(fee.appliedAmount))}
                </span>{" "}
                · pendiente{" "}
                <span className="font-mono tabular-nums">
                  {formatMoney(money(fee.pendingAmount))}
                </span>
                {fee.voidReason ? ` · Motivo de anulación: ${fee.voidReason}` : ""}
              </p>
              {canManage && fee.status === "ACTIVO" && fee.appliedAmount === 0 ? (
                <VoidLateFee chargeId={fee.id} reason={fee.reason} />
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canManage ? <CreateLateFee loanId={loanId} /> : null}
    </section>
  );
}

function CreateLateFee({ loanId }: { loanId: string }) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run, reset } = useCommand<{ chargeId: string; amount: number }>(
    "/api/negocio/cargos-mora",
  );
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const amount = parseAmountInput(String(form.get("amount") ?? ""));
    const reason = String(form.get("reason") ?? "").trim();
    const next: { amount?: string; reason?: string } = {};
    if (!amount.ok) next.amount = amount.message;
    if (reason === "") next.reason = "Escribe el motivo del cargo.";
    setErrors(next);
    if (!amount.ok || reason === "") return;

    const result = await run(
      { loanId, amount: amount.amount, reason },
      { headers: { "Idempotency-Key": idempotency.current() } },
    );
    if (result.status === "success") {
      idempotency.renew();
      formElement.reset();
      reset();
      feedback.announce(
        `Cargo de mora de ${formatMoney(money(result.data.amount))} agregado. Queda pendiente de pago o anulación.`,
      );
      router.refresh();
    }
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      onChange={() => idempotency.renew()}
      aria-labelledby="agregar-mora"
      className="border-border mt-4 flex max-w-xl flex-col gap-3 rounded-lg border p-4"
      noValidate
    >
      <h3 id="agregar-mora" className="text-lg font-medium">
        Agregar cargo de mora
      </h3>
      <TextField
        label="Monto (pesos)"
        name="amount"
        inputMode="numeric"
        autoComplete="off"
        required
        readOnly={busy}
        error={errors.amount}
        className="font-mono tabular-nums"
      />
      <TextAreaField
        label="Motivo"
        name="reason"
        required
        maxLength={500}
        readOnly={busy}
        error={errors.reason}
      />
      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      <Button type="submit" loading={busy} loadingText="Agregando…" className="self-start">
        Agregar cargo
      </Button>
    </form>
  );
}

function VoidLateFee({ chargeId, reason: feeReason }: { chargeId: string; reason: string }) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run } = useCommand<{ amount: number }>(
    `/api/negocio/cargos-mora/${chargeId}/anular`,
  );
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [open, setOpen] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading" || state.status === "success";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    if (reason === "") {
      setReasonError("Escribe el motivo de la anulación.");
      return;
    }
    setReasonError(undefined);
    const result = await run({ reason }, { headers: { "Idempotency-Key": idempotency.current() } });
    if (result.status === "success") {
      feedback.announce(`Cargo de mora «${feeReason}» anulado.`);
      router.refresh();
      document.getElementById("mora")?.focus();
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
        Anular cargo
      </Button>
    );
  }
  return (
    <form
      method="post"
      onSubmit={onSubmit}
      onChange={() => idempotency.renew()}
      aria-label={`Anular el cargo de mora ${feeReason}`}
      className="flex flex-col gap-3"
      noValidate
    >
      <TextAreaField
        label="Motivo de la anulación"
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
        <Button type="submit" variant="danger" loading={busy} loadingText="Anulando…">
          Confirmar anulación del cargo
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
