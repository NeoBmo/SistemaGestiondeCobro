"use client";

import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Fallo inesperado al cargar el panel: mensaje para el rol, sin detalles técnicos. */
export default function SuperAdminError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error" title="No se pudo cargar esta pantalla">
        Es un problema temporal. Intenta de nuevo; si continúa, avisa al equipo técnico.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
