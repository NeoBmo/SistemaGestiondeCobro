"use client";

import { useState } from "react";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";

/**
 * Contraseña temporal: el servidor no la guarda, así que esta es la única vez que se ve. Se deja
 * seleccionable y con botón de copiar; si el portapapeles no está disponible se indica que la copien a mano.
 */
export function TemporaryPasswordNotice({
  username,
  password,
}: {
  username: string;
  password: string;
}) {
  const [copy, setCopy] = useState<"idle" | "done" | "failed">("idle");

  async function copyPassword() {
    try {
      await navigator.clipboard.writeText(password);
      setCopy("done");
    } catch {
      setCopy("failed");
    }
  }

  return (
    <Alert variant="warning" title="Anota esta contraseña temporal: no se vuelve a mostrar">
      <p>
        Entrégasela a <span className="font-medium">{username}</span>; deberá cambiarla en su primer
        ingreso.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <code
          data-testid="temporary-password"
          className="bg-background border-border rounded-lg border px-3 py-2 font-mono text-base break-all select-all"
        >
          {password}
        </code>
        <Button variant="secondary" onClick={copyPassword}>
          Copiar
        </Button>
        <span role="status" className="text-sm">
          {copy === "done" ? "Copiada." : null}
          {copy === "failed" ? "No se pudo copiar: selecciónala y cópiala a mano." : null}
        </span>
      </div>
    </Alert>
  );
}
