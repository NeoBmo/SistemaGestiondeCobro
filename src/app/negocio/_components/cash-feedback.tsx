"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Alert } from "@/shared/ui/alert";

type Feedback = { announce: (message: string) => void; clear: () => void };

const FeedbackContext = createContext<Feedback | null>(null);

/**
 * Resultado verificable de la última operación (frontend-design §5). Vive por encima del historial y de
 * los formularios: al actualizarse el historial un movimiento reversado deja de mostrar su botón y se
 * desmonta, y su mensaje no debe perderse con él.
 */
export function CashFeedbackProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const value: Feedback = { announce: setMessage, clear: () => setMessage(null) };

  return (
    <FeedbackContext value={value}>
      {/* Región viva siempre montada: los lectores de pantalla anuncian lo que aparece dentro. */}
      <div aria-live="polite" className="mt-4">
        {message ? (
          <Alert variant="success" announce={false}>
            {message}
          </Alert>
        ) : null}
      </div>
      {children}
    </FeedbackContext>
  );
}

export function useCashFeedback(): Feedback {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useCashFeedback requiere CashFeedbackProvider");
  return context;
}
