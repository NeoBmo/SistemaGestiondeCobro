"use client";

import { CommandForm } from "../../_components/command-form";
import { ConfirmAction } from "../../_components/confirm-action";

type Credentials = { username: string; temporaryPassword: string };

const credentialsMessage = (verb: string, data: Credentials) =>
  `${verb}. Usuario: ${data.username} · contraseña temporal: ${data.temporaryPassword}. Se muestra una sola vez: entrégasela al cobrador, que deberá cambiarla al entrar.`;

export function CreateCollectorForm() {
  return (
    <CommandForm<Credentials>
      title="Nuevo cobrador"
      url="/api/negocio/cobradores"
      openLabel="Nuevo cobrador"
      description="Se crea su cuenta con una contraseña temporal que verás una sola vez."
      fields={[
        { kind: "text", name: "name", label: "Nombre", required: true, maxLength: 120 },
        {
          kind: "text",
          name: "username",
          label: "Usuario",
          required: true,
          hint: "Minúsculas sin acentos, dígitos, punto, guion o guion bajo (3 a 32).",
        },
      ]}
      submitLabel="Crear cobrador"
      loadingText="Creando…"
      successMessage={(data) => credentialsMessage("Cobrador creado", data)}
    />
  );
}

export function CollectorActions({
  collectorId,
  name,
  active,
}: {
  collectorId: string;
  name: string;
  active: boolean;
}) {
  const base = `/api/negocio/cobradores/${collectorId}`;
  return (
    <div className="flex flex-wrap gap-2">
      {active ? (
        <>
          <ConfirmAction<Credentials>
            url={`${base}/restablecer`}
            label="Restablecer contraseña"
            warning={`Se generará una contraseña temporal nueva para ${name} y se cerrarán sus sesiones.`}
            confirmLabel="Restablecer"
            loadingText="Restableciendo…"
            successMessage={(data) => credentialsMessage("Contraseña restablecida", data)}
          />
          <ConfirmAction<{ collectorId: string }>
            url={`${base}/desactivar`}
            label="Desactivar"
            variant="danger"
            warning={`${name} quedará inactivo y no podrá entrar. Necesita no tener ruta activa ni jornada abierta o pendiente.`}
            confirmLabel="Desactivar cobrador"
            loadingText="Desactivando…"
            successMessage={() => `${name} fue desactivado y su cuenta quedó bloqueada.`}
          />
        </>
      ) : (
        <ConfirmAction<Credentials>
          url={`${base}/reactivar`}
          label="Reactivar"
          warning={`${name} volverá a estar activo (si el plan lo permite) y recibirá una contraseña temporal nueva.`}
          confirmLabel="Reactivar cobrador"
          loadingText="Reactivando…"
          successMessage={(data) => credentialsMessage("Cobrador reactivado", data)}
        />
      )}
    </div>
  );
}
