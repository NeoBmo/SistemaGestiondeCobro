"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PERIODS, PERIOD_LABEL, type Period } from "@/modules/dashboard/periods";
import { WIDGETS, WIDGET_LABEL, type Widget } from "@/modules/dashboard/widgets";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { SelectField } from "@/shared/ui/select-field";
import { useCommand } from "@/shared/ui/use-command";
import { useCashFeedback } from "./cash-feedback";

type Saved = { period: Period; widgets: Widget[] };

/**
 * Configuración de presentación del dashboard (planes mensual y anual): indicadores visibles, su orden y el
 * periodo. Solo cambia lo que se muestra; nunca escribe balances. Sin JavaScript de arrastre: el orden se
 * cambia con botones «subir» y «bajar», que funcionan con teclado y lector de pantalla.
 */
export function DashboardSettings({ initial }: { initial: Saved }) {
  const router = useRouter();
  const feedback = useCashFeedback();
  const { state, run } = useCommand<Saved>("/api/negocio/dashboard");
  const [period, setPeriod] = useState<Period>(initial.period);
  // Primero los visibles en su orden, luego los ocultos.
  const [order, setOrder] = useState<Widget[]>([
    ...initial.widgets,
    ...WIDGETS.filter((widget) => !initial.widgets.includes(widget)),
  ]);
  const [visible, setVisible] = useState<Set<Widget>>(new Set(initial.widgets));
  const [open, setOpen] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading";

  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  function move(index: number, delta: -1 | 1) {
    const target = index + delta;
    if (target < 0 || target >= order.length) return;
    const next = [...order];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setOrder(next);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    feedback.clear();
    const widgets = order.filter((widget) => visible.has(widget));
    const result = await run({ period, widgets });
    if (result.status === "success") {
      feedback.announce("Dashboard actualizado. Solo cambió lo que se muestra.");
      setOpen(false);
      router.refresh();
    }
  }

  if (!open) {
    return (
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Configurar dashboard
      </Button>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      aria-label="Configurar el dashboard"
      className="border-border flex max-w-xl flex-col gap-3 rounded-lg border p-4"
    >
      <SelectField
        label="Periodo"
        name="period"
        value={period}
        onChange={(event) => setPeriod(event.target.value as Period)}
        options={PERIODS.map((value) => ({ value, label: PERIOD_LABEL[value] }))}
        disabled={busy}
      />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-base font-medium">Indicadores y orden</legend>
        <ol className="flex flex-col gap-2">
          {order.map((widget, index) => (
            <li
              key={widget}
              className="border-border flex flex-wrap items-center gap-2 rounded-lg border p-2"
            >
              <label className="flex min-h-11 flex-1 items-center gap-2">
                <input
                  type="checkbox"
                  checked={visible.has(widget)}
                  disabled={busy}
                  onChange={(event) => {
                    const next = new Set(visible);
                    if (event.target.checked) next.add(widget);
                    else next.delete(widget);
                    setVisible(next);
                  }}
                  className="size-5"
                />
                {WIDGET_LABEL[widget]}
              </label>
              <Button
                variant="secondary"
                disabled={busy || index === 0}
                aria-label={`Subir ${WIDGET_LABEL[widget]}`}
                onClick={() => move(index, -1)}
              >
                ↑
              </Button>
              <Button
                variant="secondary"
                disabled={busy || index === order.length - 1}
                aria-label={`Bajar ${WIDGET_LABEL[widget]}`}
                onClick={() => move(index, 1)}
              >
                ↓
              </Button>
            </li>
          ))}
        </ol>
      </fieldset>
      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button type="submit" loading={busy} loadingText="Guardando…">
          Guardar
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
