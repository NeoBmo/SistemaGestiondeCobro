"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "./cash-feedback";

type Props<T> = {
  url: string;
  label: string;
  /** Qué va a pasar: se muestra antes de confirmar. */
  warning: string;
  confirmLabel: string;
  loadingText: string;
  variant?: "primary" | "secondary" | "danger";
  successMessage: (data: T) => string;
  /** Adónde ir tras el éxito cuando lo mostrado deja de existir; sin él, se refresca la página. */
  redirectTo?: string;
};

/** Acción sin datos (desactivar, reactivar, cerrar…): un botón, un aviso de lo que pasará y su confirmación. */
export function ConfirmAction<T>({
  url,
  label,
  warning,
  confirmLabel,
  loadingText,
  variant = "secondary",
  successMessage,
  redirectTo,
}: Props<T>) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run, reset } = useCommand<T>(url);
  const [open, setOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  const busy = state.status === "loading" || state.status === "success";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (!open && wasOpen.current) openerRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  async function confirm() {
    feedback.clear();
    const result = await run({});
    if (result.status === "success" && redirectTo) {
      router.push(redirectTo);
    } else if (result.status === "success") {
      feedback.announce(successMessage(result.data));
      setOpen(false);
      reset();
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button ref={openerRef} variant={variant} onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  }
  return (
    <div
      className="border-border flex max-w-xl flex-col gap-3 rounded-lg border p-3"
      role="group"
      aria-label={label}
    >
      <Alert variant="warning">{warning}</Alert>
      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button
          variant={variant === "secondary" ? "primary" : variant}
          loading={busy}
          loadingText={loadingText}
          onClick={confirm}
        >
          {confirmLabel}
        </Button>
        {busy ? null : (
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              setOpen(false);
            }}
          >
            Cancelar
          </Button>
        )}
      </div>
    </div>
  );
}
