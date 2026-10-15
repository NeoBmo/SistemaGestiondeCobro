import { z } from "zod";

export const TICKET_PRIORITIES = ["ALTA", "MEDIA", "BAJA"] as const;
export const TICKET_STATUSES = ["ABIERTO", "EN_ATENCION", "RESUELTO", "CERRADO"] as const;
export type TicketPriority = (typeof TICKET_PRIORITIES)[number];
export type TicketStatus = (typeof TICKET_STATUSES)[number];

// Postgres (`text`) rechaza el byte nulo; se prohíbe aquí para dar 400 en vez de un 500 tardío.
const text = (label: string, max: number) =>
  z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), `${label} no puede contener el carácter nulo`)
    .pipe(z.string().min(1, `${label} es obligatorio`).max(max));

/** El Admin describe el problema y propone una prioridad (ADR 0011). */
export const createTicketSchema = z.object({
  description: text("La descripción", 2000),
  priority: z.enum(TICKET_PRIORITIES).default("MEDIA"),
});

/** El Super Admin atiende: estado (hacia adelante), prioridad y respuesta; al menos una cosa. */
export const attendTicketSchema = z
  .object({
    status: z.enum(["EN_ATENCION", "RESUELTO"]).optional(),
    priority: z.enum(TICKET_PRIORITIES).optional(),
    response: text("La respuesta", 2000).optional(),
  })
  .refine(
    (value) =>
      value.status !== undefined || value.priority !== undefined || value.response !== undefined,
    { message: "Indica qué cambia: estado, prioridad o respuesta" },
  );

export const ticketIdSchema = z.uuid();

export const ticketListFilterSchema = z.object({
  status: z.enum(TICKET_STATUSES).optional(),
  priority: z.enum(TICKET_PRIORITIES).optional(),
});

export type CreateTicketInput = z.output<typeof createTicketSchema>;
export type AttendTicketInput = z.output<typeof attendTicketSchema>;
