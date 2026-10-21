import type { ButtonHTMLAttributes, Ref } from "react";
import { Spinner } from "./spinner";

type Variant = "primary" | "secondary" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "border-transparent bg-primary text-primary-foreground hover:bg-primary-hover",
  secondary: "border-border-strong bg-surface text-foreground hover:bg-surface-2",
  danger: "border-transparent bg-danger text-danger-foreground hover:opacity-90",
};

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  /** Operación en curso: deshabilita el botón (evita el doble envío) y avisa a los lectores de pantalla. */
  loading?: boolean;
  /** Texto mientras `loading` (por defecto, el mismo). */
  loadingText?: string;
  /** Para devolver el foco al botón (React 19: `ref` es una propiedad más). */
  ref?: Ref<HTMLButtonElement>;
};

/** Objetivo táctil mínimo de 44×44 px (frontend-design §1) y foco visible global (globals.css). */
export function Button({
  variant = "primary",
  loading = false,
  loadingText,
  children,
  className = "",
  disabled,
  type = "button",
  ...props
}: Props) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border px-4 py-2 text-base font-medium transition-[opacity,transform] duration-150 ease-out active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading ? (
        <>
          <Spinner decorative />
          <span>{loadingText ?? children}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
