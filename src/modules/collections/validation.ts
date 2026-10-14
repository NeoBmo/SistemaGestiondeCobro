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

export const ATTEMPT_REASONS = [
  "CLIENTE_AUSENTE",
  "LUGAR_CERRADO",
  "SIN_DINERO",
  "DIRECCION_INCORRECTA",
  "OTRO",
] as const;

const optionalNote = z
  .string()
  .trim()
  .refine((value) => !value.includes("\0"), "La observación no puede contener el carácter nulo")
  .pipe(z.string().max(500))
  .transform((value) => value || undefined)
  .optional();

/** Intento de cobro (02 §4.4): el fallido nombra su motivo y OTRO exige observación; reintento opcional. */
export const attemptSchema = z
  .object({
    clientId: z.uuid(),
    type: z.enum(["INTENTO_FALLIDO", "VOLVER_A_COBRAR"]),
    reason: z.enum(ATTEMPT_REASONS).optional(),
    note: optionalNote,
    retryAt: z.iso.datetime({ offset: true }).optional(),
  })
  .superRefine((value, context) => {
    if (value.type === "INTENTO_FALLIDO" && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "El intento fallido exige un motivo",
      });
    }
    if (value.type === "VOLVER_A_COBRAR" && value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Volver a cobrar no lleva motivo",
      });
    }
    if (value.reason === "OTRO" && !value.note) {
      context.addIssue({
        code: "custom",
        path: ["note"],
        message: "El motivo OTRO exige una observación",
      });
    }
    if (value.retryAt && new Date(value.retryAt).getTime() <= Date.now()) {
      context.addIssue({
        code: "custom",
        path: ["retryAt"],
        message: "La fecha de reintento debe ser futura",
      });
    }
  });

export type AttemptInput = z.output<typeof attemptSchema>;

export const fundSchema = z.object({
  sessionId: z.uuid(),
  amount: z.number().int().positive().max(1_000_000_000_000),
});
