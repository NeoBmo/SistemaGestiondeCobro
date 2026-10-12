"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "./cash-feedback";

type Props = { movementId: string; label: string };

/**
 * Reverso total de un movimiento, con motivo y confirmación explícita (anula el importe completo y
 * no se puede deshacer: un reverso no se reversa). El resultado se anuncia en la región compartida
 * porque este componente se desmonta al actualizarse el historial (el movimiento ya no es reversable).
 */
export function ReverseMovement({ movementId, label }: Props) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run } = useCommand<{ balance: number }>("/api/negocio/caja/reversos");
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

  // Al abrir, el foco pasa al motivo; al cancelar vuelve al botón que lo abrió (que se había desmontado).
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
    const result = await run(
      { movementId, reason },
      { headers: { "Idempotency-Key": idempotency.current() } },
    );
    if (result.status === "success") {
      feedback.announce(
        `Movimiento reversado. Saldo de Caja Mayor: ${formatMoney(money(result.data.balance))}.`,
      );
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant="secondary"
        onClick={() => setOpen(true)}
        aria-label={`Reversar ${label}`}
      >
        Reversar
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={onSubmit}
      onChange={() => idempotency.renew()}
      aria-label={`Reversar ${label}`}
      className="border-border mt-2 flex flex-col gap-3 rounded-lg border p-3"
      noValidate
    >
      <Alert variant="warning">
        Se anulará el movimiento completo y quedará registrado. No se puede deshacer.
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
