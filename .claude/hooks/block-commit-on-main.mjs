#!/usr/bin/env node
// PreToolUse (Bash): bloquea `git commit` cuando la rama destino es main.
// Regla: 07-FLUJO-DE-TRABAJO.md §3 — rama por tarea, nunca directo a main.
//
// La rama se mira en el repo donde el commit ocurre de verdad, no en la carpeta de la sesión:
//   1. `git -C <ruta> commit`            → <ruta>
//   2. `cd <ruta> && … git commit`       → <ruta>
//   3. sin ninguna de las anteriores     → cwd de la sesión
// Exit 2 = bloquear la llamada y devolver el motivo al agente.
import { execFileSync } from "node:child_process";
import path from "node:path";

const quoted = String.raw`("[^"]+"|'[^']+'|[^\s;&|]+)`;
const unquote = (s) => s.replace(/^["']|["']$/g, "");

let raw = "";
for await (const chunk of process.stdin) raw += chunk;

let input;
try {
  input = JSON.parse(raw);
} catch {
  process.exit(0); // entrada inesperada: no bloquear por un fallo del propio hook
}

const command = input?.tool_input?.command ?? "";
const commit = new RegExp(String.raw`\bgit\s+(?:-C\s+${quoted}\s+)?commit\b`).exec(command);
if (!commit) process.exit(0);

const sessionDir = input.cwd || process.cwd();
let target = commit[1] && unquote(commit[1]);
if (!target) {
  const cds = [...command.slice(0, commit.index).matchAll(new RegExp(String.raw`\bcd\s+${quoted}`, "g"))];
  if (cds.length) target = unquote(cds.at(-1)[1]);
}
const dir = target ? path.resolve(sessionDir, target) : sessionDir;

let branch;
try {
  branch = execFileSync("git", ["-C", dir, "branch", "--show-current"], { encoding: "utf8" }).trim();
} catch {
  process.exit(0); // no es un repo git: nada que proteger
}

if (branch === "main") {
  process.stderr.write(
    "Bloqueado: no se commitea en main. Crea una rama de tarea (git switch -c <tipo>/<tarea>).\n",
  );
  process.exit(2);
}
