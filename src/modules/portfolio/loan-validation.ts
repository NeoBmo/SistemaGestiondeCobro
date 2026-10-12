import { z } from "zod";
import { isoDate } from "@/shared/dates/dates";
import {
  LOAN_FREQUENCIES,
  MAX_INSTALLMENTS,
  MAX_INTEREST_BPS,
  MAX_PRINCIPAL,
} from "./loan-calculation";

// Postgres (`text`) rechaza el byte nulo; se prohíbe aquí para dar 400 en vez de un 500 tardío.
const comment = z
  .string()
  .trim()
  .refine((value) => !value.includes("\0"), "El comentario no puede contener el carácter nulo")
  .pipe(z.string().max(500))
  .transform((value) => value || undefined)
  .optional();

/** Fecha `YYYY-MM-DD` real (rechaza el 30 de febrero). */
const calendarDate = z
  .string()
  .refine((value) => {
    try {
      isoDate(value);
      return true;
    } catch {
      return false;
    }
  }, "La fecha no es válida")
  .transform((value) => isoDate(value));

/**
 * Condiciones de un préstamo nuevo (02 §2.3). `interestBps` son puntos básicos enteros (20 % = 2000).
 * La fecha de desembolso no se envía: es hoy en la zona del negocio (el desembolso ocurre al confirmar).
 */
export const loanTermsSchema = z.object({
  clientId: z.uuid(),
  principal: z.number().int().positive().max(MAX_PRINCIPAL),
  interestBps: z.number().int().min(0).max(MAX_INTEREST_BPS),
  frequency: z.enum(LOAN_FREQUENCIES),
  installmentCount: z.number().int().min(1).max(MAX_INSTALLMENTS),
  firstDueOn: calendarDate,
});

export const confirmContractSchema = loanTermsSchema.extend({ comment });

export type LoanTermsInput = z.output<typeof loanTermsSchema>;
export type ConfirmContractInput = z.output<typeof confirmContractSchema>;
