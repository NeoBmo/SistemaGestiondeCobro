import { AppError } from "../errors/app-error";

/**
 * Fecha calendario sin hora (`YYYY-MM-DD`), p. ej. el vencimiento de una cuota.
 * Los instantes (pagos, movimientos) son `Date` en UTC; solo se convierten a fecha local
 * de la zona del negocio para decidir «hoy» o para mostrarse (03-ARQUITECTURA §3).
 */
declare const isoDateBrand: unique symbol;
export type IsoDate = string & { readonly [isoDateBrand]: true };

const MS_PER_DAY = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function invalidDate(value: string): never {
  throw new AppError(
    "INVALID_DATE",
    `Fecha inválida: se esperaba YYYY-MM-DD real, llegó "${value}"`,
  );
}

function utcMs(value: IsoDate): number {
  const [year = 0, month = 1, day = 1] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getTime();
}

export function isoDate(value: string): IsoDate {
  const match = ISO_DATE.exec(value);
  if (!match) invalidDate(value);
  const candidate = value as IsoDate;
  const round = new Date(utcMs(candidate)).toISOString().slice(0, 10);
  if (round !== value) invalidDate(value);
  return candidate;
}

/** Días completos de `from` a `to` (negativo si `to` es anterior). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return Math.round((utcMs(to) - utcMs(from)) / MS_PER_DAY);
}

function partsIn(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(instant);
  } catch {
    throw new AppError("INVALID_TIME_ZONE", `Zona horaria inválida: ${timeZone}`);
  }
}

function part(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string {
  const value = parts.find((p) => p.type === type)?.value;
  if (!value) throw new AppError("INVALID_DATE", `No se pudo obtener ${type} de la fecha`, 500);
  return value;
}

/** Fecha calendario que rige en `timeZone` en el instante dado (p. ej. «hoy» del negocio). */
export function localDateIn(instant: Date, timeZone: string): IsoDate {
  const parts = partsIn(instant, timeZone, { year: "numeric", month: "2-digit", day: "2-digit" });
  return isoDate(`${part(parts, "year")}-${part(parts, "month")}-${part(parts, "day")}`);
}

/** `dd/mm/aaaa hh:mm` en la zona del negocio. */
export function formatDateTimeInZone(instant: Date, timeZone: string): string {
  const parts = partsIn(instant, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const date = `${part(parts, "day")}/${part(parts, "month")}/${part(parts, "year")}`;
  return `${date} ${part(parts, "hour")}:${part(parts, "minute")}`;
}
