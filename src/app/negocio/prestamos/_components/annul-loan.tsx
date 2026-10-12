"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "../../_components/cash-feedback";

type Props = { loanId: string; contractNumber: string };

/**
 * Anula el contrato y el préstamo, con motivo obligatorio y confirmación explícita: devuelve el desembolso
 * a la Caja Mayor (con un reverso vinculado) y no se puede deshacer. El resultado se anuncia en la región
 * compartida porque este componente se desmonta al actualizarse la página (ya no hay nada que anular).
 */
export function AnnulLoan({ loanId, contractNumber }: Props) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run } = useCommand<{ balance: number }>(`/api/negocio/prestamos/${loanId}/anular`);
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [open, setOpen] = useState(false);
  const [reasonError, setReasonError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const busy = state.status === "loading" || state.status === "success";

  useEffect(() => {
    if (state.status !== "error") return;
    errorRef.current?.focus();
    // Otra pestaña (u otro usuario) ya lo anuló: se vuelve a leer la página para mostrar el estado real.
    if (state.error.code === "CONTRACT_ALREADY_VOIDED") router.refresh();
  }, [state, router]);

  // Al abrir, el foco pasa al motivo; al cancelar vuelve al botón que lo abrió.
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
      setReasonError("Escribe el motivo de la anulación.");
      return;
    }
    setReasonError(undefined);
    const result = await run({ reason }, { headers: { "Idempotency-Key": idempotency.current() } });
    if (result.status === "success") {
      feedback.announce(
        `Contrato ${contractNumber} anulado. El desembolso volvió a la Caja Mayor, que quedó en ${formatMoney(money(result.data.balance))}.`,
      );
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button ref={openerRef} variant="danger" onClick={() => setOpen(true)}>
        Anular contrato
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={onSubmit}
      onChange={() => idempotency.renew()}
      aria-label={`Anular el contrato ${contractNumber}`}
      className="border-border flex max-w-xl flex-col gap-3 rounded-lg border p-4"
      noValidate
    >
      <Alert variant="warning">
        Se anulará el contrato y el préstamo con todas sus cuotas, y el dinero desembolsado volverá
        a la Caja Mayor. Queda en el historial y no se puede deshacer.
      </Alert>
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
          Confirmar anulación
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
