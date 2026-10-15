"use client";

import { EXPENSE_CATEGORIES } from "@/modules/cash/validation";
import { CATEGORY_LABEL } from "@/modules/cash/presentation";
import { ATTEMPT_REASONS } from "@/modules/collections/validation";
import { formatMoney, money } from "@/shared/money/money";
import { CommandForm } from "../../negocio/_components/command-form";

const cash = (value: number) => formatMoney(money(value));

const CATEGORY_OPTIONS = EXPENSE_CATEGORIES.map((value) => ({
  value,
  label: CATEGORY_LABEL[value] ?? value,
}));

const REASON_LABEL: Record<(typeof ATTEMPT_REASONS)[number], string> = {
  CLIENTE_AUSENTE: "El cliente no estaba",
  LUGAR_CERRADO: "Lugar cerrado",
  SIN_DINERO: "Sin dinero",
  DIRECCION_INCORRECTA: "Dirección incorrecta",
  OTRO: "Otro (escribe la observación)",
};

export function OpenSessionForm() {
  return (
    <CommandForm<{ businessDate: string }>
      title="Abrir jornada"
      showTitle={false}
      url="/api/cobrador/jornada"
      idempotent
      description="Empiezas en cero. El administrador te transferirá el fondo operativo."
      fields={[]}
      submitLabel="Abrir mi jornada"
      loadingText="Abriendo…"
      successMessage={() => "Jornada abierta. Ya puedes registrar cobros y gastos."}
    />
  );
}

export function ExpenseForm() {
  return (
    <CommandForm<{ sessionBalance: number }>
      title="Registrar gasto"
      url="/api/cobrador/gastos"
      idempotent
      openLabel="Registrar gasto"
      fields={[
        { kind: "select", name: "category", label: "Categoría", options: CATEGORY_OPTIONS },
        { kind: "amount", name: "amount", label: "Monto (pesos)", required: true },
        {
          kind: "textarea",
          name: "note",
          label: "Observación",
          hint: "Obligatoria si la categoría es Otro.",
        },
      ]}
      submitLabel="Registrar gasto"
      loadingText="Registrando…"
      successMessage={(data) =>
        `Gasto registrado. Debes tener ${cash(data.sessionBalance)} en la mano.`
      }
    />
  );
}

export function DeclareSettlementForm({ expected }: { expected: number }) {
  return (
    <CommandForm<{ declaredAmount: number; expectedAmount: number }>
      title="Entregar y cerrar la jornada"
      url="/api/cobrador/liquidacion"
      idempotent
      openLabel="Entregar y cerrar jornada"
      variant="secondary"
      description={`Según tus registros debes entregar ${cash(expected)}. Escribe lo que entregas: el administrador lo confirmará.`}
      fields={[
        {
          kind: "amount",
          name: "declaredAmount",
          label: "Dinero que entregas (pesos)",
          required: true,
          allowZero: true,
        },
      ]}
      submitLabel="Declarar entrega"
      loadingText="Declarando…"
      successMessage={(data) =>
        `Entrega de ${cash(data.declaredAmount)} declarada. Espera la confirmación del administrador.`
      }
    />
  );
}

export function AttemptForms({ clientId }: { clientId: string }) {
  return (
    <div className="flex flex-col gap-3">
      <CommandForm<{ type: string }>
        title="No pude cobrar"
        url="/api/cobrador/intentos"
        idempotent
        extra={{ clientId, type: "INTENTO_FALLIDO" }}
        openLabel="No pude cobrar"
        variant="secondary"
        fields={[
          {
            kind: "select",
            name: "reason",
            label: "Motivo",
            options: ATTEMPT_REASONS.map((value) => ({ value, label: REASON_LABEL[value] })),
          },
          {
            kind: "textarea",
            name: "note",
            label: "Observación",
            hint: "Obligatoria si el motivo es Otro.",
          },
        ]}
        submitLabel="Registrar intento fallido"
        loadingText="Registrando…"
        successMessage={() => "Intento fallido registrado. La deuda no cambió."}
      />
      <CommandForm<{ type: string }>
        title="Volver a cobrar"
        url="/api/cobrador/intentos"
        idempotent
        extra={{ clientId, type: "VOLVER_A_COBRAR" }}
        openLabel="Volver a cobrar"
        variant="secondary"
        fields={[
          {
            kind: "datetime",
            name: "retryAt",
            label: "¿Cuándo vuelves?",
            hint: "Opcional: fecha y hora del nuevo intento.",
          },
          { kind: "textarea", name: "note", label: "Observación" },
        ]}
        submitLabel="Programar reintento"
        loadingText="Guardando…"
        successMessage={() => "Reintento registrado. La deuda no cambió."}
      />
    </div>
  );
}
