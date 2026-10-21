import { z } from "zod";
import { AppError } from "../errors/app-error";

type EnvSource = Record<string, string | undefined>;

const nonEmpty = z.string().min(1);
const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const publicSiteUrl = z.url().refine((value) => {
  if (!URL.canParse(value)) return false;
  const url = new URL(value);
  return (
    (url.protocol === "http:" || url.protocol === "https:") &&
    url.pathname === "/" &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
});

const publicEnvSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: nonEmpty,
});

const serverEnvSchema = z.object({
  PUBLIC_SITE_URL: publicSiteUrl,
  SUPABASE_SERVICE_ROLE_KEY: nonEmpty,
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\/\S+$/),
  AUTH_SYNTHETIC_EMAIL_DOMAIN: z.string().regex(HOSTNAME),
  // Secreto del chequeo de disponibilidad programado (ADR 0011); sin él el chequeo está deshabilitado.
  MONITOR_SECRET: z.string().min(32).optional(),
});

export type PublicEnv = { supabaseUrl: string; supabaseAnonKey: string };
export type ServerEnv = {
  publicSiteUrl: string;
  supabaseServiceRoleKey: string;
  databaseUrl: string;
  syntheticEmailDomain: string;
  monitorSecret?: string;
};

/** Valida y devuelve; el error nombra las variables, nunca sus valores (pueden ser secretos). */
function parseEnv<S extends z.ZodType>(schema: S, source: EnvSource): z.output<S> {
  const result = schema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
  throw new AppError(
    "INVALID_ENV",
    `Variables de entorno inválidas o ausentes: ${names.join(", ")}. Revisa .env.example.`,
    500,
  );
}

export function parsePublicEnv(source: EnvSource): PublicEnv {
  const env = parseEnv(publicEnvSchema, source);
  return {
    supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

export function parseServerEnv(source: EnvSource): ServerEnv {
  const env = parseEnv(serverEnvSchema, source);
  return {
    publicSiteUrl: new URL(env.PUBLIC_SITE_URL).origin,
    supabaseServiceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    databaseUrl: env.DATABASE_URL,
    syntheticEmailDomain: env.AUTH_SYNTHETIC_EMAIL_DOMAIN,
    ...(env.MONITOR_SECRET ? { monitorSecret: env.MONITOR_SECRET } : {}),
  };
}

/** Origen público validado para metadata y archivos de rastreo; solo servidor. */
export function getPublicSiteUrl(): string {
  if (typeof window !== "undefined") {
    throw new AppError(
      "SERVER_ENV_IN_BROWSER",
      "Las variables de servidor no existen en el navegador",
      500,
    );
  }
  const result = publicSiteUrl.safeParse(process.env.PUBLIC_SITE_URL);
  if (!result.success) {
    throw new AppError(
      "INVALID_ENV",
      "Variable de entorno inválida o ausente: PUBLIC_SITE_URL.",
      500,
    );
  }
  return new URL(result.data).origin;
}

let publicEnvCache: PublicEnv | undefined;
let serverEnvCache: ServerEnv | undefined;

/** Seguro en navegador y servidor. Las `NEXT_PUBLIC_*` se leen literales para que Next las inserte. */
export function getPublicEnv(): PublicEnv {
  publicEnvCache ??= parsePublicEnv({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  });
  return publicEnvCache;
}

/** Solo servidor: contiene secretos (service role, cadena de conexión). */
export function getServerEnv(): ServerEnv {
  if (typeof window !== "undefined") {
    throw new AppError(
      "SERVER_ENV_IN_BROWSER",
      "Las variables de servidor no existen en el navegador",
      500,
    );
  }
  serverEnvCache ??= parseServerEnv(process.env);
  return serverEnvCache;
}
