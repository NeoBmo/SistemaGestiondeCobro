"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import { CATEGORY_LABEL } from "@/modules/cash/presentation";
import { EXPENSE_CATEGORIES } from "@/modules/cash/validation";
import { formatMoney, money } from "@/shared/money/money";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { createIdempotencyKeyHolder } from "@/shared/ui/idempotency-key";
import { SelectField } from "@/shared/ui/select-field";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "./cash-feedback";

type MovementResult = { movementId: string; balance: number; replayed: boolean };

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABEL[value] ?? value,
}));
const DIRECTION_OPTIONS = [
  { value: "ENTRADA", label: "Entrada (suma a la caja)" },
  { value: "SALIDA", label: "Salida (resta de la caja)" },
];

type Props = { hasOpeningBalance: boolean };

/**
 * Registro de movimientos de Caja Mayor. Cada formulario es un comando financiero: el botón se
 * deshabilita mientras se envía y el resultado verificable (el saldo que devolvió el servidor) se
 * anuncia en la región compartida (`CashFeedbackProvider`); el historial se actualiza con
 * `router.refresh()`.
 */
export function CashActions({ hasOpeningBalance }: Props) {
  const router = useRouter();
  const feedback = useCashFeedback();

  const done = (verb: string, result: MovementResult) => {
    feedback.announce(`${verb}. Saldo de Caja Mayor: ${formatMoney(money(result.balance))}.`);
    router.refresh();
  };

  return (
    <section aria-labelledby="registrar" className="mt-8">
      <h2 id="registrar" className="text-xl font-semibold">
        Registrar movimiento
      </h2>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {hasOpeningBalance ? null : (
          <MovementForm
            command="apertura"
            title="Saldo de apertura"
            description="El efectivo con el que empieza la Caja Mayor. Se registra una sola vez."
            submitLabel="Registrar saldo de apertura"
            verb="Saldo de apertura registrado"
            onDone={done}
          />
        )}
        <MovementForm
          command="capital"
          title="Ingreso de capital"
          description="Dinero que el negocio pone en la Caja Mayor."
          submitLabel="Registrar ingreso"
          verb="Ingreso registrado"
          onDone={done}
        />
        <MovementForm
          command="gastos"
          title="Gasto de Caja Mayor"
          description="Un gasto pagado directamente desde la Caja Mayor."
          submitLabel="Registrar gasto"
          verb="Gasto registrado"
          fields="expense"
          onDone={done}
        />
        <MovementForm
          command="ajustes"
          title="Ajuste"
          description="Corrige el saldo sumando o restando; exige un motivo y queda en el historial."
          submitLabel="Registrar ajuste"
          verb="Ajuste registrado"
          fields="adjustment"
          onDone={done}
        />
      </div>
    </section>
  );
}

type FormProps = {
  command: "apertura" | "capital" | "gastos" | "ajustes";
  title: string;
  description: string;
  submitLabel: string;
  verb: string;
  fields?: "expense" | "adjustment";
  onDone: (verb: string, result: MovementResult) => void;
};

function MovementForm({
  command,
  title,
  description,
  submitLabel,
  verb,
  fields,
  onDone,
}: FormProps) {
  const { state, run, reset } = useCommand<MovementResult>(`/api/negocio/caja/${command}`);
  const feedback = useCashFeedback();
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [amountError, setAmountError] = useState<string>();
  const [noteError, setNoteError] = useState<string>();
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading";
  const headingId = `registro-${command}`;

  // Tras un fallo el botón se vuelve a habilitar pero el foco ya se perdió: se lleva al mensaje.
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const text = (name: string) => String(form.get(name) ?? "").trim();

    const parsed = parseAmountInput(text("amount"));
    const note = text("note");
    const category = text("category");
    const needsNote = (fields === "expense" && category === "OTRO") || fields === "adjustment";
    const missingNote = needsNote && note === "";

    setAmountError(parsed.ok ? undefined : parsed.message);
    setNoteError(
      missingNote
        ? fields === "adjustment"
          ? "Escribe el motivo del ajuste."
          : "La categoría Otro exige una observación."
        : undefined,
    );
    if (!parsed.ok || missingNote) return;

    const body =
      fields === "adjustment"
        ? { direction: text("direction"), amount: parsed.amount, reason: note }
        : fields === "expense"
          ? { amount: parsed.amount, category, note: note || undefined }
          : { amount: parsed.amount, note: note || undefined };
    const result = await run(body, { headers: { "Idempotency-Key": idempotency.current() } });
    if (result.status === "success") {
      idempotency.renew();
      formElement.reset();
      reset();
      onDone(verb, result.data);
    }
  }

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      // Cambiar el contenido es otra operación: otra clave (la misma con otro contenido sería un 409).
      // Mientras se envía los campos están bloqueados, así que no se renueva la clave de un envío en vuelo.
      onChange={() => idempotency.renew()}
      aria-labelledby={headingId}
      className="border-border flex flex-col gap-3 rounded-lg border p-4"
      noValidate
    >
      <h3 id={headingId} className="text-lg font-medium">
        {title}
      </h3>
      <p className="text-muted text-sm">{description}</p>

      {fields === "adjustment" ? (
        <SelectField
          label="Tipo de ajuste"
          name="direction"
          options={DIRECTION_OPTIONS}
          disabled={busy}
        />
      ) : null}
      {fields === "expense" ? (
        <SelectField label="Categoría" name="category" options={CATEGORY_OPTIONS} disabled={busy} />
      ) : null}
      <TextField
        label="Monto (pesos)"
        name="amount"
        inputMode="numeric"
        autoComplete="off"
        required
        readOnly={busy}
        hint="Pesos enteros, por ejemplo 150000 o 150.000."
        error={amountError}
        className="font-mono tabular-nums"
      />
      <TextAreaField
        label={fields === "adjustment" ? "Motivo" : "Observación"}
        name="note"
        maxLength={500}
        required={fields === "adjustment"}
        readOnly={busy}
        hint={
          fields === "adjustment"
            ? "Obligatorio: queda en el historial."
            : fields === "expense"
              ? "Opcional; obligatoria si la categoría es Otro."
              : "Opcional."
        }
        error={noteError}
      />

      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}

      <Button type="submit" loading={busy} loadingText="Registrando…" className="self-start">
        {submitLabel}
      </Button>
    </form>
  );
}
