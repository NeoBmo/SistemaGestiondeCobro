"use client";

import { formatMoney, money } from "@/shared/money/money";
import { CommandForm } from "../../_components/command-form";

export function FundForm({
  sessionId,
  collectorName,
}: {
  sessionId: string;
  collectorName: string;
}) {
  return (
    <CommandForm<{ amount: number; balance: number; sessionBalance: number }>
      title={`Transferir fondo a ${collectorName}`}
      url="/api/negocio/jornadas/fondo"
      idempotent
      extra={{ sessionId }}
      openLabel="Transferir fondo"
      description="Sale de la Caja Mayor y entra a la Caja Menor de la jornada."
      fields={[{ kind: "amount", name: "amount", label: "Monto (pesos)", required: true }]}
      submitLabel="Transferir"
      loadingText="Transfiriendo…"
      successMessage={(data) =>
        `Fondo de ${formatMoney(money(data.amount))} transferido. Caja Mayor: ${formatMoney(money(data.balance))}; Caja Menor de la jornada: ${formatMoney(money(data.sessionBalance))}.`
      }
    />
  );
}

export function ConfirmSettlementForm({
  settlementId,
  declaredAmount,
  expectedAmount,
}: {
  settlementId: string;
  declaredAmount: number;
  expectedAmount: number;
}) {
  return (
    <CommandForm<{ difference: number; receivedAmount: number; balance: number }>
      title="Confirmar liquidación"
      url={`/api/negocio/liquidaciones/${settlementId}/confirmar`}
      idempotent
      openLabel="Confirmar liquidación"
      description={`Esperado ${formatMoney(money(expectedAmount))}; el cobrador declaró ${formatMoney(money(declaredAmount))}. Escribe lo que realmente recibiste.`}
      fields={[
        {
          kind: "amount",
          name: "receivedAmount",
          label: "Dinero recibido (pesos)",
          required: true,
          allowZero: true,
        },
        {
          kind: "textarea",
          name: "observation",
          label: "Observación",
          hint: "Obligatoria si lo recibido no coincide con lo esperado.",
        },
      ]}
      submitLabel="Confirmar"
      loadingText="Confirmando…"
      successMessage={(data) =>
        data.difference === 0
          ? `Liquidación cuadrada. Recibiste ${formatMoney(money(data.receivedAmount))}; Caja Mayor: ${formatMoney(money(data.balance))}.`
          : `Liquidación con ${data.difference > 0 ? "faltante" : "sobrante"} de ${formatMoney(money(Math.abs(data.difference)))}. Recibiste ${formatMoney(money(data.receivedAmount))}; Caja Mayor: ${formatMoney(money(data.balance))}.`
      }
    />
  );
}

export function ResolveDifferenceForm({
  settlementId,
  difference,
}: {
  settlementId: string;
  difference: number;
}) {
  return (
    <CommandForm<{ amount: number; balance: number }>
      title="Resolver la diferencia"
      url={`/api/negocio/liquidaciones/${settlementId}/resolver`}
      idempotent
      openLabel="Resolver diferencia"
      description={
        difference > 0
          ? `Registra un ajuste que ingresa ${formatMoney(money(difference))} a la Caja Mayor (el cobrador repuso el faltante).`
          : `Registra un ajuste que saca ${formatMoney(money(-difference))} de la Caja Mayor (se devolvió el sobrante).`
      }
      fields={[{ kind: "textarea", name: "note", label: "Motivo", required: true }]}
      submitLabel="Registrar ajuste"
      loadingText="Registrando…"
      successMessage={(data) =>
        `Diferencia resuelta con un ajuste de ${formatMoney(money(data.amount))}. Caja Mayor: ${formatMoney(money(data.balance))}.`
      }
    />
  );
}
