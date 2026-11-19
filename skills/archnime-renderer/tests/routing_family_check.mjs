/* FIX-023: the Wires control (Curved / Orthogonal / Direct) reaches every wire.
 *
 *   node skills/archnime-renderer/tests/routing_family_check.mjs
 *
 * For every example, fixture and DSL example, every view, stage, and the
 * default and fully expanded states, each visible wire must be drawn in the
 * family of the selected style: Curved as Bezier curves, Orthogonal as
 * axis-aligned runs, Direct as straight runs that are not a Manhattan elbow.
 * The same is checked on the painted page, through the template's own control,
 * while stepping through every stage or flow step: what the viewer sees.
 * A wire that keeps its style but crosses something is the route-fallback
 * gate's business (route_fallback_check.mjs), not this one's.
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { loadChromium } from "../scripts/export_snapshots.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const RENDERER = resolve(HERE, "..");
const DSL = join(RENDERER, "..", "archnime-dsl");
const MODES = ["curved", "orthogonal", "direct"];
const required = process.env.REQUIRE_BROWSER_TESTS === "1";

// Runs in the page: the family a geometry, or a painted path, belongs to.
const FAMILY = `
  const axisAligned = points => points.every((point, index) => !index || Math.abs(point.x - points[index - 1].x) < .6 || Math.abs(point.y - points[index - 1].y) < .6);
  const geometryFits = (geom, mode) => {
    if (!geom) return true;
    const curved = !!((geom.c1 && geom.c2) || geom.segments?.length), points = geom.points || [];
    if (mode === "curved") return curved;
    if (curved || points.length < 2) return false;
    if (mode === "orthogonal") return axisAligned(points);
    return !axisAligned(points) || points.length <= 2;
  };
  const pathFits = (d, mode) => {
    if (!d) return true;
    const curved = /[CcQqSsTt]/.test(d);
    if (mode === "curved") return curved;
    if (curved) return false;
    const numbers = (d.replace(/A[^MLHVZmlhvz]*/g, " ").match(/-?\\d*\\.?\\d+(e-?\\d+)?/g) || []).map(Number), points = [];
    for (let index = 0; index + 1 < numbers.length; index += 2) points.push({ x: numbers[index], y: numbers[index + 1] });
    if (mode === "orthogonal") return axisAligned(points);
    return !axisAligned(points) || points.length <= 2;
  };
`;

const chromium = await loadChromium();
if (!chromium) {
  console.log(`${required ? "FAIL" : "SKIP"} routing_family_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

const work = mkdtempSync(join(tmpdir(), "routing-family-"));
cpSync(join(RENDERER, "assets"), work, { recursive: true });
const models = [];
for (const [label, directory] of [["examples", join(RENDERER, "assets", "examples")], ["fixtures", join(HERE, "fixtures")]]) {
  for (const file of readdirSync(directory).filter(name => name.endsWith(".json")).sort()) models.push({ name: `${label}/${basename(file, ".json")}`, path: join(directory, file) });
}
const generated = new Set(readdirSync(join(HERE, "fixtures")).map(file => basename(file, ".json")));
for (const file of readdirSync(join(DSL, "assets", "examples")).filter(name => name.endsWith(".yaml")).sort()) {
  const stem = basename(file, ".yaml");
  if (generated.has(stem)) continue;
  const out = join(work, `dsl-${stem}.json`);
  execFileSync(PYTHON, [join(DSL, "scripts", "translate_transition_diagram.py"), join(DSL, "assets", "examples", file), "--output", out]);
  models.push({ name: `dsl/${stem}`, path: out });
}

const failures = [];
let browser, checked = 0;
try {
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  for (const { name, path } of models) {
    const html = join(work, `${name.replace("/", "-")}.html`);
    execFileSync(PYTHON, [join(RENDERER, "scripts", "build_bundle.py"), "--template", join(work, "template.html"), "--model", path, "--output", html]);
    const model = JSON.parse(readFileSync(path, "utf8")), views = Array.isArray(model.views) ? model.views.map(view => view.id) : [null];
    const before = failures.length;
    for (const view of views) {
      const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.clear());
      await page.goto(pathToFileURL(html).href + (view ? `?view=${encodeURIComponent(view)}` : ""), { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      await page.evaluate(() => window.diagramReady);
      const outcome = await page.evaluate(`(async modes => {
        ${FAMILY}
        const sleep = ms => new Promise(done => setTimeout(done, ms)), problems = [];
        let count = 0;
        // 1. The painted page, through the Wires control, stage by stage.
        const select = document.getElementById("routing-select");
        for (const mode of [...modes.slice(1), modes[0]]) {
          select.value = mode; select.dispatchEvent(new Event("change")); await sleep(30);
          document.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true })); await sleep(60);
          for (let step = 0; step < 60; step += 1) {
            for (const group of document.querySelectorAll("g.wire[data-wire-key]")) {
              if (getComputedStyle(group).display === "none") continue;
              const d = group.querySelector("path.main")?.getAttribute("d");
              count += 1;
              if (!pathFits(d, mode)) problems.push(mode + " painted step " + step + ": " + group.getAttribute("data-wire-key") + " is not drawn " + mode);
            }
            const next = document.getElementById("btn-next");
            if (!next || next.disabled) break;
            next.click(); await sleep(60);
          }
        }
        // 2. The engine's layouts, for every stage and expansion state. This runs
        // last: switching the engine directly reroutes cached layouts in place
        // without repainting, which would leave the page out of date.
        const engine = window.__diagramEngineForTest();
        await engine.ready;
        const start = engine.routing;
        for (const mode of modes) {
          engine.setRouting(mode);
          for (const stage of engine.model.stages) for (const all of [false, true]) {
            const layout = engine.layoutStage(stage, all);
            for (const wire of layout.wires.filter(item => item.visible !== false && item.geom)) {
              count += 1;
              if (!geometryFits(wire.geom, mode)) problems.push(mode + " " + stage.id + (all ? "/all" : "") + ": " + wire.key + " is laid out as " + (wire.actualRouting || "?") + " (" + wire.routeMode + ")");
            }
          }
        }
        engine.setRouting(start);
        return { problems: [...new Set(problems)], count };
      })(${JSON.stringify(MODES)})`);
      checked += outcome.count;
      failures.push(...outcome.problems.map(problem => `${name}${view ? ` [${view}]` : ""}: ${problem}`));
      await page.close();
    }
    console.log(`${failures.length === before ? "✓" : "✗"} ${name}`);
  }
} finally {
  await browser?.close();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) { console.error(`\nFAIL routing_family_check: ${failures.length} wire(s) do not follow the selected style\n${failures.join("\n")}`); process.exit(1); }
console.log(`\nPASS routing_family_check: ${models.length} model(s), ${checked} wire drawings, all in the selected style`);
