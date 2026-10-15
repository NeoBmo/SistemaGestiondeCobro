import { addDays, isoDate, type IsoDate } from "@/shared/dates/dates";

/**
 * Periodos del dashboard (ADR 0010). Terminan «hoy» en la zona horaria del negocio e incluyen ese día:
 * los 7 y 30 días son móviles; el mes y el año son calendario hasta hoy.
 */
export const PERIODS = ["7D", "30D", "MONTH", "YEAR"] as const;
export type Period = (typeof PERIODS)[number];

export const PERIOD_LABEL: Record<Period, string> = {
  "7D": "Últimos 7 días",
  "30D": "Últimos 30 días",
  MONTH: "Este mes",
  YEAR: "Este año",
};

export function isPeriod(value: unknown): value is Period {
  return typeof value === "string" && (PERIODS as readonly string[]).includes(value);
}

export function periodRange(period: Period, today: IsoDate): { from: IsoDate; to: IsoDate } {
  switch (period) {
    case "7D":
      return { from: addDays(today, -6), to: today };
    case "30D":
      return { from: addDays(today, -29), to: today };
    case "MONTH":
      return { from: isoDate(`${today.slice(0, 7)}-01`), to: today };
    case "YEAR":
      return { from: isoDate(`${today.slice(0, 4)}-01-01`), to: today };
  }
}
