/* Pure Node regression checks for the browser validator; Chromium is not required. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { isDeepStrictEqual } from "node:util";
import vm from "node:vm";
import { PYTHON } from "../../scripts/python_command.mjs";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const source = readFileSync(resolve(ROOT, "architecture-diagram-dsl/scripts/validate_transition_diagram.js"), "utf8");
const context = { console };
context.globalThis = context;
vm.runInNewContext(source, context, { filename: "validate_transition_diagram.js" });
const validator = context.TransitionDiagramValidator;
const failures = [];

const toneFindings = validator.validateDocument({
  dsl: "transition-diagram/1.0",
  meta: { title: "tone" },
  catalog: { node: { label: "Node", type: "service" } },
  system: { title: "tone", nodes: ["node"], wires: [], boundaries: [{ id: "zone", label: "Zone", tone: 42, contains: ["node"] }] },
});
if (!toneFindings.some(item => item.message.includes("boundary tone must be a string"))) failures.push("boundary tone type was accepted");

let malformed;
try {
  malformed = validator.validateDocument({
    dsl: "transition-diagram/1.0",
    meta: { title: "malformed" },
    catalog: { node: { label: "Node", type: "service" } },
    packages: { broken: null },
    system: { title: "malformed", nodes: ["node"], wires: [] },
  });
} catch (error) {
  failures.push(`malformed package threw: ${error.message}`);
}
if (!malformed?.some(item => item.rule === "schema")) failures.push("malformed package did not return schema findings");

const python = PYTHON;
const pythonScript = resolve(ROOT, "architecture-diagram-dsl/scripts/validate_transition_diagram.py");
const base = {
  dsl: "transition-diagram/1.0",
  meta: { title: "parity" },
  catalog: { node: { label: "Node", type: "service" } },
  system: { title: "parity", nodes: ["node"], wires: [] },
};
const v2Base = { dsl: "transition-diagram/2.0", meta: base.meta, catalog: base.catalog };
const cases = [
  ["valid", base],
  ["valid-v2-system-view", { ...v2Base, views: [{ id: "context", mode: "system", title: "Context", nodes: ["node"], wires: [] }] }],
  ["tone", { ...base, system: { ...base.system, boundaries: [{ id: "zone", label: "Zone", tone: 42, contains: ["node"] }] } }],
  ["unknown-wire", { ...base, system: { ...base.system, wires: [{ from: "node", to: "missing" }] } }],
  ["duplicate-view-state", { ...base, catalog: { ...base.catalog, app: { label: "App", type: "service" } }, views: [{ id: "migration", mode: "transition", states: [{ id: "same", title: "One", nodes: ["app"], wires: [] }, { id: "same", title: "Two", nodes: ["app"], wires: [] }] }] }],
  ["multiple-leaf-parents", { ...base, catalog: { ...base.catalog, app: { label: "App", type: "service" } }, packages: { one: { children: ["app"] }, two: { children: ["app"] } }, system: { title: "packages", nodes: ["app"], wires: [] } }],
  // FIX-008.2: malformed shapes must yield findings, never an exception or an internal-error fallback.
  ["malformed-boundary-null", { ...base, system: { ...base.system, boundaries: [null] } }],
  ["malformed-nodes-string", { ...base, system: { ...base.system, nodes: "node" } }],
  ["malformed-wires-null-entry", { ...base, system: { ...base.system, wires: [null] } }],
  ["malformed-catalog-list", { ...base, catalog: ["node"] }],
  ["malformed-package-child-list", { ...base, packages: { group: { label: "Group", children: [[]] } } }],
  ["malformed-comparison-null", { ...base, meta: { title: "parity", comparison: null } }],
  ["malformed-infrastructure-null", { ...base, views: [{ id: "production", mode: "deployment", nodes: ["node"], wires: [], deployment: { infrastructure: { host: null }, placements: [{ component: "node", target: "host" }] } }] }],
  ["malformed-flow-steps-string", { dsl: "transition-diagram/1.0", meta: base.meta, catalog: base.catalog, flow: { title: "flow", nodes: ["node"], wires: [], steps: "node" } }],
  ["malformed-steps-sequence-string", { dsl: "transition-diagram/1.0", meta: base.meta, catalog: base.catalog, steps: { base: { id: "start", title: "Start", nodes: ["node"], wires: [] }, sequence: "next" } }],
  // FIX-008.3: both validators must reject these, with the same rule names.
  ["catalog-level-number", { ...base, catalog: { node: { label: "Node", type: "service", level: 5 } } }, { invalid: true }],
  ["package-detail-number", { ...base, packages: { group: { label: "Group", children: ["node"], detail: 5 } } }, { invalid: true }],
  ["package-level-number", { ...base, packages: { group: { label: "Group", children: ["node"], level: 5 } } }, { invalid: true }],
  ["infrastructure-detail-number", { ...v2Base, views: [{ id: "production", mode: "deployment", title: "Production", nodes: ["node"], wires: [], deployment: { infrastructure: { host: { label: "Host", kind: "host", detail: 7 } }, placements: [{ component: "node", target: "host" }] } }] }, { invalid: true }],
  ["system-view-without-nodes", { ...v2Base, views: [{ id: "context", mode: "system", title: "Context" }] }, { invalid: true }],
  ["system-view-empty-nodes", { ...v2Base, views: [{ id: "context", mode: "system", title: "Context", nodes: [], wires: [] }] }, { invalid: true }],
  ["flow-view-without-steps", { ...v2Base, views: [{ id: "path", mode: "flow", title: "Path", nodes: ["node"], wires: [] }] }, { invalid: true }],
  ["duplicate-deployment-placement", { ...base, catalog: { ...base.catalog, app: { label: "App", type: "service" } }, views: [{ id: "production", mode: "deployment", nodes: ["app"], wires: [], deployment: { infrastructure: { host: {} }, placements: [{ component: "app", target: "host" }, { component: "app", target: "host" }] } }] }],
];
const scratch = mkdtempSync(join(tmpdir(), "diagram-validator-parity-"));
try {
  for (const [name, document, expectation] of cases) {
    const sourcePath = join(scratch, `${name}.json`);
    writeFileSync(sourcePath, JSON.stringify(document));
    let pythonFindings;
    try { pythonFindings = JSON.parse(execFileSync(python, [pythonScript, "--format", "json", sourcePath], { encoding: "utf8" }))[0]?.findings || []; }
    catch (error) {
      if (error.stdout) { try { pythonFindings = JSON.parse(error.stdout)[0]?.findings || []; } catch (parseError) { failures.push(`${name}: Python validator returned invalid JSON: ${parseError.message}`); continue; } }
      else { failures.push(`${name}: Python validator could not produce structured output: ${error.message}`); continue; }
    }
    let jsFindings;
    try { jsFindings = validator.validateDocument(document); }
    catch (error) { failures.push(`${name}: browser validator threw ${error.message}`); continue; }
    const pythonRules = [...new Set(pythonFindings.map(item => item.rule))].sort();
    if (pythonRules.includes("lint-internal-error")) failures.push(`${name}: Python lint fell back to lint-internal-error`);
    if (expectation?.invalid && (!pythonRules.length || !jsFindings.length)) failures.push(`${name}: expected both validators to reject it (python: ${pythonRules.join(",") || "none"}, browser: ${[...new Set(jsFindings.map(item => item.rule))].join(",") || "none"})`);
    const jsRules = [...new Set(jsFindings.map(item => item.rule))].sort();
    if (Boolean(pythonRules.length) !== Boolean(jsRules.length) || JSON.stringify(pythonRules) !== JSON.stringify(jsRules)) failures.push(`${name}: Python/JS rule sets differ (${pythonRules.join(",")} vs ${jsRules.join(",")})`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }

// FIX-008.1: the browser translator must build the same renderer model as the
// Python CLI for every v2 view mode, not reject the view's own id and title.
vm.runInContext(readFileSync(resolve(ROOT, "architecture-diagram-dsl/scripts/translate_transition_diagram.js"), "utf8"), context, { filename: "translate_transition_diagram.js" });
const translator = context.TransitionDiagramTranslator;
const pythonTranslator = resolve(ROOT, "architecture-diagram-dsl/scripts/translate_transition_diagram.py");
const v2Document = views => ({ dsl: "transition-diagram/2.0", meta: { title: "v2 parity" }, catalog: { a: { label: "A", type: "service" }, b: { label: "B", type: "database" } }, views });
const v2State = (id, wires) => ({ id, title: id.toUpperCase(), nodes: ["a", "b"], wires });
const translationCases = [
  ["v2-steps", v2Document([{ id: "migration", mode: "steps", title: "Migration", base: v2State("s0", []), sequence: [{ id: "s1", title: "Connect", add: { wires: ["a -> b: sql"] } }] }])],
  ["v2-transition", v2Document([{ id: "migration", mode: "transition", title: "Migration", states: [v2State("s0", []), v2State("s1", ["a -> b"])] }])],
  ["v2-scenarios", v2Document([{ id: "variants", mode: "scenarios", title: "Variants", base: v2State("base", ["a -> b"]), variants: [{ id: "alt", title: "Alt", remove: { wires: ["a -> b"] } }] }])],
  ["v2-deployment", v2Document([{ id: "production", mode: "deployment", title: "Production", nodes: ["a", "b"], wires: ["a -> b"], deployment: { infrastructure: { region: { label: "Region", kind: "region", children: ["host"] }, host: { label: "Host", kind: "host" } }, placements: [{ component: "a", target: "host", replicas: 2 }, { component: "b", target: "host" }] } }])],
];
const firstDifference = (left, right, path = "$") => {
  if (isDeepStrictEqual(left, right)) return null;
  if (left && right && typeof left === "object" && typeof right === "object") {
    for (const key of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const found = firstDifference(left[key], right[key], `${path}.${key}`);
      if (found) return found;
    }
  }
  return `${path}: python=${JSON.stringify(left)?.slice(0, 80)} browser=${JSON.stringify(right)?.slice(0, 80)}`;
};
const translationScratch = mkdtempSync(join(tmpdir(), "diagram-translator-parity-"));
try {
  for (const [name, document] of translationCases) {
    const sourcePath = join(translationScratch, `${name}.json`), outputPath = join(translationScratch, `${name}.model.json`);
    writeFileSync(sourcePath, JSON.stringify(document));
    try { execFileSync(python, [pythonTranslator, sourcePath, "--output", outputPath], { encoding: "utf8" }); }
    catch (error) { failures.push(`${name}: Python translator failed: ${String(error.stderr || error.message).split("\n")[0]}`); continue; }
    let browserModel;
    try { browserModel = JSON.parse(JSON.stringify(translator.translateDocument(document))); }
    catch (error) { failures.push(`${name}: browser translator threw: ${error.message}${error.findings ? ` (${error.findings.map(item => `${item.rule}@${item.path}`).slice(0, 2).join("; ")})` : ""}`); continue; }
    const difference = firstDifference(JSON.parse(readFileSync(outputPath, "utf8")), browserModel);
    if (difference) failures.push(`${name}: browser model differs from Python at ${difference}`);
  }
} finally { rmSync(translationScratch, { recursive: true, force: true }); }

if (failures.length) {
  failures.forEach(item => console.error(`✗ ${item}`));
  process.exit(1);
}
console.log("✓ browser validator parity checks passed without Chromium");
