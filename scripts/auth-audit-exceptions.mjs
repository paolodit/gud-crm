import ts from "typescript";

const packages = new Set(["better-auth", "@better-auth/drizzle-adapter", "@better-auth/kysely-adapter"]);
const advisories = new Set([
  "https://github.com/advisories/GHSA-965c-763c-88jm",
  "https://github.com/advisories/GHSA-r4xp-prcw-77qf",
  "https://github.com/advisories/GHSA-q84f-53jg-9ppm",
  "https://github.com/advisories/GHSA-44jh-23m7-hpcf",
]);

function properties(node) {
  if (!node || !ts.isObjectLiteralExpression(node)) return null;
  const entries = [];
  for (const property of node.properties) {
    if (!ts.isPropertyAssignment(property) ||
        !(ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))) return null;
    entries.push([property.name.text, property.initializer]);
  }
  return new Map(entries);
}

// Fail closed when the static configuration changes. No package-wide exemption:
// each reported advisory must also match the reviewed URLs below.
export function unaffectedAuthConfiguration(source) {
  const file = ts.createSourceFile("auth.ts", source, ts.ScriptTarget.Latest, true);
  if (file.parseDiagnostics.length) return false;
  let options;
  const pluginImports = new Set();
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === "better-auth/plugins") {
      const bindings = statement.importClause?.namedBindings;
      if (!bindings || !ts.isNamedImports(bindings)) return false;
      for (const item of bindings.elements) {
        if (item.propertyName) return false;
        pluginImports.add(item.name.text);
      }
    }
    if (ts.isVariableStatement(statement)) for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "auth") continue;
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "betterAuth") return false;
      options = properties(call.arguments[0]);
    }
  }
  if (!options || options.has("socialProviders") || options.has("secondaryStorage")) return false;
  if ([...pluginImports].some(name => !["admin", "mcp"].includes(name))) return false;
  const plugins = options.get("plugins");
  if (!plugins || !ts.isArrayLiteralExpression(plugins)) return false;
  if (plugins.elements.some(node => !ts.isCallExpression(node) || !ts.isIdentifier(node.expression) ||
      !["admin", "mcp", "nextCookies"].includes(node.expression.text))) return false;
  const rateLimit = properties(options.get("rateLimit"));
  const storage = rateLimit?.get("storage");
  return !!storage && ts.isStringLiteral(storage) && storage.text === "memory" && !rateLimit.has("customStorage");
}

export function isReviewedInactiveAuthFinding(name, finding, source, allFindings = {}, seen = new Set()) {
  if (!packages.has(name) || seen.has(name) || !unaffectedAuthConfiguration(source)) return false;
  const visited = new Set([...seen, name]);
  return Array.isArray(finding.via) && finding.via.length > 0 && finding.via.every(item =>
    typeof item === "string"
      ? !!allFindings[item] && isReviewedInactiveAuthFinding(item, allFindings[item], source, allFindings, visited)
      : typeof item === "object" && item !== null && advisories.has(item.url));
}
