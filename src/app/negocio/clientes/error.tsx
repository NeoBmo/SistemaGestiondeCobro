"use client";

import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Fallo inesperado al cargar los clientes: mensaje para el rol, sin detalles técnicos. */
export default function ClientsError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error" title="No se pudieron cargar los clientes">
        Es un problema temporal. Tus datos no cambiaron. Intenta de nuevo; si continúa, avisa a
        soporte.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
