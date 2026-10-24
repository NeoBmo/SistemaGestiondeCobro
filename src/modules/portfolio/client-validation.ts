import { z } from "zod";

// Postgres (`text`) rechaza el byte nulo; se prohíbe aquí para dar 400 en vez de un 500 tardío.
const text = (label: string) =>
  z
    .string()
    .trim()
    .refine((value) => !value.includes("\0"), `${label} no puede contener el carácter nulo`);

/** Texto opcional: vacío (o solo espacios) equivale a «sin dato». */
const optional = (label: string, max: number) =>
  text(label)
    .pipe(z.string().max(max))
    .transform((value) => value || undefined)
    .optional();

const requiredText = (label: string, max: number) => text(label).pipe(z.string().min(1).max(max));

/** Datos de contacto y descriptivos que se pueden editar (02 §2.1). */
const contactFields = {
  name: requiredText("El nombre", 120),
  nickname: optional("El sobrenombre", 120),
  address: optional("La dirección", 300),
  phone: optional("El teléfono", 30),
  whatsapp: optional("El WhatsApp", 30),
  notes: optional("Las notas", 1000),
};

export const createClientSchema = z.object({
  ...contactFields,
  // Única por negocio y nunca cambia (ADR 0007): se recorta y no puede quedar vacía. La unicidad compara
  // solo sus letras y dígitos (02 §2.1), así que debe tener al menos uno.
  identification: requiredText("La identificación", 40).refine(
    (value) => /[\p{L}\p{Nd}]/u.test(value),
    "La identificación debe tener al menos una letra o un dígito",
  ),
});

export const updateClientSchema = z.object(contactFields);

export const clientIdSchema = z.uuid();

export type CreateClientInput = z.output<typeof createClientSchema>;
export type UpdateClientInput = z.output<typeof updateClientSchema>;
