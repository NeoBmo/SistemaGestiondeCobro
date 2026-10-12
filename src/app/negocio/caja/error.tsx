"use client";

import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Fallo inesperado al cargar la Caja Mayor: mensaje para el rol, sin detalles técnicos. */
export default function CajaMayorError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error" title="No se pudo cargar la Caja Mayor">
        Es un problema temporal. Tu saldo no cambió. Intenta de nuevo; si continúa, avisa a soporte.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
