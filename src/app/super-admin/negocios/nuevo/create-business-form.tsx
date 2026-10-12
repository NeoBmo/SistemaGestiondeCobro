"use client";

import Link from "next/link";
import { useEffect, useRef, type FormEvent } from "react";
import type { CreateBusinessResult } from "@/modules/subscriptions/create-business";
import { PLAN_CATALOG } from "@/modules/subscriptions/plan-catalog";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { SelectField } from "@/shared/ui/select-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";
import { TemporaryPasswordNotice } from "../../_components/temporary-password-notice";

const PLAN_OPTIONS = PLAN_CATALOG.map((plan) => ({ value: plan.code, label: plan.name }));

export function CreateBusinessForm() {
  const { state, run, reset } = useCommand<CreateBusinessResult>("/api/super-admin/businesses");
  const errorRef = useRef<HTMLDivElement>(null);
  const successRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading";

  // Tras un fallo el botón se vuelve a habilitar pero el foco ya se perdió: se lleva al mensaje.
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
    // El formulario se desmonta al terminar: el foco pasa al resultado para no perderse en el body.
    if (state.status === "success") successRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const optional = (name: string) => text(name).trim() || undefined;
    await run({
      name: text("name"),
      ownerName: text("ownerName"),
      ownerIdentification: text("ownerIdentification"),
      phone: text("phone"),
      planCode: text("planCode"),
      timeZone: optional("timeZone"),
      adminUsername: text("adminUsername"),
      adminDisplayName: optional("adminDisplayName"),
    });
  }

  if (state.status === "success") {
    const { businessId, admin, temporaryPassword } = state.data;
    return (
      <div className="mt-6 flex flex-col gap-4">
        <Alert variant="success" title="Negocio creado" ref={successRef}>
          La suscripción quedó activa y la cuenta administrativa{" "}
          <span className="font-medium">{admin.username}</span> está pendiente de cambiar su
          contraseña.
        </Alert>
        <TemporaryPasswordNotice username={admin.username} password={temporaryPassword} />
        <div className="flex flex-wrap gap-3">
          <Link
            href={`/super-admin/negocios/${businessId}`}
            className="bg-primary text-primary-foreground inline-flex min-h-11 items-center rounded-lg px-4 font-medium"
          >
            Ver el negocio
          </Link>
          <Button variant="secondary" onClick={reset}>
            Crear otro negocio
          </Button>
        </div>
      </div>
    );
  }

  return (
    // `method="post"`: si se envía antes de hidratar, los datos nunca viajan en la URL.
    <form
      method="post"
      onSubmit={onSubmit}
      className="mt-6 flex max-w-xl flex-col gap-4"
      aria-label="Crear negocio"
    >
      <fieldset className="flex flex-col gap-4" disabled={busy}>
        <legend className="mb-2 text-xl font-semibold">Negocio</legend>
        <TextField label="Nombre del negocio" name="name" required maxLength={120} />
        <TextField label="Nombre del responsable" name="ownerName" required maxLength={120} />
        <TextField
          label="Identificación del responsable"
          name="ownerIdentification"
          required
          maxLength={40}
        />
        <TextField label="Teléfono" name="phone" type="tel" required maxLength={30} />
        <SelectField label="Plan" name="planCode" options={PLAN_OPTIONS} defaultValue="MENSUAL" />
        <TextField
          label="Zona horaria"
          name="timeZone"
          maxLength={64}
          placeholder="America/Bogota"
          hint="Opcional. Si la dejas vacía se usa America/Bogota."
          autoCapitalize="none"
          spellCheck={false}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4" disabled={busy}>
        <legend className="mb-2 text-xl font-semibold">Cuenta administrativa</legend>
        <TextField
          label="Usuario del administrador"
          name="adminUsername"
          required
          maxLength={64}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          hint="De 3 a 32 caracteres: letras minúsculas, números, punto, guion y guion bajo."
        />
        <TextField
          label="Nombre del administrador"
          name="adminDisplayName"
          maxLength={120}
          hint="Opcional. Si lo dejas vacío se usa el nombre del responsable."
        />
      </fieldset>

      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}

      <Button type="submit" loading={busy} loadingText="Creando…" className="self-start">
        Crear negocio
      </Button>
    </form>
  );
}
