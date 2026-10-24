import { isIP } from "node:net";

/**
 * IP del cliente para el límite de intentos de login (02-DOMINIO §1.4). Solo es fiable detrás de Vercel:
 * la plataforma sobrescribe `x-forwarded-for` con la IP que abrió la conexión y descarta la que mande el
 * cliente (documentado como defensa contra la suplantación de IP). Fuera de Vercel (local, CI) esa cabecera
 * la escribe quien llama, así que se ignora: sin IP fiable no hay límite por IP, pero sí por usuario.
 */
export function clientIp(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (env.VERCEL !== "1") return null;
  const first = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "";
  return isIP(first) ? first : null;
}
