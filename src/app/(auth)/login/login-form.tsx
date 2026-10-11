"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { PASSWORD_CHANGE_PATH, homePathFor } from "@/modules/identity/page-access";
import type { Role } from "@/modules/identity/session";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";

type LoginData = { userId: string; role: Role; mustChangePassword: boolean };

/** `notice`: motivo por el que una sesión anterior ya no sirve (usuario bloqueado, negocio suspendido…). */
export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const { state, run } = useCommand<LoginData>("/api/auth/login");
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading" || state.status === "success";

  // Tras un fallo el botón se vuelve a habilitar pero el foco ya se perdió: se lleva al mensaje.
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await run({
      username: String(form.get("username") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    if (result.status === "success") {
      router.replace(
        result.data.mustChangePassword ? PASSWORD_CHANGE_PATH : homePathFor(result.data.role),
      );
      router.refresh();
    }
  }

  return (
    // `method="post"`: si se envía antes de hidratar, las credenciales nunca viajan en la URL.
    <form
      method="post"
      onSubmit={onSubmit}
      className="mt-6 flex flex-col gap-4"
      aria-label="Inicio de sesión"
    >
      {notice ? <Alert variant="warning">{notice}</Alert> : null}

      <TextField
        label="Usuario"
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        required
        readOnly={busy}
      />
      <div className="flex flex-col gap-2">
        <TextField
          label="Contraseña"
          name="password"
          type={showPassword ? "text" : "password"}
          autoComplete="current-password"
          required
          readOnly={busy}
        />
        <Button
          variant="secondary"
          aria-pressed={showPassword}
          onClick={() => setShowPassword((value) => !value)}
          className="self-start"
        >
          Mostrar contraseña
        </Button>
      </div>

      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      {/* Región viva siempre montada: los lectores de pantalla anuncian lo que aparece dentro. */}
      <div aria-live="polite">
        {state.status === "success" ? (
          <Alert variant="success" announce={false}>
            Ingresando…
          </Alert>
        ) : null}
      </div>

      <Button type="submit" loading={busy} loadingText="Ingresando…">
        Iniciar sesión
      </Button>
    </form>
  );
}
