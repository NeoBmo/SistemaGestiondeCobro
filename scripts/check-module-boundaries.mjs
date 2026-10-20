import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const moduleRoot = path.resolve(root, "src/modules");
const appRoot = path.resolve(root, "src/app");
const allowedDependencies = new Map([
  ["audit", []],
  ["cash", ["audit", "identity"]],
  ["collections", ["audit", "cash", "identity", "portfolio"]],
  ["dashboard", ["audit", "identity", "subscriptions"]],
  ["identity", ["audit"]],
  ["monitoring", ["audit", "identity", "subscriptions", "support"]],
  ["portfolio", ["audit", "cash", "identity"]],
  ["subscriptions", ["audit", "identity"]],
  ["support", ["audit", "identity"]],
]);

const configFile = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
if (configFile.error) {
  throw new Error(ts.flattenDiagnosticMessageText(configFile.error.messageText, "\n"));
}

const config = ts.parseJsonConfigFileContent(configFile.config, ts.sys, root);
const sourceFiles = config.fileNames.filter(
  (file) =>
    isWithin(moduleRoot, file) &&
    !/\.(test|spec)\.[cm]?[jt]sx?$/.test(file) &&
    !file.endsWith(".d.ts"),
);
const fileGraph = new Map(sourceFiles.map((file) => [path.resolve(file), new Set()]));
const moduleGraph = new Map([...allowedDependencies.keys()].map((name) => [name, new Set()]));
const violations = [];

for (const fileName of sourceFiles) {
  const source = ts.sys.readFile(fileName);
  if (source === undefined) continue;

  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const importer = moduleNameFor(fileName);
  const specifiers = collectModuleSpecifiers(sourceFile);

  for (const specifier of specifiers) {
    const resolved = ts.resolveModuleName(specifier, fileName, config.options, ts.sys)
      .resolvedModule?.resolvedFileName;
    if (!resolved) continue;

    const target = path.resolve(resolved);
    if (isWithin(appRoot, target)) {
      violations.push(`${relative(fileName)} importa la capa exterior src/app (${specifier})`);
      continue;
    }
    if (!isWithin(moduleRoot, target)) continue;

    const dependency = moduleNameFor(target);
    if (dependency === importer) {
      fileGraph.get(path.resolve(fileName))?.add(target);
      continue;
    }

    const allowed = allowedDependencies.get(importer);
    if (!allowed?.includes(dependency)) {
      violations.push(
        `${importer} importa ${dependency} sin allowlist: ${relative(fileName)} → ${relative(target)}`,
      );
      continue;
    }

    moduleGraph.get(importer)?.add(dependency);
    fileGraph.get(path.resolve(fileName))?.add(target);
  }
}

const cycles = [
  ...findCycles(moduleGraph),
  ...findCycles(fileGraph).map((cycle) => cycle.map(relative)),
];
for (const cycle of cycles) violations.push(`Ciclo de imports: ${cycle.join(" → ")}`);

if (violations.length > 0) {
  console.error("Falló la guardia de límites modulares:");
  for (const violation of violations) console.error(`- ${violation}`);
  process.exitCode = 1;
} else {
  console.log(`Límites modulares correctos (${sourceFiles.length} archivos fuente analizados).`);
}

function collectModuleSpecifiers(sourceFile) {
  const specifiers = [];
  for (const statement of sourceFile.statements) {
    if (
      (ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier
    ) {
      if (ts.isStringLiteral(statement.moduleSpecifier))
        specifiers.push(statement.moduleSpecifier.text);
    }
  }

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === "require")) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifiers.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return specifiers;
}

function findCycles(graph) {
  const visited = new Set();
  const active = new Set();
  const stack = [];
  const found = [];
  const recorded = new Set();

  const visit = (node) => {
    if (active.has(node)) {
      const cycleStart = stack.indexOf(node);
      const cycle = [...stack.slice(cycleStart), node];
      const key = cycle
        .map((item) => String(item))
        .sort()
        .join("|");
      if (!recorded.has(key)) {
        recorded.add(key);
        found.push(cycle);
      }
      return;
    }
    if (visited.has(node)) return;

    visited.add(node);
    active.add(node);
    stack.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    stack.pop();
    active.delete(node);
  };

  for (const node of graph.keys()) visit(node);
  return found;
}

function moduleNameFor(fileName) {
  const relativePath = path.relative(moduleRoot, fileName).replaceAll("\\", "/");
  return relativePath.split("/")[0];
}

function isWithin(parent, child) {
  const relativePath = path.relative(parent, path.resolve(child));
  return (
    relativePath === "" || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== "..")
  );
}

function relative(fileName) {
  return path.relative(root, fileName).replaceAll("\\", "/");
}
