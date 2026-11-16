/*
 * CASE-29: bound route fallbacks per model and wire style.
 *
 *   node tests/route_fallback_check.mjs                  # gate
 *   node tests/route_fallback_check.mjs --write-budgets  # record counts after review
 *
 * Opens every example and fixture bundle, switches each wire style, and counts
 * the visible wires whose route needed a fallback across every stage in the
 * default and fully expanded states. Counts are compared with
 * route-fallback-budgets.json (see route_fallback_budget.mjs). A fallback that
 * also carries an edge-crosses-* finding fails regardless of budget.
 */
import { execFileSync, execSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { MODES, compareBudgets, selfTest } from "./route_fallback_budget.mjs";
import { retainWork } from "./retain_artifacts.mjs";

selfTest();

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const RENDERER = resolve(HERE, "..");
const BUDGETS = join(HERE, "route-fallback-budgets.json");
const writeBudgets = process.argv.includes("--write-budgets");
const required = process.env.REQUIRE_BROWSER_TESTS === "1";

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.log(`${required ? "FAIL" : "SKIP"} route_fallback_check: Playwright/Chromium unavailable (gate logic self-test passed)`);
  process.exit(required ? 2 : 0);
}

const work = mkdtempSync(join(tmpdir(), "route-fallback-"));
cpSync(join(RENDERER, "assets"), work, { recursive: true });
// Keys carry their source so same-named example and fixture models stay distinct.
const models = [];
for (const [label, directory] of [["examples", join(RENDERER, "assets", "examples")], ["fixtures", join(HERE, "fixtures")]]) {
  for (const file of readdirSync(directory).filter(name => name.endsWith(".json")).sort()) models.push({ name: `${label}/${basename(file, ".json")}`, path: join(directory, file) });
}
// DSL examples that are not already generated as fixtures (Test System included).
const DSL = join(RENDERER, "..", "architecture-diagram-dsl");
const generated = new Set(readdirSync(join(HERE, "fixtures")).map(file => basename(file, ".json")));
for (const file of readdirSync(join(DSL, "assets", "examples")).filter(name => name.endsWith(".yaml")).sort()) {
  const stem = basename(file, ".yaml");
  if (generated.has(stem)) continue;
  const out = join(work, `dsl-${stem}.json`);
  execFileSync(PYTHON, [join(DSL, "scripts", "translate_transition_diagram.py"), join(DSL, "assets", "examples", file), "--output", out]);
  models.push({ name: `dsl/${stem}`, path: out });
}
let browser, crashed = true;
const measured = {};
try {
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  for (const { name, path } of models) {
    const html = join(work, `${name.replace("/", "-")}.html`);
    execFileSync(PYTHON, [join(RENDERER, "scripts", "build_bundle.py"), "--template", join(work, "template.html"), "--model", path, "--output", html]);
    const model = JSON.parse(readFileSync(path, "utf8")), views = Array.isArray(model.views) ? model.views.map(view => view.id) : [null];
    const result = { counts: Object.fromEntries(MODES.map(mode => [mode, 0])), withCrossing: [] };
    for (const view of views) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.clear());
      const url = pathToFileURL(html).href + (view ? `?view=${encodeURIComponent(view)}` : "");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      const outcome = await page.evaluate(async modes => {
        const engine = window.__diagramEngineForTest(), counts = {}, withCrossing = [];
        await engine.ready;
        const start = engine.routing;
        for (const mode of modes) {
          engine.setRouting(mode);
          counts[mode] = 0;
          for (const stage of engine.model.stages) for (const all of [false, true]) {
            const layout = engine.layoutStage(stage, all), issues = engine.checkLayout(stage, layout, ` [${mode}${all ? "/all" : ""}]`);
            for (const wire of layout.wires.filter(item => item.visible !== false && item.geom && item.routeFallback)) {
              counts[mode] += 1;
              const label = String(wire.label || wire.key);
              issues.filter(issue => issue.type.startsWith("edge-crosses") && String(issue.detail).includes(label)).forEach(issue => withCrossing.push({ mode, detail: `${stage.id} ${mode}: ${issue.detail}` }));
            }
          }
        }
        engine.setRouting(start);
        return { counts, withCrossing };
      }, MODES);
      for (const mode of MODES) result.counts[mode] += outcome.counts[mode];
      result.withCrossing.push(...outcome.withCrossing.map(entry => ({ mode: entry.mode, detail: (view ? `[${view}] ` : "") + entry.detail })));
      await page.close();
    }
    measured[name] = result;
    console.log(`${name.padEnd(34)} curved ${String(result.counts.curved).padStart(3)}  orthogonal ${String(result.counts.orthogonal).padStart(3)}  direct ${String(result.counts.direct).padStart(3)}`);
  }
  crashed = false;
} finally {
  await browser?.close();
  retainWork(work, "route-fallback", crashed);
  rmSync(work, { recursive: true, force: true });
}

if (writeBudgets) {
  const recorded = Object.fromEntries(Object.entries(measured).map(([name, result]) => {
    const crossings = {};
    for (const entry of result.withCrossing) crossings[entry.mode] = (crossings[entry.mode] || 0) + 1;
    return [name, { ...result.counts, ...(Object.keys(crossings).length ? { crossings } : {}) }];
  }));
  writeFileSync(BUDGETS, JSON.stringify({ $comment: "Recorded route-fallback counts per model and wire style (stages x default/all-expanded, summed over views). `crossings` records fallback routes that also cross a node, package, or boundary: known defects (for example CASE-08), ceilings that may only be lowered. Lower a number when a fix removes fallbacks; never raise one to hide a regression. Regenerate with: node skills/architecture-diagram-renderer/tests/route_fallback_check.mjs --write-budgets", budgets: recorded }, null, 2) + "\n");
  console.log(`wrote ${BUDGETS}`);
  process.exit(0);
}
const budgets = JSON.parse(readFileSync(BUDGETS, "utf8")).budgets;
const { failures, notes } = compareBudgets(measured, budgets);
notes.forEach(note => console.log(`note: ${note}`));
if (failures.length) { console.error(`FAIL route_fallback_check\n${failures.join("\n")}`); process.exit(1); }
console.log(`PASS route_fallback_check: ${models.length} model(s) within their recorded fallback budgets`);
