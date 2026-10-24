import { readFile } from "node:fs/promises";

const agents = await readFile(new URL("../AGENTS.md", import.meta.url), "utf8");
const claude = await readFile(new URL("../CLAUDE.md", import.meta.url), "utf8");
const openCode = JSON.parse(await readFile(new URL("../opencode.json", import.meta.url), "utf8"));

if (!agents.includes("# AGENTS.md")) {
  throw new Error("AGENTS.md debe existir como fuente compartida de instrucciones.");
}

if (!/^@AGENTS\.md\s*$/m.test(claude)) {
  throw new Error("CLAUDE.md debe importar AGENTS.md explícitamente.");
}

// Las 9 reglas no negociables deben estar en el contexto que todo agente carga siempre.
const rules = agents.split("## Reglas de negocio no negociables")[1]?.split("\n## ")[0] ?? "";
const ruleRows = rules.match(/^\| [1-9] \|/gm) ?? [];
if (ruleRows.length !== 9) {
  throw new Error(
    `AGENTS.md debe listar las 9 reglas de negocio no negociables (encontradas: ${ruleRows.length}).`,
  );
}

if (openCode.instructions) {
  throw new Error("OpenCode no debe cargar otro archivo de reglas que diverja de AGENTS.md.");
}

console.log("Canon compartido de instrucciones: correcto.");
