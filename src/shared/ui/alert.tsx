import type { ReactNode, Ref } from "react";

type Variant = "error" | "success" | "info" | "warning";

// El color nunca es el único portador de significado (frontend-design §6): cada variante lleva ícono y
// un prefijo de texto para lectores de pantalla.
const STYLES: Record<Variant, { box: string; icon: string; label: string }> = {
  error: { box: "border-danger bg-danger-subtle text-danger-strong", icon: "⚠", label: "Error" },
  success: {
    box: "border-success bg-success-subtle text-success-strong",
    icon: "✓",
    label: "Listo",
  },
  warning: {
    box: "border-warning bg-warning-subtle text-warning-strong",
    icon: "!",
    label: "Atención",
  },
  info: { box: "border-border bg-surface text-foreground", icon: "i", label: "Información" },
};

type Props = {
  variant: Variant;
  title?: string;
  children?: ReactNode;
  id?: string;
  /** Para mover el foco al error tras un envío fallido (la alerta recibe `tabIndex={-1}`). */
  ref?: Ref<HTMLDivElement>;
  /** `false` cuando una región `aria-live` siempre montada ya se encarga de anunciar el mensaje. */
  announce?: boolean;
};

/** Los errores se anuncian de inmediato (`alert`); el resto, con cortesía (`status`). */
export function Alert({ variant, title, children, id, ref, announce = true }: Props) {
  const style = STYLES[variant];
  return (
    <div
      id={id}
      ref={ref}
      tabIndex={-1}
      role={announce ? (variant === "error" ? "alert" : "status") : undefined}
      className={`flex gap-3 rounded-lg border p-3 text-sm focus-visible:outline-2 ${style.box}`}
    >
      <span aria-hidden="true" className="font-bold">
        {style.icon}
      </span>
      <div className="flex flex-col gap-1">
        <p className="font-semibold">
          <span className="sr-only">{style.label}: </span>
          {title ?? children}
        </p>
        {title && children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
