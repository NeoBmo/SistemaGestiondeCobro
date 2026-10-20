import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
}

const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const sourceFiles = config.fileNames.filter(
  (fileName) =>
    path.resolve(fileName).includes(`${path.sep}src${path.sep}`) &&
    /\.tsx?$/.test(fileName) &&
    !fileName.endsWith(".d.ts"),
);
const largeFiles = [];
const largeFunctions = [];
let productionFileCount = 0;
let testFileCount = 0;

for (const fileName of sourceFiles) {
  const content = ts.sys.readFile(fileName);
  if (content === undefined) continue;
  const sourceFile = ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true);
  const isTest = /\.(test|spec)\.tsx?$/.test(fileName);
  if (isTest) testFileCount += 1;
  else productionFileCount += 1;

  const fileLineCount = sourceFile.getLineAndCharacterOfPosition(sourceFile.end).line + 1;
  if (fileLineCount > 400) largeFiles.push({ fileName, lines: fileLineCount, isTest });

  const visit = (node) => {
    if (ts.isFunctionLike(node) && node.body) {
      const startLine = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line;
      const endLine = sourceFile.getLineAndCharacterOfPosition(node.end).line;
      const lines = endLine - startLine + 1;
      if (lines > 80) {
        largeFunctions.push({
          fileName,
          name:
            node.name?.getText(sourceFile) ?? node.parent.name?.getText(sourceFile) ?? "<anónima>",
          lines,
          isTest,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
}

const relative = (fileName) => path.relative(root, fileName).replaceAll("\\", "/");
largeFiles.sort(
  (a, b) => b.lines - a.lines || relative(a.fileName).localeCompare(relative(b.fileName)),
);
largeFunctions.sort(
  (a, b) => b.lines - a.lines || relative(a.fileName).localeCompare(relative(b.fileName)),
);

console.log(
  `# Hotspots TypeScript (umbral de observación: >400 líneas/archivo, >80 líneas/función)\n`,
);
console.log(
  `Archivos de producto: ${productionFileCount}; archivos de prueba: ${testFileCount}.\n`,
);
console.log("## Archivos sobre el umbral\n");
console.log(
  largeFiles.length
    ? largeFiles
        .map(
          ({ fileName, lines, isTest }) =>
            `- ${relative(fileName)} — ${lines} líneas${isTest ? " (test)" : ""}`,
        )
        .join("\n")
    : "- Ninguno",
);
console.log("\n## Funciones sobre el umbral\n");
console.log(
  largeFunctions.length
    ? largeFunctions
        .map(
          ({ fileName, name, lines, isTest }) =>
            `- ${relative(fileName)} — ${name}: ${lines} líneas${isTest ? " (test)" : ""}`,
        )
        .join("\n")
    : "- Ninguna",
);
console.log(
  "\nEl reporte no determina duplicación, código muerto ni comentarios innecesarios; no propone dividir una función solo por su tamaño.",
);
