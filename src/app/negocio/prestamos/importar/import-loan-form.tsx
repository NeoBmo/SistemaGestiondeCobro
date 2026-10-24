"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { parseAmountInput } from "@/modules/cash/amount-input";
import type { ImportPreview, ImportedContract } from "@/modules/portfolio/imports";
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

const FREQUENCY_OPTIONS = LOAN_FREQUENCIES.map((value) => ({
  value,
  label: { DIARIA: "Diaria", SEMANAL: "Semanal", MENSUAL: "Mensual" }[value],
}));

type Props = { clientId: string; clientName: string; today: string };

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
 * Importación de un préstamo de cartera previa, en dos pasos y sin tocar ninguna caja: «Calcular» propone
 * las cuotas que faltan (el saldo en partes iguales), el Admin puede cambiar el monto de cada una e
 * «Importar» las guarda. Lo ya pagado queda solo como dato de referencia; si no cuadra con el total y el
 * saldo, importar exige confirmarlo con una observación (02 §6.1). Cambiar cualquier dato del préstamo
 * descarta la vista previa. Las comprobaciones de aquí son solo ayuda: el servidor las repite.
 */
export function ImportLoanForm({ clientId, clientName, today }: Props) {
  const router = useRouter();
  const preview = useCommand<ImportPreview>("/api/negocio/prestamos/importar/vista-previa");
  const confirm = useCommand<ImportedContract>("/api/negocio/prestamos/importar");
  const [terms, setTerms] = useState<Record<string, unknown> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idempotency] = useState(() => createIdempotencyKeyHolder());
  const [amounts, setAmounts] = useState<string[]>([]);
  const [mismatch, setMismatch] = useState({ confirmed: false, note: "" });
  const [confirmErrors, setConfirmErrors] = useState<Record<string, string>>({});
  const errorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const confirmErrorId = useId();
  const calculating = preview.state.status === "loading";
  const confirming = confirm.state.status === "loading" || confirm.state.status === "success";
  const busy = calculating || confirming;
  const planned = preview.state.status === "success" && terms ? preview.state.data : null;
  const unbalanced = planned !== null && planned.difference !== null && planned.difference !== 0;
  const parsedAmounts = amounts.map((text) => parseAmountInput(text));
  const amountsSum = parsedAmounts.every((parsed) => parsed.ok)
    ? parsedAmounts.reduce((sum, parsed) => sum + (parsed.ok ? parsed.amount : 0), 0)
    : null;

  useEffect(() => {
    if (preview.state.status === "error" || confirm.state.status === "error") {
      errorRef.current?.focus();
    }
  }, [preview.state.status, confirm.state.status]);

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
    const principal = parseAmountInput(text("principal"));
    if (!principal.ok) next.principal = principal.message;
    const pending = parseAmountInput(text("pendingBalance"));
    if (!pending.ok) next.pendingBalance = pending.message;
    const paidText = text("historicalPaid");
    const paid =
      paidText === ""
        ? null
        : paidText === "0"
          ? { ok: true as const, amount: 0 }
          : parseAmountInput(paidText);
    if (paid && !paid.ok) next.historicalPaid = paid.message;
    const bps = parsePercent(text("interest"));
    if (bps === null) next.interest = "Escribe un porcentaje, por ejemplo 20 o 12,5.";
    const count = Number(text("installmentCount"));
    if (!Number.isInteger(count) || count < 1)
      next.installmentCount = "Escribe un número de cuotas entero.";
    if (!text("originalDate")) next.originalDate = "Elige la fecha original del préstamo.";
    if (!text("nextDueOn")) next.nextDueOn = "Elige la próxima fecha de cobro.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !principal.ok || !pending.ok || bps === null) return;

    const chosen = {
      clientId,
      originalDate: text("originalDate"),
      principal: principal.amount,
      interestBps: bps,
      frequency: text("frequency"),
      historicalPaid: paid && paid.ok ? paid.amount : undefined,
      pendingBalance: pending.amount,
      installmentCount: count,
      nextDueOn: text("nextDueOn"),
    };
    setTerms({ ...chosen, comment: text("comment") || undefined });
    const result = await preview.run(chosen);
    if (result.status === "success") {
      setAmounts(result.data.plan.installments.map((installment) => String(installment.amount)));
      setMismatch({ confirmed: false, note: "" });
      setConfirmErrors({});
    }
  }

  // Corregir montos u observación no renueva la clave: un intento rechazado no la dejó reservada, y uno
  // que sí se guardó (respuesta perdida) debe responder 409 en vez de importar dos veces.
  function onEditConfirmation() {
    if (confirm.state.status === "error") confirm.reset();
  }

  async function onConfirm() {
    if (!terms || !planned) return;
    const next: Record<string, string> = {};
    parsedAmounts.forEach((parsed, index) => {
      if (!parsed.ok) next[`amount-${index}`] = parsed.message;
    });
    if (amountsSum !== null && amountsSum !== planned.plan.scheduled) {
      next.amounts = `Las cuotas suman ${formatMoney(money(amountsSum))} y deben sumar exactamente el saldo pendiente, ${formatMoney(money(planned.plan.scheduled))}.`;
    }
    if (unbalanced && !mismatch.confirmed) {
      next.confirmMismatch = "Confirma que quieres importar con esta diferencia.";
    }
    if (unbalanced && mismatch.note.trim() === "") {
      next.mismatchNote = "Escribe por qué los datos históricos no cuadran.";
    }
    setConfirmErrors(next);
    const firstError = Object.keys(next)[0];
    if (firstError !== undefined) {
      // El foco va al primer campo con error: su mensaje se lee por `aria-describedby` y, en móvil,
      // queda a la vista aunque la lista de cuotas tenga desplazamiento propio.
      const field = firstError.startsWith("amount-")
        ? `installment-${Number(firstError.slice("amount-".length)) + 1}`
        : firstError === "amounts"
          ? "installment-1"
          : firstError;
      previewRef.current?.querySelector<HTMLElement>(`[name="${field}"]`)?.focus();
      return;
    }

    const body = {
      ...terms,
      installmentAmounts: parsedAmounts.map((parsed) => (parsed.ok ? parsed.amount : 0)),
      ...(unbalanced ? { confirmMismatch: true, mismatchNote: mismatch.note.trim() } : {}),
    };
    const result = await confirm.run(body, {
      headers: { "Idempotency-Key": idempotency.current() },
    });
    if (result.status === "success") router.push(`/negocio/prestamos/${result.data.loanId}`);
  }

  return (
    <div className="mt-4 flex max-w-2xl flex-col gap-6">
      <form
        method="post"
        onSubmit={onCalculate}
        onChange={discardPreview}
        aria-label="Datos del préstamo anterior"
        className="flex flex-col gap-4"
        noValidate
      >
        <p className="text-sm">
          Cliente: <span className="font-medium">{clientName}</span>
        </p>
        <TextField
          label="Fecha original del préstamo"
          name="originalDate"
          type="date"
          required
          max={today}
          readOnly={busy}
          error={errors.originalDate}
        />
        <TextField
          label="Monto prestado originalmente (pesos)"
          name="principal"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          className="font-mono tabular-nums"
          error={errors.principal}
        />
        <TextField
          label="Interés pactado (%)"
          name="interest"
          inputMode="decimal"
          autoComplete="off"
          required
          defaultValue="20"
          readOnly={busy}
          hint="Con él se calcula el total pactado, como en un préstamo nuevo."
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
          label="Ya pagado antes de importar (pesos)"
          name="historicalPaid"
          inputMode="numeric"
          autoComplete="off"
          readOnly={busy}
          className="font-mono tabular-nums"
          hint="Opcional y solo de referencia: no crea pagos ni mueve ninguna caja."
          error={errors.historicalPaid}
        />
        <TextField
          label="Saldo pendiente hoy (pesos)"
          name="pendingBalance"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          className="font-mono tabular-nums"
          hint="Lo que aún debe el cliente. Se reparte en las cuotas que faltan."
          error={errors.pendingBalance}
        />
        <TextField
          label="Cuotas que faltan"
          name="installmentCount"
          inputMode="numeric"
          autoComplete="off"
          required
          readOnly={busy}
          error={errors.installmentCount}
        />
        <TextField
          label="Próxima fecha de cobro"
          name="nextDueOn"
          type="date"
          required
          readOnly={busy}
          hint="Si ya pasó, esas cuotas quedarán vencidas y con sus días de mora."
          error={errors.nextDueOn}
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
        <section
          ref={previewRef}
          aria-labelledby="vista-previa"
          className="border-border rounded-lg border p-4"
        >
          <h2 id="vista-previa" className="text-xl font-semibold">
            Vista previa
          </h2>
          <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <dt className="text-muted">Total pactado</dt>
            <dd className="font-mono tabular-nums">{formatMoney(money(planned.plan.total))}</dd>
            {planned.historicalPaid !== null ? (
              <>
                <dt className="text-muted">Ya pagado</dt>
                <dd className="font-mono tabular-nums">
                  {formatMoney(money(planned.historicalPaid))}
                </dd>
              </>
            ) : null}
            <dt className="text-muted">Saldo pendiente</dt>
            <dd className="font-mono font-semibold tabular-nums">
              {formatMoney(money(planned.plan.scheduled))}
            </dd>
            <dt className="text-muted">Cuotas</dt>
            <dd>
              {planned.plan.installments.length} desde el{" "}
              {formatIsoDate(planned.plan.installments[0]!.dueOn)}
            </dd>
          </dl>
          {unbalanced ? (
            <div className="mt-3 flex flex-col gap-3">
              <Alert variant="warning" title="Los datos históricos no cuadran">
                El total pactado menos lo pagado y el saldo pendiente da{" "}
                {formatMoney(money(planned.difference ?? 0))}. Puede haber abonos, descuentos o un
                error: revisa antes de importar. Si importas así, se guardará el saldo pendiente que
                escribiste y la diferencia quedará en la auditoría con tu observación.
              </Alert>
              <div className="flex flex-col gap-1">
                <label className="flex min-h-11 items-center gap-2 text-base font-medium">
                  <input
                    type="checkbox"
                    name="confirmMismatch"
                    checked={mismatch.confirmed}
                    disabled={busy}
                    aria-invalid={confirmErrors.confirmMismatch ? true : undefined}
                    aria-describedby={confirmErrors.confirmMismatch ? confirmErrorId : undefined}
                    onChange={(event) => {
                      setMismatch({ ...mismatch, confirmed: event.target.checked });
                      onEditConfirmation();
                    }}
                    className="size-5"
                  />
                  Confirmo que quiero importar con esta diferencia
                </label>
                {confirmErrors.confirmMismatch ? (
                  <p id={confirmErrorId} aria-live="polite" className="text-danger-strong text-sm">
                    <span aria-hidden="true">⚠ </span>
                    {confirmErrors.confirmMismatch}
                  </p>
                ) : null}
              </div>
              <TextAreaField
                label="Observación del descuadre"
                name="mismatchNote"
                maxLength={500}
                required
                readOnly={busy}
                value={mismatch.note}
                onChange={(event) => {
                  setMismatch({ ...mismatch, note: event.target.value });
                  onEditConfirmation();
                }}
                hint="Explica la diferencia (abonos de interés, descuentos…). Queda en la auditoría."
                error={confirmErrors.mismatchNote}
              />
            </div>
          ) : null}
          {planned.overdueInstallments > 0 ? (
            <div className="mt-3">
              <Alert
                variant="warning"
                title={`${planned.overdueInstallments} cuota(s) ya vencida(s)`}
              >
                Quedarán registradas como vencidas, con sus días de mora.
              </Alert>
            </div>
          ) : null}

          <h3 className="mt-4 text-lg font-medium">Cuotas que faltan</h3>
          <p className="text-muted text-sm">
            Propuesta: el saldo en partes iguales. Puedes cambiar el monto de cada cuota; entre
            todas tienen que dar el saldo pendiente, ni un peso más ni uno menos.
          </p>
          <ol className="mt-2 grid max-h-96 gap-3 overflow-y-auto p-1 sm:grid-cols-2">
            {planned.plan.installments.map((installment, index) => (
              <li key={installment.number}>
                <TextField
                  label={`Cuota ${installment.number}, ${formatIsoDate(installment.dueOn)}`}
                  name={`installment-${installment.number}`}
                  inputMode="numeric"
                  autoComplete="off"
                  required
                  readOnly={busy}
                  value={amounts[index] ?? ""}
                  onChange={(event) => {
                    const next = [...amounts];
                    next[index] = event.target.value;
                    setAmounts(next);
                    onEditConfirmation();
                  }}
                  className="font-mono tabular-nums"
                  error={confirmErrors[`amount-${index}`]}
                />
              </li>
            ))}
          </ol>
          {/* Sin `aria-live`: anunciaría cada tecla; los errores se anuncian al enfocar el campo. */}
          <p className="mt-3 text-sm">
            {amountsSum === null ? (
              "Revisa los montos: alguno no es un número válido."
            ) : amountsSum === planned.plan.scheduled ? (
              <>
                Las cuotas suman{" "}
                <span className="font-mono tabular-nums">{formatMoney(money(amountsSum))}</span>,
                igual al saldo pendiente.
              </>
            ) : (
              <>
                Las cuotas suman{" "}
                <span className="font-mono tabular-nums">{formatMoney(money(amountsSum))}</span>:{" "}
                {amountsSum < planned.plan.scheduled ? "faltan" : "sobran"}{" "}
                <span className="font-mono tabular-nums">
                  {formatMoney(money(Math.abs(planned.plan.scheduled - amountsSum)))}
                </span>{" "}
                para llegar al saldo pendiente.
              </>
            )}
          </p>
          {confirmErrors.amounts ? (
            <p aria-live="polite" className="text-danger-strong mt-1 text-sm">
              <span aria-hidden="true">⚠ </span>
              {confirmErrors.amounts}
            </p>
          ) : null}
          <p className="text-muted mt-3 text-sm">
            Importar no crea pagos ni movimientos: la Caja Mayor no cambia.
          </p>

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
                Contrato {confirm.state.data.contractNumber} importado.{" "}
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
            loadingText="Importando…"
            disabled={calculating}
          >
            Importar préstamo
          </Button>
        </section>
      ) : null}
    </div>
  );
}
