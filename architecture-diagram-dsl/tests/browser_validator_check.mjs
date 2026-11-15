/* Pure Node regression checks for the browser validator; Chromium is not required. */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import vm from "node:vm";

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

const python = process.env.PYTHON || "python3";
const pythonScript = resolve(ROOT, "architecture-diagram-dsl/scripts/validate_transition_diagram.py");
const base = {
  dsl: "transition-diagram/1.0",
  meta: { title: "parity" },
  catalog: { node: { label: "Node", type: "service" } },
  system: { title: "parity", nodes: ["node"], wires: [] },
};
const cases = [
  ["valid", base],
  ["tone", { ...base, system: { ...base.system, boundaries: [{ id: "zone", label: "Zone", tone: 42, contains: ["node"] }] } }],
  ["unknown-wire", { ...base, system: { ...base.system, wires: [{ from: "node", to: "missing" }] } }],
  ["duplicate-view-state", { ...base, catalog: { ...base.catalog, app: { label: "App", type: "service" } }, views: [{ id: "migration", mode: "transition", states: [{ id: "same", title: "One", nodes: ["app"], wires: [] }, { id: "same", title: "Two", nodes: ["app"], wires: [] }] }] }],
  ["multiple-leaf-parents", { ...base, catalog: { ...base.catalog, app: { label: "App", type: "service" } }, packages: { one: { children: ["app"] }, two: { children: ["app"] } }, system: { title: "packages", nodes: ["app"], wires: [] } }],
  ["duplicate-deployment-placement", { ...base, catalog: { ...base.catalog, app: { label: "App", type: "service" } }, views: [{ id: "production", mode: "deployment", nodes: ["app"], wires: [], deployment: { infrastructure: { host: {} }, placements: [{ component: "app", target: "host" }, { component: "app", target: "host" }] } }] }],
];
const scratch = mkdtempSync(join(tmpdir(), "diagram-validator-parity-"));
try {
  for (const [name, document] of cases) {
    const sourcePath = join(scratch, `${name}.json`);
    writeFileSync(sourcePath, JSON.stringify(document));
    let pythonFindings;
    try { pythonFindings = JSON.parse(execFileSync(python, [pythonScript, "--format", "json", sourcePath], { encoding: "utf8" }))[0]?.findings || []; }
    catch (error) {
      if (error.stdout) { try { pythonFindings = JSON.parse(error.stdout)[0]?.findings || []; } catch (parseError) { failures.push(`${name}: Python validator returned invalid JSON: ${parseError.message}`); continue; } }
      else { failures.push(`${name}: Python validator could not produce structured output: ${error.message}`); continue; }
    }
    const jsFindings = validator.validateDocument(document);
    const pythonRules = [...new Set(pythonFindings.map(item => item.rule))].sort();
    const jsRules = [...new Set(jsFindings.map(item => item.rule))].sort();
    if (Boolean(pythonRules.length) !== Boolean(jsRules.length) || JSON.stringify(pythonRules) !== JSON.stringify(jsRules)) failures.push(`${name}: Python/JS rule sets differ (${pythonRules.join(",")} vs ${jsRules.join(",")})`);
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }

if (failures.length) {
  failures.forEach(item => console.error(`✗ ${item}`));
  process.exit(1);
}
console.log("✓ browser validator parity checks passed without Chromium");
