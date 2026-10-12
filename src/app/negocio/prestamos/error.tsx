"use client";

import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/** Fallo inesperado al cargar un préstamo: mensaje para el rol, sin detalles técnicos. */
export default function LoansError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="error" title="No se pudo cargar el préstamo">
        Es un problema temporal. Tus datos y tu caja no cambiaron. Intenta de nuevo; si continúa,
        avisa a soporte.
      </Alert>
      <Button variant="secondary" onClick={reset}>
        Reintentar
      </Button>
    </div>
  );
}
