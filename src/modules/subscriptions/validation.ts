import { z } from "zod";
import { PLAN_CODES } from "./plans";

// Postgres (`text`) rechaza el byte nulo; se prohíbe aquí para dar 400 en vez de un 500 tardío.
const noNullByte = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), `${label} no puede contener el carácter nulo`);

// Límites de longitud generosos; el formato del usuario y la zona horaria se validan en el servicio.
export const createBusinessSchema = z.object({
  name: noNullByte("name").pipe(z.string().min(1).max(120)),
  ownerName: noNullByte("ownerName").pipe(z.string().min(1).max(120)),
  ownerIdentification: noNullByte("ownerIdentification").pipe(z.string().min(1).max(40)),
  phone: noNullByte("phone").pipe(z.string().min(1).max(30)),
  planCode: z.enum(PLAN_CODES),
  timeZone: noNullByte("timeZone").pipe(z.string().min(1).max(64)).optional(),
  adminUsername: z.string().min(1).max(64),
  adminDisplayName: noNullByte("adminDisplayName").pipe(z.string().min(1).max(120)).optional(),
});

// Ciclo de vida (F1-T4). El servicio vuelve a recortar y acotar el texto; aquí se corta lo evidente.
const note = noNullByte("La observación").pipe(z.string().max(500));

export const businessIdSchema = z.uuid();
/** suspender y activar: observación opcional. */
export const noteBodySchema = z.object({ note: note.optional() });
/** archivar: el motivo es obligatorio (02-DOMINIO §1.3). */
export const archiveBodySchema = z.object({
  reason: noNullByte("El motivo").pipe(z.string().min(1).max(500)),
});
/** cambiar de plan y re-suscribir: plan y observación opcional. */
export const planBodySchema = z.object({ planCode: z.enum(PLAN_CODES), note: note.optional() });
