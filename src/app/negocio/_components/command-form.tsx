"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { SelectField } from "@/shared/ui/select-field";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "./cash-feedback";

export type CommandField =
  | {
      kind: "text";
      name: string;
      label: string;
      required?: boolean;
      hint?: string;
      maxLength?: number;
    }
  | { kind: "textarea"; name: string; label: string; required?: boolean; hint?: string }
  | {
      kind: "amount";
      name: string;
      label: string;
      required?: boolean;
      hint?: string;
      allowZero?: boolean;
    }
  | {
      kind: "select";
      name: string;
      label: string;
      options: readonly { value: string; label: string }[];
      required?: boolean;
      hint?: string;
    };

type Props<T> = {
  /** Título accesible del formulario (también el `aria-label`). */
  title: string;
  /** Muestra el título como encabezado h3 visible. */
  showTitle?: boolean;
  url: string;
  fields: readonly CommandField[];
  submitLabel: string;
  loadingText: string;
  /** Valores fijos que se envían con el cuerpo (p. ej. el id de la jornada). */
  extra?: Record<string, unknown>;
  /** Los comandos financieros llevan clave de idempotencia; los de administración no. */
  idempotent?: boolean;
  /** Mensaje verificable de lo que pasó, con lo que devolvió el servidor. */
  successMessage: (data: T) => string;
  /** Texto de ayuda sobre el formulario. */
  description?: string;
  /** Si se indica, el formulario arranca cerrado detrás de un botón con este texto. */
  openLabel?: string;
  variant?: "primary" | "secondary" | "danger";
};

/**
 * Formulario de un comando de administración: valida en el cliente (solo orienta: el servidor decide), envía
 * con `useCommand`, anuncia el resultado en la región compartida y refresca la página. Cuatro estados:
 * reposo, carga (botón bloqueado), error (alerta con foco) y éxito (anuncio verificable).
 */
export function CommandForm<T>({
  title,
  showTitle = true,
  url,
  fields,
  submitLabel,
  loadingText,
  extra,
  idempotent = false,
  successMessage,
  description,
  openLabel,
  variant = "primary",
}: Props<T>) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run, reset } = useCommand<T>(url);
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [open, setOpen] = useState(openLabel === undefined);
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const openerRef = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  const busy = state.status === "loading" || state.status === "success";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  useEffect(() => {
    if (open && !wasOpen.current) {
      formRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus();
    } else if (!open && wasOpen.current) {
      openerRef.current?.focus();
    }
    wasOpen.current = open;
  }, [open]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const next: Record<string, string> = {};
    const body: Record<string, unknown> = { ...extra };
    for (const field of fields) {
      const raw = String(form.get(field.name) ?? "").trim();
      if (field.kind === "amount") {
        if (raw === "" && !field.required) continue;
        const parsed =
          field.allowZero && raw === "0" ? { ok: true as const, amount: 0 } : parseAmountInput(raw);
        if (!parsed.ok) next[field.name] = parsed.message;
        else body[field.name] = parsed.amount;
      } else if (raw === "") {
        if (field.required) next[field.name] = `${field.label}: es obligatorio.`;
      } else {
        body[field.name] = raw;
      }
    }
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const result = await run(body, {
      headers: idempotent ? { "Idempotency-Key": idempotency.current() } : undefined,
    });
    if (result.status === "success") {
      idempotency.renew();
      formElement.reset();
      reset();
      feedback.announce(successMessage(result.data));
      if (openLabel !== undefined) setOpen(false);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button
        ref={openerRef}
        variant={variant}
        className="self-start"
        onClick={() => setOpen(true)}
      >
        {openLabel}
      </Button>
    );
  }

  return (
    <form
      ref={formRef}
      method="post"
      onSubmit={onSubmit}
      // Cambiar el contenido es otra operación: otra clave (la misma con otro contenido sería un 409).
      onChange={() => idempotency.renew()}
      aria-label={title}
      className="border-border flex max-w-xl flex-col gap-3 rounded-lg border p-4"
      noValidate
    >
      {showTitle ? <h3 className="text-lg font-medium">{title}</h3> : null}
      {description ? <p className="text-muted text-sm">{description}</p> : null}
      {fields.map((field) =>
        field.kind === "textarea" ? (
          <TextAreaField
            key={field.name}
            label={field.label}
            name={field.name}
            required={field.required}
            maxLength={500}
            readOnly={busy}
            hint={field.hint}
            error={errors[field.name]}
          />
        ) : field.kind === "select" ? (
          <SelectField
            key={field.name}
            label={field.label}
            name={field.name}
            options={field.options}
            disabled={busy}
            hint={field.hint}
            error={errors[field.name]}
          />
        ) : (
          <TextField
            key={field.name}
            label={field.label}
            name={field.name}
            required={field.required}
            readOnly={busy}
            autoComplete="off"
            inputMode={field.kind === "amount" ? "numeric" : undefined}
            maxLength={field.kind === "text" ? field.maxLength : undefined}
            hint={field.hint}
            error={errors[field.name]}
            className={field.kind === "amount" ? "font-mono tabular-nums" : ""}
          />
        ),
      )}
      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant={variant} loading={busy} loadingText={loadingText}>
          {submitLabel}
        </Button>
        {openLabel !== undefined && !busy ? (
          <Button variant="secondary" onClick={() => setOpen(false)}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
