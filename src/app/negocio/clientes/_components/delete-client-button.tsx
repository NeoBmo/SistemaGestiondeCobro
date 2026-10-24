"use client";

import { CashFeedbackProvider } from "../../_components/cash-feedback";
import { ConfirmAction } from "../../_components/confirm-action";

/**
 * Eliminar un cliente sin historial (02 §2.1). Es componente cliente porque `ConfirmAction` recibe
 * funciones (`successMessage`), que un Server Component no puede pasar. Tras el éxito lleva a la lista,
 * donde se confirma la eliminación: la ficha ya no existe.
 */
export function DeleteClientButton({ clientId, name }: { clientId: string; name: string }) {
  return (
    <CashFeedbackProvider>
      <ConfirmAction<{ clientId: string }>
        url={`/api/negocio/clientes/${clientId}/eliminar`}
        label="Eliminar cliente"
        variant="danger"
        warning={`Se eliminarán ${name} y todos sus datos de contacto. No se puede deshacer.`}
        confirmLabel="Eliminar definitivamente"
        loadingText="Eliminando…"
        successMessage={() => `${name} fue eliminado.`}
        redirectTo="/negocio/clientes?eliminado=1"
      />
    </CashFeedbackProvider>
  );
}
