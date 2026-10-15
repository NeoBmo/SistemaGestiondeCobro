"use client";

import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Fallo inesperado al cargar los cobradores: mensaje para el rol, sin detalles técnicos. */
export default function CobradoresError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error" title="No se pudieron cargar los cobradores">
        Es un problema temporal. No se perdió nada. Intenta de nuevo; si continúa, avisa a soporte.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
