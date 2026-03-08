#!/usr/bin/env bun

/**
 * Bobbin Linter
 *
 * Checks all bobbins for convention consistency, naming issues,
 * missing fields, and structural problems.
 *
 * Usage: bun scripts/lint-bobbins.ts
 */

import fs from "fs";
import path from "path";
// yaml is available in apps/api/node_modules — import from there for this dev script
import YAML from "../apps/api/node_modules/yaml/dist/index.js";

const BOBBINS_DIR = path.join(import.meta.dirname!, "..", "bobbins");

// --- Types ---

type Severity = "error" | "warning";

interface Diagnostic {
  rule: string;
  message: string;
  severity: Severity;
}

interface BobbinContext {
  dirName: string;
  dirPath: string;
  manifest: Record<string, any> | null;
  pkg: Record<string, any> | null;
  hasSrcDir: boolean;
  files: string[];
}

// --- Helpers ---

const KEBAB_RE = /^[a-z][a-z0-9-]*$/;

function isKebabCase(s: string): boolean {
  return KEBAB_RE.test(s);
}

function isTitleCase(s: string): boolean {
  // Each word should start with uppercase (allow &, small words like "of")
  const smallWords = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "with", "by"]);
  const words = s.split(/\s+/);
  if (words.length === 0) return false;
  // First word must be capitalized
  if (words[0][0] !== words[0][0].toUpperCase()) return false;
  for (let i = 1; i < words.length; i++) {
    const w = words[i];
    if (!w) continue;
    // Allow symbols like &
    if (/^[^a-zA-Z]/.test(w)) continue;
    // Small words can be lowercase
    if (smallWords.has(w.toLowerCase()) && w[0] === w[0].toLowerCase()) continue;
    // Otherwise must start uppercase
    if (w[0] !== w[0].toUpperCase()) return false;
  }
  return true;
}

function listFilesRecursive(dir: string, base: string = ""): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = path.join(base, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      results.push(...listFilesRecursive(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

// --- Rule implementations ---

function checkManifestExists(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest) {
    return [{ rule: "manifest-exists", message: "missing manifest.yaml", severity: "warning" }];
  }
  return [];
}

function checkRequiredFields(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest) return [];
  const required = ["id", "name", "version", "author", "description", "tags", "license"];
  const diags: Diagnostic[] = [];
  for (const field of required) {
    if (ctx.manifest[field] === undefined || ctx.manifest[field] === null) {
      diags.push({ rule: "required-fields", message: `missing '${field}'`, severity: "warning" });
    }
  }
  return diags;
}

function checkIdMatchesDir(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.id) return [];
  if (ctx.manifest.id !== ctx.dirName) {
    return [{
      rule: "id-matches-dir",
      message: `id '${ctx.manifest.id}' does not match directory '${ctx.dirName}'`,
      severity: "error",
    }];
  }
  return [];
}

function checkIdKebabCase(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.id) return [];
  if (!isKebabCase(ctx.manifest.id)) {
    return [{
      rule: "id-kebab-case",
      message: `id '${ctx.manifest.id}' is not kebab-case`,
      severity: "error",
    }];
  }
  return [];
}

function checkNameTitleCase(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.name) return [];
  if (!isTitleCase(ctx.manifest.name)) {
    return [{
      rule: "name-title-case",
      message: `name '${ctx.manifest.name}' should be Title Case`,
      severity: "warning",
    }];
  }
  return [];
}

function checkAuthorConsistent(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.author) return [];
  const known = ["Bobbins Core", "Bobbinry Team", "Bobbins Samples"];
  if (!known.includes(ctx.manifest.author)) {
    return [{
      rule: "author-consistent",
      message: `author '${ctx.manifest.author}' is not one of: ${known.join(", ")}`,
      severity: "warning",
    }];
  }
  return [];
}

function checkCapabilitiesPresent(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest) return [];
  if (!ctx.manifest.capabilities) {
    return [{ rule: "capabilities-present", message: "missing capabilities block", severity: "warning" }];
  }
  return [];
}

function checkExecutionPresent(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest) return [];
  if (!ctx.manifest.execution) {
    return [{ rule: "execution-present", message: "missing execution block", severity: "warning" }];
  }
  return [];
}

function checkCompatibilityPresent(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest) return [];
  if (!ctx.manifest.compatibility?.minShellVersion) {
    return [{ rule: "compatibility-present", message: "missing compatibility.minShellVersion", severity: "warning" }];
  }
  return [];
}

function checkPkgExists(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg) {
    return [{ rule: "pkg-exists", message: "missing package.json", severity: "warning" }];
  }
  return [];
}

function checkPkgNameMatches(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg?.name) return [];
  const expected = `@bobbinry/${ctx.dirName}`;
  if (ctx.pkg.name !== expected) {
    if (ctx.pkg.name.startsWith("@bobbins/")) {
      return [{
        rule: "pkg-name-matches",
        message: `package name '${ctx.pkg.name}' should be '${expected}' (not @bobbins/)`,
        severity: "error",
      }];
    }
    return [{
      rule: "pkg-name-matches",
      message: `package name '${ctx.pkg.name}' should be '${expected}'`,
      severity: "warning",
    }];
  }
  return [];
}

function checkPkgHasExports(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg) return [];
  if (ctx.pkg.private) return [];
  if (!ctx.pkg.exports) {
    return [{ rule: "pkg-has-exports", message: "missing exports field", severity: "warning" }];
  }
  return [];
}

function checkPkgMainSrc(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg || !ctx.hasSrcDir) return [];
  if (ctx.pkg.main && ctx.pkg.main !== "src/index.ts") {
    return [{
      rule: "pkg-main-src",
      message: `main is '${ctx.pkg.main}', should be 'src/index.ts'`,
      severity: "warning",
    }];
  }
  return [];
}

function checkPkgHasTypes(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg || !ctx.hasSrcDir) return [];
  if (ctx.pkg.private) return [];
  if (!ctx.pkg.types) {
    return [{ rule: "pkg-has-types", message: "missing types field", severity: "warning" }];
  }
  return [];
}

function checkPkgReactVersion(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg) return [];
  const reactPeer = ctx.pkg.peerDependencies?.react;
  const reactDep = ctx.pkg.dependencies?.react;
  const diags: Diagnostic[] = [];
  if (reactDep) {
    diags.push({
      rule: "pkg-react-version",
      message: "react should be in peerDependencies, not dependencies",
      severity: "warning",
    });
  }
  if (reactPeer && !reactPeer.startsWith("^19")) {
    diags.push({
      rule: "pkg-react-version",
      message: `react peer dep is '${reactPeer}', should be '^19.0.0'`,
      severity: "warning",
    });
  }
  return diags;
}

function checkPkgHasScripts(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.pkg) return [];
  const scripts = ctx.pkg.scripts || {};
  // Private packages only need a build script
  const expected = ctx.pkg.private ? ["build"] : ["build", "dev", "typecheck"];
  const diags: Diagnostic[] = [];
  for (const s of expected) {
    if (!scripts[s]) {
      diags.push({
        rule: "pkg-has-scripts",
        message: `missing script '${s}'`,
        severity: "warning",
      });
    }
  }
  return diags;
}

function checkViewsInViews(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.extensions?.contributions) return [];
  // Sandboxed bobbins use flat paths (not src/panels vs src/views)
  if (ctx.manifest.execution?.mode === "sandboxed") return [];
  const diags: Diagnostic[] = [];
  for (const contrib of ctx.manifest.extensions.contributions) {
    if (!contrib.entry) continue;
    const entry = String(contrib.entry);
    // A panel contribution (slot is a panel slot) using a views/ entry path
    const isPanelSlot = contrib.slot?.includes("Panel") || contrib.type === "panel";
    if (isPanelSlot && entry.startsWith("views/")) {
      diags.push({
        rule: "views-in-views",
        message: `extension entry '${entry}' is a panel contribution — should be in panels/`,
        severity: "warning",
      });
    }
    // A view contribution using a panels/ entry path
    const isViewSlot = contrib.type === "view";
    if (isViewSlot && entry.startsWith("panels/")) {
      diags.push({
        rule: "views-in-views",
        message: `extension entry '${entry}' is a view contribution — should be in views/`,
        severity: "warning",
      });
    }
  }
  return diags;
}

function checkEntryExists(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.extensions?.contributions) return [];
  const diags: Diagnostic[] = [];
  for (const contrib of ctx.manifest.extensions.contributions) {
    if (!contrib.entry) continue;
    const entry = String(contrib.entry);
    // For sandboxed bobbins with .html entries, check directly
    if (entry.endsWith(".html")) {
      const fullPath = path.join(ctx.dirPath, entry);
      if (!fs.existsSync(fullPath)) {
        diags.push({
          rule: "entry-exists",
          message: `entry '${entry}' does not exist`,
          severity: "error",
        });
      }
      continue;
    }
    // For native bobbins, entry could resolve to src/<entry>.tsx or src/<entry>/index.tsx
    const candidates = [
      path.join(ctx.dirPath, "src", entry + ".tsx"),
      path.join(ctx.dirPath, "src", entry + ".ts"),
      path.join(ctx.dirPath, "src", entry, "index.tsx"),
      path.join(ctx.dirPath, "src", entry, "index.ts"),
      // For bobbins without src/ (publishers)
      path.join(ctx.dirPath, entry + ".tsx"),
      path.join(ctx.dirPath, entry + ".ts"),
    ];
    if (!candidates.some((c) => fs.existsSync(c))) {
      diags.push({
        rule: "entry-exists",
        message: `entry '${entry}' does not resolve to an existing file`,
        severity: "error",
      });
    }
  }
  return diags;
}

function checkViewFileExists(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.ui?.views) return [];
  const diags: Diagnostic[] = [];
  for (const view of ctx.manifest.ui.views) {
    if (!view.id) continue;
    // Skip declarative views whose source is a data collection, not a file path
    const source = view.source ? String(view.source) : "";
    if (source && !source.startsWith("views/") && source !== "*") continue;
    const candidates = [
      path.join(ctx.dirPath, "src", "views", view.id + ".tsx"),
      path.join(ctx.dirPath, "src", "views", view.id + ".ts"),
      path.join(ctx.dirPath, "src", "views", view.id, "index.tsx"),
      // Publishers without src/
      path.join(ctx.dirPath, "views", view.id + ".tsx"),
    ];
    if (!candidates.some((c) => fs.existsSync(c))) {
      diags.push({
        rule: "view-file-exists",
        message: `view '${view.id}' has no corresponding file in views/`,
        severity: "warning",
      });
    }
  }
  return diags;
}

function checkPanelIdNamespaced(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.manifest?.extensions?.contributions) return [];
  const diags: Diagnostic[] = [];
  // Generic IDs that should be namespaced
  const bareNames = new Set(["navigation", "sidebar", "panel", "preview", "details", "settings"]);
  for (const contrib of ctx.manifest.extensions.contributions) {
    if (!contrib.id) continue;
    const id = String(contrib.id);
    if (bareNames.has(id)) {
      diags.push({
        rule: "panel-id-namespaced",
        message: `contribution id '${id}' is not namespaced (consider '${ctx.dirName}-${id}')`,
        severity: "warning",
      });
    }
  }
  return diags;
}

function checkTsconfigExists(ctx: BobbinContext): Diagnostic[] {
  if (!ctx.hasSrcDir) return [];
  // Only native bobbins with src/ need tsconfig
  if (ctx.manifest?.execution?.mode === "sandboxed") return [];
  if (!fs.existsSync(path.join(ctx.dirPath, "tsconfig.json"))) {
    return [{ rule: "tsconfig-exists", message: "missing tsconfig.json", severity: "warning" }];
  }
  return [];
}

function checkKebabCaseFiles(ctx: BobbinContext): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const checkDirs = ["src/views", "src/panels", "views", "panels"];
  for (const dir of checkDirs) {
    const fullDir = path.join(ctx.dirPath, dir);
    if (!fs.existsSync(fullDir)) continue;
    for (const entry of fs.readdirSync(fullDir)) {
      if (entry.startsWith(".")) continue;
      const basename = entry.replace(/\.(tsx?|jsx?|html)$/, "");
      if (basename === "index") continue;
      if (!isKebabCase(basename)) {
        diags.push({
          rule: "kebab-case-files",
          message: `${dir}/${entry} is not kebab-case`,
          severity: "warning",
        });
      }
    }
  }
  return diags;
}

// --- Cross-bobbin rules ---

function checkPanelIdUnique(contexts: BobbinContext[]): Map<string, Diagnostic[]> {
  const idMap = new Map<string, string[]>(); // id -> [bobbin names]
  for (const ctx of contexts) {
    if (!ctx.manifest?.extensions?.contributions) continue;
    for (const contrib of ctx.manifest.extensions.contributions) {
      if (!contrib.id) continue;
      const id = String(contrib.id);
      if (!idMap.has(id)) idMap.set(id, []);
      idMap.get(id)!.push(ctx.dirName);
    }
  }

  const result = new Map<string, Diagnostic[]>();
  for (const [id, bobbins] of idMap) {
    if (bobbins.length > 1) {
      for (const bobbin of bobbins) {
        if (!result.has(bobbin)) result.set(bobbin, []);
        const others = bobbins.filter((b) => b !== bobbin);
        result.get(bobbin)!.push({
          rule: "panel-id-unique",
          message: `contribution id '${id}' also used by: ${others.join(", ")}`,
          severity: "warning",
        });
      }
    }
  }
  return result;
}

// --- Main ---

function loadContext(dirName: string): BobbinContext {
  const dirPath = path.join(BOBBINS_DIR, dirName);

  let manifest: Record<string, any> | null = null;
  const manifestPath = path.join(dirPath, "manifest.yaml");
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = YAML.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch {
      // Will be caught by manifest-exists
    }
  }

  let pkg: Record<string, any> | null = null;
  const pkgPath = path.join(dirPath, "package.json");
  if (fs.existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
    } catch {
      // Will be caught by pkg-exists
    }
  }

  const hasSrcDir = fs.existsSync(path.join(dirPath, "src"));
  const files = listFilesRecursive(dirPath);

  return { dirName, dirPath, manifest, pkg, hasSrcDir, files };
}

const perBobbinRules = [
  checkManifestExists,
  checkRequiredFields,
  checkIdMatchesDir,
  checkIdKebabCase,
  checkNameTitleCase,
  checkAuthorConsistent,
  checkCapabilitiesPresent,
  checkExecutionPresent,
  checkCompatibilityPresent,
  checkPkgExists,
  checkPkgNameMatches,
  checkPkgHasExports,
  checkPkgMainSrc,
  checkPkgHasTypes,
  checkPkgReactVersion,
  checkPkgHasScripts,
  checkViewsInViews,
  checkEntryExists,
  checkViewFileExists,
  checkPanelIdNamespaced,
  checkTsconfigExists,
  checkKebabCaseFiles,
];

function main() {
  // Find all bobbin directories (not standalone files)
  const entries = fs.readdirSync(BOBBINS_DIR, { withFileTypes: true });
  const bobbinDirs = entries
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();

  if (bobbinDirs.length === 0) {
    console.log("No bobbin directories found.");
    process.exit(0);
  }

  // Load all contexts
  const contexts = bobbinDirs.map(loadContext);

  // Run per-bobbin rules
  const allDiags = new Map<string, Diagnostic[]>();
  for (const ctx of contexts) {
    const diags: Diagnostic[] = [];
    for (const rule of perBobbinRules) {
      diags.push(...rule(ctx));
    }
    allDiags.set(ctx.dirName, diags);
  }

  // Run cross-bobbin rules
  const crossDiags = checkPanelIdUnique(contexts);
  for (const [bobbin, diags] of crossDiags) {
    const existing = allDiags.get(bobbin) || [];
    existing.push(...diags);
    allDiags.set(bobbin, existing);
  }

  // Output
  let totalErrors = 0;
  let totalWarnings = 0;
  let bobbinsWithIssues = 0;

  for (const dirName of bobbinDirs) {
    const diags = allDiags.get(dirName) || [];
    if (diags.length === 0) continue;

    bobbinsWithIssues++;
    console.log(`\nbobbins/${dirName}/`);
    for (const d of diags) {
      const icon = d.severity === "error" ? "✗" : "⚠";
      console.log(`  ${icon} ${d.rule}: ${d.message}`);
      if (d.severity === "error") totalErrors++;
      else totalWarnings++;
    }
  }

  // Summary
  const clean = bobbinDirs.length - bobbinsWithIssues;
  console.log("");
  if (totalErrors === 0 && totalWarnings === 0) {
    console.log(`✓ All ${bobbinDirs.length} bobbins pass lint checks`);
  } else {
    console.log(`✗ ${totalErrors} error${totalErrors !== 1 ? "s" : ""}, ${totalWarnings} warning${totalWarnings !== 1 ? "s" : ""} across ${bobbinsWithIssues} bobbin${bobbinsWithIssues !== 1 ? "s" : ""} (${clean} clean)`);
  }

  process.exit(totalErrors > 0 ? 1 : 0);
}

main();
