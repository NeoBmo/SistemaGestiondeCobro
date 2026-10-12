"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type FormEvent } from "react";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { TextField } from "@/shared/ui/text-field";
import { useCommand } from "@/shared/ui/use-command";

type ClientValues = {
  name: string;
  nickname: string;
  identification: string;
  address: string;
  phone: string;
  whatsapp: string;
  notes: string;
};

type Props = { mode: "create" } | { mode: "edit"; clientId: string; initial: ClientValues };

/**
 * Formulario de cliente. En alta pide la identificación (única por negocio, no se cambia después); en
 * edición la muestra de solo lectura y envía solo el contacto (02 §2.1). Mismo formulario para ambos
 * para que los campos, las ayudas y los errores sean idénticos.
 */
export function ClientForm(props: Props) {
  const router = useRouter();
  const create = useCommand<{ id: string }>("/api/negocio/clientes");
  const update = useCommand<{ changed: string[] }>(
    props.mode === "edit" ? `/api/negocio/clientes/${props.clientId}` : "/api/negocio/clientes",
  );
  const { state, run } = props.mode === "create" ? create : update;
  const errorRef = useRef<HTMLDivElement>(null);
  const busy = state.status === "loading";
  const initial = props.mode === "edit" ? props.initial : undefined;

  // Tras un fallo el botón se vuelve a habilitar pero el foco ya se perdió: se lleva al mensaje.
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "");
    const contact = {
      name: text("name"),
      nickname: text("nickname"),
      address: text("address"),
      phone: text("phone"),
      whatsapp: text("whatsapp"),
      notes: text("notes"),
    };
    const result = await run(
      props.mode === "create" ? { ...contact, identification: text("identification") } : contact,
    );
    if (result.status !== "success") return;
    if (props.mode === "create") {
      router.push(`/negocio/clientes/${(result.data as { id: string }).id}`);
    } else {
      router.refresh();
    }
  }

  return (
    // `method="post"`: si se envía antes de hidratar, los datos nunca viajan en la URL.
    <form
      method="post"
      onSubmit={onSubmit}
      className="mt-4 flex max-w-xl flex-col gap-4"
      aria-label={props.mode === "create" ? "Nuevo cliente" : "Editar contacto"}
    >
      <TextField
        label="Nombre"
        name="name"
        required
        maxLength={120}
        defaultValue={initial?.name}
        readOnly={busy}
      />
      <TextField
        label="Sobrenombre"
        name="nickname"
        maxLength={120}
        defaultValue={initial?.nickname}
        readOnly={busy}
        hint="Opcional. Cómo se le conoce en la calle."
      />
      {props.mode === "create" ? (
        <TextField
          label="Identificación"
          name="identification"
          required
          maxLength={40}
          readOnly={busy}
          autoComplete="off"
          hint="Única en tu negocio. No se puede cambiar después."
        />
      ) : (
        <div className="flex flex-col gap-1">
          <p className="text-base font-medium">Identificación</p>
          <p className="font-mono break-all">{initial?.identification}</p>
          <p className="text-muted text-sm">La identificación no se puede cambiar.</p>
        </div>
      )}
      <TextField
        label="Dirección"
        name="address"
        maxLength={300}
        defaultValue={initial?.address}
        readOnly={busy}
      />
      <TextField
        label="Teléfono"
        name="phone"
        type="tel"
        maxLength={30}
        defaultValue={initial?.phone}
        readOnly={busy}
      />
      <TextField
        label="WhatsApp"
        name="whatsapp"
        type="tel"
        maxLength={30}
        defaultValue={initial?.whatsapp}
        readOnly={busy}
        hint="Opcional. Si es el mismo del teléfono, repítelo."
      />
      <TextAreaField
        label="Notas"
        name="notes"
        maxLength={1000}
        defaultValue={initial?.notes}
        readOnly={busy}
        hint="Opcional."
      />

      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}
      {/* Región viva siempre montada: los lectores de pantalla anuncian lo que aparece dentro. */}
      <div aria-live="polite">
        {state.status === "success" && props.mode === "edit" ? (
          <Alert variant="success" announce={false}>
            {(state.data as { changed: string[] }).changed.length > 0
              ? "Contacto actualizado."
              : "No había cambios que guardar."}
          </Alert>
        ) : null}
      </div>

      <Button type="submit" loading={busy} loadingText="Guardando…" className="self-start">
        {props.mode === "create" ? "Crear cliente" : "Guardar cambios"}
      </Button>
    </form>
  );
}
