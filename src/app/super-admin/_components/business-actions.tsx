"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type { LifecycleResult } from "@/modules/subscriptions/lifecycle";
import { PLAN_CATALOG } from "@/modules/subscriptions/plan-catalog";
import type { PlanCode } from "@/modules/subscriptions/plans";
import { STATUS_PRESENTATION } from "@/modules/subscriptions/status-presentation";
import type { StoredSubscriptionStatus } from "@/modules/subscriptions/subscription-status";
import { formatIsoDate } from "@/shared/dates/dates";
import { Alert } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { SelectField } from "@/shared/ui/select-field";
import { TextAreaField } from "@/shared/ui/text-area-field";
import { useCommand } from "@/shared/ui/use-command";
import { TemporaryPasswordNotice } from "./temporary-password-notice";

type ResetResult = { businessId: string; admin: { username: string }; temporaryPassword: string };

type Props = {
  businessId: string;
  /** Estado de la suscripción vigente; `null` si el negocio está archivado. */
  currentStatus: StoredSubscriptionStatus | null;
  currentPlan: PlanCode | null;
  adminUsername: string | null;
};

type Feedback =
  { kind: "message"; text: string } | { kind: "password"; username: string; password: string };

/**
 * Acciones sobre un negocio. Ninguna lleva clave de idempotencia (no son comandos financieros), así que
 * cada botón se deshabilita mientras su operación está en curso y las destructivas piden confirmar.
 * El resultado verificable (estado y vencimiento que devolvió el servidor) se anuncia aquí; el estado
 * de la ficha se actualiza con `router.refresh()`.
 */
export function BusinessActions({ businessId, currentStatus, currentPlan, adminUsername }: Props) {
  const router = useRouter();
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const base = `/api/super-admin/businesses/${businessId}`;

  const done = (next: Feedback) => {
    setFeedback(next);
    router.refresh();
  };
  const lifecycleDone = (verb: string) => (data: LifecycleResult) =>
    done({
      kind: "message",
      text: `${verb}. Acceso ${data.accessStatus === "ACTIVO" ? "activo" : "suspendido"}; suscripción ${STATUS_PRESENTATION[data.subscription.status].label.toLowerCase()}, plan ${planName(data.subscription.planCode)}, vence el ${formatIsoDate(data.subscription.expiresOn)}.`,
    });

  return (
    <section aria-labelledby="acciones" className="mt-8">
      <h2 id="acciones" className="text-xl font-semibold">
        Acciones
      </h2>

      {/* Región viva siempre montada: los lectores de pantalla anuncian lo que aparece dentro. */}
      <div aria-live="polite" className="mt-3 flex flex-col gap-3">
        {feedback?.kind === "message" ? (
          <Alert variant="success" announce={false}>
            {feedback.text}
          </Alert>
        ) : null}
        {feedback?.kind === "password" ? (
          <>
            <Alert variant="success" announce={false}>
              Contraseña restablecida y sesiones del administrador cerradas.
            </Alert>
            <TemporaryPasswordNotice username={feedback.username} password={feedback.password} />
          </>
        ) : null}
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {currentStatus === "ACTIVA" ? (
          <ActionForm<LifecycleResult>
            url={`${base}/suspend`}
            title="Suspender"
            description="Bloquea el acceso de todo el negocio hasta que lo actives. Sus datos no se tocan."
            submitLabel="Suspender negocio"
            variant="danger"
            confirmText="Todos los usuarios del negocio perderán el acceso. ¿Confirmas?"
            fields="note"
            onDone={lifecycleDone("Negocio suspendido")}
          />
        ) : null}
        {currentStatus === "SUSPENDIDA" ? (
          <ActionForm<LifecycleResult>
            url={`${base}/activate`}
            title="Activar"
            description="Devuelve el acceso al negocio."
            submitLabel="Activar negocio"
            fields="note"
            onDone={lifecycleDone("Negocio activado")}
          />
        ) : null}
        {currentStatus !== null ? (
          <ActionForm<LifecycleResult>
            url={`${base}/plan`}
            title="Cambiar de plan"
            description="Pasa a otro plan con una suscripción nueva desde hoy."
            submitLabel="Cambiar plan"
            fields="plan"
            excludePlan={currentPlan}
            onDone={lifecycleDone("Plan cambiado")}
          />
        ) : null}
        {currentStatus !== null ? (
          <ActionForm<LifecycleResult>
            url={`${base}/archive`}
            title="Archivar"
            description="Da de baja al negocio. Su historial se conserva y puede volver con una re-suscripción."
            submitLabel="Archivar negocio"
            variant="danger"
            confirmText="El negocio quedará sin acceso. ¿Confirmas?"
            fields="reason"
            onDone={lifecycleDone("Negocio archivado")}
          />
        ) : (
          <ActionForm<LifecycleResult>
            url={`${base}/resubscribe`}
            title="Re-suscribir"
            description="El negocio vuelve con una suscripción nueva; la archivada queda como historial."
            submitLabel="Re-suscribir negocio"
            fields="plan"
            onDone={lifecycleDone("Negocio re-suscrito")}
          />
        )}
        {adminUsername ? (
          <ActionForm<ResetResult>
            url={`${base}/admin-password`}
            title="Restablecer contraseña del administrador"
            description={`Genera una contraseña temporal para ${adminUsername} y cierra sus sesiones abiertas.`}
            submitLabel="Restablecer contraseña"
            variant="danger"
            confirmText="La contraseña actual dejará de servir. ¿Confirmas?"
            fields="none"
            onDone={(data) =>
              done({
                kind: "password",
                username: data.admin.username,
                password: data.temporaryPassword,
              })
            }
          />
        ) : null}
      </div>
    </section>
  );
}

const planName = (code: PlanCode) => PLAN_CATALOG.find((plan) => plan.code === code)?.name ?? code;

type FormProps<T> = {
  url: string;
  title: string;
  description: string;
  submitLabel: string;
  variant?: "primary" | "danger";
  /** Si existe, el primer envío pide confirmación y el segundo ejecuta. */
  confirmText?: string;
  fields: "none" | "note" | "reason" | "plan";
  /** En «cambiar de plan» el plan vigente no es una opción. */
  excludePlan?: PlanCode | null;
  onDone: (data: T) => void;
};

function ActionForm<T>({
  url,
  title,
  description,
  submitLabel,
  variant = "primary",
  confirmText,
  fields,
  excludePlan,
  onDone,
}: FormProps<T>) {
  const { state, run, reset } = useCommand<T>(url);
  const [armed, setArmed] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  // Cerrojo síncrono: el botón deshabilitado depende de un re-render, y un doble envío muy rápido (doble
  // clic, Enter repetido) podría llegar antes. Restablecer no tiene clave de idempotencia: repetirlo emite
  // otra contraseña temporal.
  const inFlight = useRef(false);
  const busy = state.status === "loading";

  const planOptions = PLAN_CATALOG.filter((plan) => plan.code !== excludePlan).map((plan) => ({
    value: plan.code,
    label: plan.name,
  }));

  // Tras un fallo el botón se vuelve a habilitar pero el foco ya se perdió: se lleva al mensaje.
  useEffect(() => {
    if (state.status === "error") errorRef.current?.focus();
  }, [state.status]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (inFlight.current) return;
    if (confirmText && !armed) {
      setArmed(true);
      return;
    }
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const note = String(form.get("note") ?? "").trim() || undefined;
    const body =
      fields === "reason"
        ? { reason: String(form.get("reason") ?? "") }
        : fields === "plan"
          ? { planCode: String(form.get("planCode") ?? ""), note }
          : fields === "note"
            ? { note }
            : {};
    inFlight.current = true;
    let result: Awaited<ReturnType<typeof run>>;
    try {
      result = await run(body);
    } finally {
      inFlight.current = false;
    }
    setArmed(false);
    if (result.status === "success") {
      formElement.reset();
      onDone(result.data);
      // La contraseña temporal (si la hay) queda solo en el aviso del padre, no en el estado del formulario.
      reset();
    }
  }

  const headingId = `accion-${url.split("/").slice(-1)[0]}`;

  return (
    <form
      method="post"
      onSubmit={onSubmit}
      aria-labelledby={headingId}
      className="border-border flex flex-col gap-3 rounded-lg border p-4"
    >
      <h3 id={headingId} className="text-lg font-medium">
        {title}
      </h3>
      <p className="text-muted text-sm">{description}</p>

      {fields === "plan" ? (
        <SelectField label="Plan" name="planCode" options={planOptions} disabled={busy} />
      ) : null}
      {fields === "reason" ? (
        <TextAreaField
          label="Motivo"
          name="reason"
          required
          maxLength={500}
          readOnly={busy}
          hint="Obligatorio: queda en el historial del negocio."
        />
      ) : null}
      {fields === "note" || fields === "plan" ? (
        <TextAreaField
          label="Observación"
          name="note"
          maxLength={500}
          readOnly={busy}
          hint="Opcional."
        />
      ) : null}

      {armed ? <Alert variant="warning">{confirmText}</Alert> : null}
      {state.status === "error" ? (
        <Alert variant="error" ref={errorRef}>
          {state.error.message}
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" variant={variant} loading={busy} loadingText="Procesando…">
          {armed ? `Sí, ${submitLabel.toLowerCase()}` : submitLabel}
        </Button>
        {armed && !busy ? (
          <Button variant="secondary" onClick={() => setArmed(false)}>
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
