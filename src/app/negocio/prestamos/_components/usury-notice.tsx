"use client";

import { formatRateBps } from "@/modules/portfolio/effective-annual-rate";
import type { UsuryAssessment } from "@/modules/portfolio/usury";
import { formatIsoDate } from "@/shared/dates/dates";
import { Alert } from "@/shared/ui/alert";

type Props = {
  usury: UsuryAssessment;
  acknowledged: boolean;
  onAcknowledgedChange: (value: boolean) => void;
  disabled?: boolean;
};

/**
 * Tasa efectiva anual del préstamo frente a la usura vigente (02 §2.3). Advierte sin bloquear: si la supera,
 * el Admin debe marcar la advertencia para poder confirmar (el servidor también lo exige). Sin tasa
 * registrada solo lo indica.
 */
export function UsuryNotice({ usury, acknowledged, onAcknowledgedChange, disabled }: Props) {
  const rate = `${usury.effectiveAnnualRateCapped ? "más de " : ""}${formatRateBps(usury.effectiveAnnualRateBps)} E.A.`;

  if (!usury.usuryRate) {
    return (
      <div className="mt-4" data-testid="usura">
        <Alert variant="info" title="Sin tasa de usura registrada">
          La tasa efectiva anual de este préstamo es{" "}
          <span className="font-mono tabular-nums">{rate}</span>, pero la plataforma todavía no
          tiene registrada la tasa de usura vigente, así que no se pudo comparar. Puedes confirmar.
        </Alert>
      </div>
    );
  }

  const usuryRate = `${formatRateBps(usury.usuryRate.rateBps)} E.A.`;
  if (!usury.exceeds) {
    return (
      <p className="mt-4 text-sm" data-testid="usura">
        Tasa efectiva anual: <span className="font-mono tabular-nums">{rate}</span>, por debajo de
        la usura vigente (<span className="font-mono tabular-nums">{usuryRate}</span>).
      </p>
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-2" data-testid="usura">
      <Alert variant="warning" title="Este préstamo supera la tasa de usura">
        Tasa efectiva anual del préstamo: <span className="font-mono tabular-nums">{rate}</span>.
        Usura vigente: <span className="font-mono tabular-nums">{usuryRate}</span> desde el{" "}
        {formatIsoDate(usury.usuryRate.validFrom)} ({usury.usuryRate.source}). Cobrar por encima de
        la usura es delito (art. 305 del Código Penal) y la responsabilidad es del negocio. Revisa
        el interés, el plazo o la frecuencia antes de confirmar.
      </Alert>
      <label className="flex min-h-11 items-center gap-3 font-medium">
        <input
          type="checkbox"
          className="size-5 shrink-0"
          checked={acknowledged}
          disabled={disabled}
          onChange={(event) => onAcknowledgedChange(event.currentTarget.checked)}
        />
        Conozco la advertencia de usura y quiero confirmar de todos modos
      </label>
    </div>
  );
}
