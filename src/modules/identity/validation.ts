import { z } from "zod";

// Límites generosos: la validación real de formato ocurre en el servicio (y no se detalla al cliente).
export const loginSchema = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const firstPasswordChangeSchema = z.object({
  newPassword: z.string().min(1).max(128),
});
