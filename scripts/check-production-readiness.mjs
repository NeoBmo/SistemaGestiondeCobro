import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// INV-034: guarda de lanzamiento. Falla si queda algo que impide llevar datos reales a producción.
// No corre en el CI normal (lo haría fallar a propósito hasta F8): ver docs/operacion/LANZAMIENTO.md.

const root = process.cwd();
const MARKER = "PLACEHOLDER-IDENTIDAD";
const CODE_DIRS = ["src", "public"];
const PENDING_FILE = "docs/planning/05-PENDIENTES.md";

const blockers = [];

// 1. Identidad visual provisional en el código que se despliega.
for (const dir of CODE_DIRS) {
  for (const file of await listFiles(path.join(root, dir))) {
    const lines = (await readFile(file, "utf8")).split("\n");
    lines.forEach((line, index) => {
      if (line.includes(MARKER)) {
        blockers.push(
          `Identidad visual provisional (${MARKER}) en ${relative(file)}:${index + 1}. ` +
            "Sustituir por el activo definitivo.",
        );
      }
    });
  }
}

// 2. URL pública de ejemplo. Solo aplica al construir para producción.
if (process.env.NODE_ENV === "production") {
  const siteUrl = process.env.PUBLIC_SITE_URL?.trim();
  const host = parseHost(siteUrl);
  if (!siteUrl) {
    blockers.push(
      "PUBLIC_SITE_URL no está definida: canonical, sitemap y robots no tendrían dominio.",
    );
  } else if (host === null) {
    blockers.push(`PUBLIC_SITE_URL no es una URL válida: «${siteUrl}».`);
  } else if (host.endsWith(".invalid")) {
    blockers.push(
      `PUBLIC_SITE_URL es la de ejemplo (${host}): configurar el dominio real de producción.`,
    );
  }
}

// 3. Decisiones abiertas que bloquean F8 en 05-PENDIENTES.
for (const item of openF8Items(await readFile(path.join(root, PENDING_FILE), "utf8"))) {
  blockers.push(`Pendiente que bloquea F8 (${PENDING_FILE}): ${item}`);
}

if (process.env.NODE_ENV !== "production") {
  console.log("Aviso: NODE_ENV no es «production», así que no se comprobó PUBLIC_SITE_URL.");
}

if (blockers.length > 0) {
  console.error(`No está listo para producción. Bloqueantes (${blockers.length}):\n`);
  blockers.forEach((blocker, index) => console.error(`${index + 1}. ${blocker}`));
  process.exit(1);
}

console.log("Listo para producción: no se encontraron bloqueantes.");

async function listFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true }).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(entry.parentPath, entry.name));
}

function relative(file) {
  return path.relative(root, file).split(path.sep).join("/");
}

function parseHost(value) {
  try {
    return new URL(value).hostname;
  } catch {
    return null;
  }
}

/**
 * Lo abierto vive entre «## Abierto» y «## Explícitamente NO pendiente». Cuenta como bloqueo de F8
 * una viñeta que diga «bloquea F8» o una fila de tabla cuya última columna mencione F8, salvo que
 * empiece por «Resuelto».
 */
function openF8Items(markdown) {
  const start = markdown.indexOf("## Abierto");
  const end = markdown.indexOf("## Explícitamente NO pendiente");
  if (start === -1 || end === -1) {
    throw new Error(`${PENDING_FILE} cambió de estructura: no se encuentran sus secciones.`);
  }

  const items = [];
  for (const line of markdown.slice(start, end).split("\n")) {
    if (line.startsWith("- ") && /bloquea[^)]*\bF8\b/i.test(line)) {
      items.push(summarize(line.slice(2)));
      continue;
    }
    const cells = line.startsWith("|")
      ? line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim())
      : [];
    const blocks = cells.at(-1) ?? "";
    if (cells.length >= 2 && /\bF8\b/.test(blocks) && !/^resuelto/i.test(blocks)) {
      items.push(`${summarize(cells[0])} [${blocks}]`);
    }
  }
  return items;
}

/** La negrita inicial si la hay; si no, la primera frase recortada. Sin formato Markdown. */
function summarize(text) {
  const bold = /^\*\*(.+?)\*\*/.exec(text)?.[1];
  const plain = (bold ?? text.split(/[:.;]\s/)[0]).replaceAll("`", "").trim();
  return plain.length > 140 ? `${plain.slice(0, 137)}…` : plain;
}
