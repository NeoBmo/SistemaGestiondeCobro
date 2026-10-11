/**
 * Indicador de carga simple (frontend-design §3 y §5): nunca sugiere progreso falso. `prefers-reduced-motion`
 * lo deja quieto (globals.css), así que el texto accesible es lo que comunica el estado.
 *
 * `decorative`: cuando el elemento que lo contiene ya anuncia la espera (un botón con `aria-busy` y su
 * texto de carga), el spinner no debe ser además una región `status` que duplique el anuncio.
 */
export function Spinner({
  label = "Cargando",
  decorative = false,
}: {
  label?: string;
  decorative?: boolean;
}) {
  const circle = (
    <span
      aria-hidden="true"
      className="inline-block size-4 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
  if (decorative) return circle;
  return (
    <span role="status" className="inline-flex items-center gap-2">
      {circle}
      <span className="sr-only">{label}</span>
    </span>
  );
}
