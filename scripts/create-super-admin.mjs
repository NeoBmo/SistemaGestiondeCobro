// Crea un Super Admin (F1-T3). No hay pantalla ni endpoint para esto a propósito: el primer
// Super Admin se crea desde una máquina de confianza con acceso a la base de datos.
//
//   npm run admin:create-super-admin
//
// Lee la configuración de .env.local (URL de Supabase, service role, DATABASE_URL y dominio del
// email sintético), pide usuario, nombre y contraseña por consola y confirma el destino antes de
// escribir. La contraseña la elige la persona: el Super Admin queda ACTIVO sin cambio pendiente.
import { pathToFileURL } from "node:url";
import readline from "node:readline";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";

// Mismas reglas que src/modules/identity/{username,password-policy}.ts. Este script no importa del
// código TypeScript de la aplicación; una prueba unitaria compara ambas implementaciones.
const USERNAME = /^[a-z0-9._-]{3,32}$/;
const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_BYTES = 72;

export function normalizeUsername(username) {
  return username.trim().toLowerCase();
}

export function isValidUsername(username) {
  return USERNAME.test(username);
}

export function passwordIssues(password) {
  const issues = [];
  if ([...password].length < PASSWORD_MIN_LENGTH) issues.push("TOO_SHORT");
  if (new TextEncoder().encode(password).length > PASSWORD_MAX_BYTES) issues.push("TOO_LONG");
  if (!/\p{L}/u.test(password)) issues.push("NEEDS_LETTER");
  if (!/\d/.test(password)) issues.push("NEEDS_DIGIT");
  return issues;
}

/** Mismo criterio que src/modules/identity/synthetic-email.ts: usuario normalizado @ dominio normalizado. */
export function buildSyntheticEmail(username, domain) {
  return `${normalizeUsername(username)}@${domain.trim().toLowerCase()}`;
}

function failure(code, message) {
  return Object.assign(new Error(message), { code });
}

/**
 * Crea el usuario en Auth y, en una transacción, su perfil SUPER_ADMIN y el evento de auditoría
 * UsuarioCreado (sin actor: es el arranque de la plataforma). Si la BD falla, elimina el usuario de Auth.
 */
export async function createSuperAdmin(deps, input) {
  const username = normalizeUsername(input.username);
  const displayName = input.displayName.trim();
  if (!isValidUsername(username)) {
    throw failure(
      "INVALID_USERNAME",
      "El usuario debe tener de 3 a 32 caracteres: minúsculas sin acentos, dígitos, punto, guion o guion bajo",
    );
  }
  if (displayName.length === 0)
    throw failure("INVALID_DISPLAY_NAME", "El nombre no puede estar vacío");
  if (passwordIssues(input.password).length > 0) {
    throw failure(
      "INVALID_PASSWORD",
      `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres (máximo ${PASSWORD_MAX_BYTES} bytes), con al menos una letra y un dígito`,
    );
  }

  const taken = await deps.db.query("select 1 from public.profiles where username = $1", [
    username,
  ]);
  if ((taken.rowCount ?? 0) > 0)
    throw failure("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso");

  const created = await deps.admin.auth.admin.createUser({
    email: buildSyntheticEmail(username, deps.syntheticEmailDomain),
    password: input.password,
    email_confirm: true,
  });
  if (created.error || !created.data.user) {
    if (created.error?.code === "email_exists") {
      throw failure("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso");
    }
    throw failure("AUTH_UNAVAILABLE", "No se pudo crear el usuario en Auth");
  }
  const userId = created.data.user.id;

  let client;
  try {
    client = await deps.db.connect();
    await client.query("begin");
    await client.query(
      `insert into public.profiles (id, business_id, role, username, display_name, status)
       values ($1, null, 'SUPER_ADMIN', $2, $3, 'ACTIVO')`,
      [userId, username, displayName],
    );
    await client.query(
      `insert into public.audit_events (business_id, actor_id, action, entity_type, entity_id, summary)
       values (null, null, 'UsuarioCreado', 'profile', $1, $2::jsonb)`,
      [userId, JSON.stringify({ role: "SUPER_ADMIN", username, origin: "bootstrap" })],
    );
    await client.query("commit");
    return { userId, username };
  } catch (error) {
    await client?.query("rollback").catch(() => undefined);
    try {
      const { error: deleteError } = await deps.admin.auth.admin.deleteUser(userId);
      if (deleteError) throw new Error(deleteError.message);
    } catch {
      console.error("No se pudo eliminar el usuario de Auth huérfano:", userId);
    }
    if (error?.code === "23505")
      throw failure("USERNAME_TAKEN", "Ese nombre de usuario ya está en uso");
    throw error;
  } finally {
    client?.release();
  }
}

function requiredEnv(name) {
  const value = process.env[name];
  if (!value) throw failure("MISSING_ENV", `Falta la variable ${name} (revisa .env.local)`);
  return value;
}

/**
 * Lee una línea sin hacer eco (contraseñas), leyendo el stdin en bruto en vez de depender de la
 * API privada `readline.Interface#_writeToOutput`. Sin TTY (pruebas, entrada por tubería) cae a
 * `readline` normal: no hay terminal que ocultar y así sigue siendo automatizable.
 */
function readHiddenLine(question) {
  process.stdout.write(question);
  if (!process.stdin.isTTY) {
    return new Promise((resolve) => {
      const rl = readline.createInterface({ input: process.stdin, terminal: false });
      rl.once("line", (line) => {
        rl.close();
        resolve(line);
      });
    });
  }

  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    let value = "";

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };
    const onData = (chunk) => {
      const text = chunk.toString("utf8");
      if (text === "\u0003") {
        cleanup();
        reject(failure("CANCELLED", "Cancelado por el usuario"));
        return;
      }
      if (text === "\r" || text === "\n") {
        cleanup();
        process.stdout.write("\n");
        resolve(value);
        return;
      }
      if (text === "\u007f" || text === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += text;
    };

    stdin.setEncoding("utf8");
    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function createPrompt() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question) =>
    new Promise((resolve, reject) => {
      // Si stdin se cierra (EOF) mientras se espera esta respuesta, no hay "SI": se sale con error
      // (el `.catch` de `main()` pone `process.exitCode = 1`), en vez de seguir como si hubiera CANCELLED.
      const onClose = () => reject(failure("INPUT_CLOSED", "Entrada cerrada antes de responder"));
      rl.once("close", onClose);
      rl.question(question, (answer) => {
        rl.off("close", onClose);
        resolve(answer);
      });
    });
  return {
    ask,
    askHidden: readHiddenLine,
    close: () => rl.close(),
  };
}

async function main() {
  const url = requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  const databaseUrl = requiredEnv("DATABASE_URL");
  const syntheticEmailDomain = requiredEnv("AUTH_SYNTHETIC_EMAIL_DOMAIN");

  const apiHost = new URL(url).host;
  const dbHost = new URL(databaseUrl).host;
  console.log(`Destino: ${apiHost} (base de datos: ${dbHost})`);
  // Un service role y una BD de proyectos distintos fallarían al insertar el perfil (FK a
  // auth.users) y se compensaría solo; aun así, avisar antes de escribir nada evita el susto.
  if (!dbHost.includes("127.0.0.1") && !dbHost.includes("localhost") && apiHost !== dbHost) {
    console.log(
      `Aviso: la URL de Supabase (${apiHost}) y la base de datos (${dbHost}) no coinciden. ¿Es el mismo proyecto?`,
    );
  }

  const prompt = createPrompt();
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const confirmation = await prompt.ask("Escribe SI para crear un Super Admin en ese destino: ");
    if (confirmation.trim() !== "SI") {
      console.log("Cancelado.");
      process.exitCode = 1;
      return;
    }
    const username = await prompt.ask("Usuario (minúsculas, dígitos, . _ -): ");
    const displayName = await prompt.ask("Nombre visible: ");
    const password = await prompt.askHidden("Contraseña: ");
    if ((await prompt.askHidden("Repite la contraseña: ")) !== password) {
      throw failure("PASSWORD_MISMATCH", "Las contraseñas no coinciden");
    }

    const admin = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const result = await createSuperAdmin(
      { db: pool, admin, syntheticEmailDomain },
      { username, displayName, password },
    );
    console.log(`Listo: Super Admin "${result.username}" creado (id ${result.userId}).`);
  } finally {
    prompt.close();
    await pool.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  });
}
