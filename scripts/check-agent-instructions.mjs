import { access, readFile } from "node:fs/promises";

// ADR 0014: Claude Code es la única herramienta agéntica; CLAUDE.md es la única fuente de instrucciones.
const exists = (file) =>
  access(new URL(`../${file}`, import.meta.url)).then(
    () => true,
    () => false,
  );

const claude = await readFile(new URL("../CLAUDE.md", import.meta.url), "utf8");

if (!claude.includes("# CLAUDE.md")) {
  throw new Error("CLAUDE.md debe existir como única fuente de instrucciones del proyecto.");
}

// Una segunda fuente de instrucciones vuelve a abrir la puerta a reglas divergentes.
for (const file of ["AGENTS.md", "opencode.json", ".opencode"]) {
  if (await exists(file)) {
    throw new Error(
      `${file} no debe existir: las instrucciones viven solo en CLAUDE.md (ADR 0014).`,
    );
  }
}

// Las 9 reglas no negociables deben estar en el contexto que todo agente carga siempre.
const rules = claude.split("## Reglas de negocio no negociables")[1]?.split("\n## ")[0] ?? "";
const ruleRows = rules.match(/^\| [1-9] \|/gm) ?? [];
if (ruleRows.length !== 9) {
  throw new Error(
    `CLAUDE.md debe listar las 9 reglas de negocio no negociables (encontradas: ${ruleRows.length}).`,
  );
}

console.log("Instrucciones del proyecto: correctas.");
