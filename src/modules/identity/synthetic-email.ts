import { parseUsername } from "./username";

/** Email sintético con el que un usuario existe en Supabase Auth (ADR 0002). No recibe correo. */
export function syntheticEmail(username: string, domain: string): string {
  return `${parseUsername(username)}@${domain.trim().toLowerCase()}`;
}
