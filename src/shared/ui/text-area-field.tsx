import { useId, type TextareaHTMLAttributes } from "react";

type Props = Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "id"> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
};

/** Texto de varias líneas con `label` y ayuda asociadas (mismo contrato que `TextField`). */
export function TextAreaField({ label, hint, error, className = "", ...area }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-base font-medium">
        {label}
        {area.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      ) : null}
      <textarea
        rows={3}
        {...area}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`border-border-strong bg-surface min-h-11 rounded-lg border px-3 py-2 text-base ${error ? "border-danger" : ""} ${className}`}
      />
      {error ? (
        <p id={errorId} aria-live="polite" className="text-danger-strong text-sm">
          <span aria-hidden="true">⚠ </span>
          {error}
        </p>
      ) : null}
    </div>
  );
}
