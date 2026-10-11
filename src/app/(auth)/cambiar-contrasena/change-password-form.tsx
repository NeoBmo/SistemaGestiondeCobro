"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { passwordIssues, type PasswordIssue } from "@/modules/identity/password-policy";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";

const RULES: { issue: PasswordIssue; text: string }[] = [
  { issue: "TOO_SHORT", text: "Al menos 8 caracteres" },
  { issue: "NEEDS_LETTER", text: "Al menos una letra" },
  { issue: "NEEDS_DIGIT", text: "Al menos un dígito" },
];

const RULES_ID = "requisitos-contrasena";

export function ChangePasswordForm({ homePath }: { homePath: string }) {
  const router = useRouter();
  const { state, run } = useCommand("/api/auth/password");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  // El aviso de «no coinciden» aparece al salir del campo (o al intentar enviar), no en cada pulsación.
  const [confirmationTouched, setConfirmationTouched] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading" || state.status === "success";

  const issues = passwordIssues(password);
  const tooLong = issues.includes("TOO_LONG");
  const mismatch = confirmationTouched && confirmation.length > 0 && confirmation !== password;
  const canSubmit = password.length > 0 && issues.length === 0 && confirmation === password;

  // Tras un fallo el botón se vuelve a habilitar pero el foco ya se perdió: se lleva al mensaje.
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setConfirmationTouched(true);
    if (!canSubmit) return;
    const result = await run({ newPassword: password });
    if (result.status === "success") {
      router.replace(homePath);
      router.refresh();
    }
  }

  return (
    // `method="post"`: si se envía antes de hidratar, la contraseña nunca viaja en la URL.
    <form
      method="post"
      onSubmit={onSubmit}
      className="mt-6 flex flex-col gap-4"
      aria-label="Cambio de contraseña"
    >
      <TextField
        label="Nueva contraseña"
        name="newPassword"
        type="password"
        autoComplete="new-password"
        required
        readOnly={busy}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={tooLong ? "La contraseña es demasiado larga (máximo 72 bytes)." : undefined}
      />
      <ul
        id={RULES_ID}
        aria-label="Requisitos de la contraseña"
        className="flex flex-col gap-1 text-sm"
      >
        {RULES.map(({ issue, text }) => {
          const met = password.length > 0 && !issues.includes(issue);
          return (
            <li key={issue} className={met ? "text-success" : "text-muted"}>
              <span aria-hidden="true">{met ? "✓ " : "○ "}</span>
              {text}
              <span className="sr-only">{met ? " (cumplido)" : " (pendiente)"}</span>
            </li>
          );
        })}
      </ul>

      <TextField
        label="Repite la nueva contraseña"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
        readOnly={busy}
        value={confirmation}
        onChange={(event) => setConfirmation(event.target.value)}
        onBlur={() => setConfirmationTouched(true)}
        error={mismatch ? "Las contraseñas no coinciden." : undefined}
      />

      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      {/* Región viva siempre montada: los lectores de pantalla anuncian lo que aparece dentro. */}
      <div aria-live="polite">
        {state.status === "success" ? (
          <Alert variant="success" announce={false}>
            Contraseña cambiada. Entrando a tu área…
          </Alert>
        ) : null}
      </div>

      <Button
        type="submit"
        loading={busy}
        loadingText="Guardando…"
        disabled={!canSubmit}
        aria-describedby={RULES_ID}
      >
        Cambiar contraseña
      </Button>
    </form>
  );
}
