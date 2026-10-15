"use client";

import { CommandForm } from "../negocio/_components/command-form";
import { ConfirmAction } from "../negocio/_components/confirm-action";

const PRIORITIES = [
  { value: "ALTA", label: "Alta" },
  { value: "MEDIA", label: "Media" },
  { value: "BAJA", label: "Baja" },
] as const;

/** El Admin abre un ticket: describe el problema y propone una prioridad. */
export function CreateTicketForm() {
  return (
    <CommandForm<{ ticketId: string }>
      title="Nuevo ticket de soporte"
      url="/api/negocio/tickets"
      openLabel="Nuevo ticket"
      description="Cuéntanos qué pasó. Responderemos en esta misma pantalla."
      fields={[
        { kind: "textarea", name: "description", label: "¿Qué necesitas?", required: true },
        { kind: "select", name: "priority", label: "Prioridad", options: PRIORITIES },
      ]}
      submitLabel="Enviar ticket"
      loadingText="Enviando…"
      successMessage={() => "Ticket enviado. Verás aquí la respuesta del equipo de soporte."}
    />
  );
}

/** El Admin cierra un ticket resuelto o lo reabre. */
export function ResolvedTicketActions({ ticketId }: { ticketId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      <ConfirmAction<{ status: string }>
        url={`/api/negocio/tickets/${ticketId}/cerrar`}
        label="Cerrar ticket"
        variant="secondary"
        warning="El ticket se cerrará y ya no se podrá modificar."
        confirmLabel="Cerrar ticket"
        loadingText="Cerrando…"
        successMessage={() => "Ticket cerrado."}
      />
      <ConfirmAction<{ status: string }>
        url={`/api/negocio/tickets/${ticketId}/reabrir`}
        label="Reabrir"
        variant="secondary"
        warning="Si el problema sigue, el ticket vuelve a quedar abierto para soporte."
        confirmLabel="Reabrir ticket"
        loadingText="Reabriendo…"
        successMessage={() => "Ticket reabierto."}
      />
    </div>
  );
}

/** El Super Admin atiende: estado hacia adelante, prioridad y respuesta (al menos una cosa). */
export function AttendTicketForm({
  ticketId,
  status,
  priority,
  response,
}: {
  ticketId: string;
  status: "ABIERTO" | "EN_ATENCION" | "RESUELTO" | "CERRADO";
  priority: "ALTA" | "MEDIA" | "BAJA";
  response: string | null;
}) {
  if (status === "CERRADO") {
    return <p className="text-muted text-sm">El ticket está cerrado y ya no se modifica.</p>;
  }
  const forward = [
    { value: "", label: "Sin cambio" },
    ...(status === "ABIERTO" ? [{ value: "EN_ATENCION", label: "En atención" }] : []),
    ...(status !== "RESUELTO" ? [{ value: "RESUELTO", label: "Resuelto" }] : []),
  ];
  return (
    <CommandForm<{ changed: string[] }>
      title="Atender el ticket"
      url={`/api/super-admin/tickets/${ticketId}`}
      description={response ? `Respuesta actual: ${response}` : "Todavía no hay respuesta."}
      fields={[
        { kind: "select", name: "status", label: "Estado", options: forward },
        {
          kind: "select",
          name: "priority",
          label: "Prioridad",
          options: [{ value: "", label: `Sin cambio (${priority})` }, ...PRIORITIES],
        },
        { kind: "textarea", name: "response", label: "Respuesta" },
      ]}
      submitLabel="Guardar"
      loadingText="Guardando…"
      successMessage={(data) =>
        data.changed.length === 0 ? "No había cambios que guardar." : "Ticket actualizado."
      }
    />
  );
}

/** El Super Admin registra la verificación de un backup. */
export function BackupCheckForm({ today }: { today: string }) {
  return (
    <CommandForm<{ backupCheckId: string }>
      title="Registrar verificación de backup"
      url="/api/super-admin/backups"
      openLabel="Registrar verificación"
      fields={[
        {
          kind: "text",
          name: "checkedOn",
          label: "Fecha (AAAA-MM-DD)",
          required: true,
          hint: `Hoy es ${today}.`,
        },
        {
          kind: "select",
          name: "result",
          label: "Resultado",
          options: [
            { value: "OK", label: "Correcto" },
            { value: "FALLO", label: "Con fallo" },
          ],
        },
        { kind: "textarea", name: "note", label: "Nota" },
      ]}
      submitLabel="Registrar"
      loadingText="Registrando…"
      successMessage={() => "Verificación registrada."}
    />
  );
}
