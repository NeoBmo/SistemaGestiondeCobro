"use client";

import { CommandForm } from "../../_components/command-form";
import { ConfirmAction } from "../../_components/confirm-action";

export function CreateRouteForm({ collectors }: { collectors: { id: string; name: string }[] }) {
  return (
    <CommandForm<{ name: string }>
      title="Nueva ruta"
      url="/api/negocio/rutas"
      openLabel="Nueva ruta"
      description="Cada cobrador activo tiene a lo sumo una ruta activa."
      fields={[
        {
          kind: "select",
          name: "collectorId",
          label: "Cobrador",
          options: collectors.map((c) => ({ value: c.id, label: c.name })),
        },
        { kind: "text", name: "name", label: "Nombre de la ruta", required: true, maxLength: 120 },
      ]}
      submitLabel="Crear ruta"
      loadingText="Creando…"
      successMessage={(data) => `Ruta «${data.name}» creada.`}
    />
  );
}

export function CloseRouteButton({ routeId, name }: { routeId: string; name: string }) {
  return (
    <ConfirmAction<{ routeId: string }>
      url={`/api/negocio/rutas/${routeId}/cerrar`}
      label="Cerrar ruta"
      variant="danger"
      warning={`La ruta «${name}» se cerrará y no se podrá reabrir. No debe tener clientes asignados.`}
      confirmLabel="Cerrar ruta"
      loadingText="Cerrando…"
      successMessage={() => `Ruta «${name}» cerrada.`}
    />
  );
}

export function AssignClientForm({
  clientId,
  routes,
  currentRouteId,
}: {
  clientId: string;
  routes: { id: string; name: string; collectorName: string }[];
  currentRouteId: string | null;
}) {
  const options = routes
    .filter((route) => route.id !== currentRouteId)
    .map((route) => ({ value: route.id, label: `${route.collectorName} · ${route.name}` }));
  if (options.length === 0) {
    return (
      <p className="text-muted text-sm">
        No hay otras rutas activas: crea una ruta para asignar o reasignar a este cliente.
      </p>
    );
  }
  return (
    <CommandForm<{ reassigned: boolean }>
      title={currentRouteId ? "Reasignar cliente" : "Asignar cliente a una ruta"}
      url="/api/negocio/asignaciones"
      extra={{ clientId }}
      fields={[{ kind: "select", name: "routeId", label: "Ruta", options }]}
      submitLabel={currentRouteId ? "Reasignar" : "Asignar"}
      loadingText="Guardando…"
      successMessage={(data) =>
        data.reassigned
          ? "Cliente reasignado. La asignación anterior quedó cerrada."
          : "Cliente asignado."
      }
    />
  );
}
