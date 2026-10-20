import { useId, type InputHTMLAttributes } from "react";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "id"> & {
  label: string;
  name: string;
  hint?: string;
  error?: string;
};

/** Campo con `label` asociado, ayuda y error enlazados por `aria-describedby` (frontend-design §2). */
export function TextField({ label, hint, error, className = "", ...input }: Props) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-base font-medium">
        {label}
        {input.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {hint ? (
        <p id={hintId} className="text-muted text-sm">
          {hint}
        </p>
      ) : null}
      <input
        {...input}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
        className={`border-border-strong bg-surface min-h-11 rounded-lg border px-3 text-base ${error ? "border-danger" : ""} ${className}`}
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
