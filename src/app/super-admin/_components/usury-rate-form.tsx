"use client";

import { CommandForm } from "../../negocio/_components/command-form";

/** El Super Admin registra la tasa de usura certificada (E.A.), desde cuándo rige y su fuente. */
export function UsuryRateForm({ today }: { today: string }) {
  return (
    <CommandForm<{ usuryRateId: string }>
      title="Registrar tasa de usura"
      url="/api/super-admin/usury-rates"
      openLabel="Registrar tasa de usura"
      fields={[
        {
          kind: "text",
          name: "rate",
          label: "Tasa efectiva anual (%)",
          required: true,
          hint: "Por ejemplo 28,59.",
          maxLength: 8,
        },
        {
          kind: "text",
          name: "validFrom",
          label: "Rige desde (AAAA-MM-DD)",
          required: true,
          hint: `Hoy es ${today}.`,
          maxLength: 10,
        },
        {
          kind: "text",
          name: "source",
          label: "Fuente",
          required: true,
          hint: "Por ejemplo: Resolución 1234 de 2026 de la Superintendencia Financiera.",
          maxLength: 300,
        },
      ]}
      submitLabel="Registrar"
      loadingText="Registrando…"
      successMessage={() => "Tasa de usura registrada."}
    />
  );
}
