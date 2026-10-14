import { z } from "zod";

// Postgres (`text`) rechaza el byte nulo; se prohíbe aquí para dar 400 en vez de un 500 tardío.
const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), `${label} no puede contener el carácter nulo`)
    .pipe(z.string().min(1, `${label} es obligatorio`).max(max));

/** Alta de un cobrador (02 §4.1): su nombre y el usuario con el que entra (ADR 0002). */
export const createCollectorSchema = z.object({
  name: requiredText("El nombre", 120),
  // El formato lo valida `parseUsername`, la misma fuente que el CHECK de la BD.
  username: z.string().trim().min(1, "El usuario es obligatorio").max(64),
});

export const createRouteSchema = z.object({
  collectorId: z.uuid(),
  name: requiredText("El nombre de la ruta", 120),
});

/** Asigna un cliente a una ruta; si ya tenía asignación activa, es una reasignación (02 §4.3). */
export const assignClientSchema = z.object({
  clientId: z.uuid(),
  routeId: z.uuid(),
});

export const collectionsIdSchema = z.uuid();

export type CreateCollectorInput = z.output<typeof createCollectorSchema>;
export type CreateRouteInput = z.output<typeof createRouteSchema>;
export type AssignClientInput = z.output<typeof assignClientSchema>;
