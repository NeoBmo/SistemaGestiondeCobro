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

if (openCode.instructions) {
  throw new Error("OpenCode no debe cargar otro archivo de reglas que diverja de AGENTS.md.");
}

console.log("Canon compartido de instrucciones: correcto.");
