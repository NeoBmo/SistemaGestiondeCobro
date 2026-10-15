"use client";

import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Fallo inesperado al cargar la ruta: mensaje para el cobrador, sin detalles técnicos. */
export default function CobradorError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error" title="No se pudo cargar tu ruta">
        Es un problema temporal. Lo que ya registraste está a salvo. Intenta de nuevo.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
