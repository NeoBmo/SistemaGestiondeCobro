import { interestBpsFromPercent } from "@/shared/money/money";

/** «20», «12,5» o «12.5» → puntos básicos; `null` si no es un porcentaje con a lo más dos decimales. */
export function parsePercent(text: string): number | null {
  const normalized = text.trim().replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null;
  try {
    return interestBpsFromPercent(Number(normalized));
  } catch {
    return null;
  }
}
