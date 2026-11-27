/* TASK-034 spike: can the layout engine produce a stage's geometry before the page exists?
 *
 * Runs `DiagramEngine.layoutStage` in plain Node (no DOM, no browser) on existing
 * fixtures - one flat, one with nested packages, one flow, plus one laid out by
 * ELK and one by the force engine - and writes
 * the geometry of every stage as JSON. Then builds the offline page for the same
 * fixture, asks the engine inside that page for the same stages, and fails when
 * the two geometries differ. It also compares the layout the page actually
 * painted on load with the headless geometry of that stage.
 *
 * Reports, per fixture: headless layout time, geometry size, and whether the
 * headless result equals the in-page result.
 *
 *   node skills/archnime-renderer/tests/headless_layout_check.mjs [--out <dir>]
 *
 * `--out` keeps the geometry JSON (default: a temporary folder, removed after).
 * The headless half always runs; the comparison needs Playwright/Chromium and
 * is skipped without it unless REQUIRE_BROWSER_TESTS=1.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { PYTHON } from "../../../scripts/python_command.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ASSETS = resolve(HERE, "../assets");
const TEMPLATE = join(ASSETS, "template.html");
const BUILDER = resolve(HERE, "../scripts/build_bundle.py");
const FIXTURES = [
  { name: "orders-failover-scenarios", shape: "flat" },
  { name: "deep-nested-crosscut", shape: "nested packages" },
  { name: "checkout-flow", shape: "flow" },
  // Beyond the three the task names: the two layout engines the others do not reach.
  { name: "orthogonal-routing", shape: "nested packages, ELK" },
  { name: "force-mesh-packages", shape: "nested packages, force" },
];
const required = process.env.REQUIRE_BROWSER_TESTS === "1";
const outFlag = process.argv.indexOf("--out");
const keep = outFlag > -1 ? resolve(process.argv[outFlag + 1] || "") : null;

/* The engine and its libraries are plain browser globals. Load them into one
 * fresh context that has no `document`, exactly as a build step would: the engine then measures text from its pinned advance table and takes
 * sizes from its static tokens. */
export function loadHeadlessEngine() {
  const sandbox = { console, setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask, performance };
  // `window` is only the name the scripts hang their globals on; there is still no
  // `document`. No `self`: with `self` and no `document` the pinned ELK bundle takes
  // itself for a web worker and exposes no in-process layout.
  sandbox.globalThis = sandbox; sandbox.window = sandbox;
  const context = vm.createContext(sandbox);
  for (const file of ["vendor/d3.min.js", "vendor/dagre.min.js", "vendor/elk.bundled.js", "architecture-library.js", "diagram-engine.js"]) {
    vm.runInContext(readFileSync(join(ASSETS, file), "utf8"), context, { filename: file });
  }
  for (const name of ["d3", "dagre", "ELK", "ARCHITECTURE_LIBRARY", "DiagramEngine"]) {
    if (!sandbox[name]) throw new Error(`headless context is missing ${name}`);
  }
  return sandbox.DiagramEngine;
}

/* What a stored geometry would hold: everything the page paints from a layout.
 * Source of this function is also evaluated in the page, so both sides are
 * reduced by the same code. Numbers keep full precision: "equal" means equal. */
const GEOMETRY_SOURCE = `layout => {
  const box = item => ({ id: item.id, x: item.x, y: item.y, w: item.w, h: item.h });
  const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  return JSON.parse(JSON.stringify({
    engine: layout.engine ?? null,
    canvas: layout.canvas ?? null,
    expanded: [...(layout.expanded || [])].sort(),
    nodes: (layout.nodes || []).map(box).sort(byId),
    packages: (layout.packages || []).map(box).sort(byId),
    boundaries: (layout.boundaries || []).map(box).sort(byId),
    wires: (layout.wires || []).filter(wire => wire.visible !== false).map(wire => ({ key: wire.key, geom: wire.geom ?? null, reverseGeom: wire.reverseGeom ?? null, lx: wire.lx ?? null, ly: wire.ly ?? null, requestedRouting: wire.requestedRouting ?? null, actualRouting: wire.actualRouting ?? null })),
  }));
}`;
const geometryOf = vm.runInNewContext(`(${GEOMETRY_SOURCE})`);

// First path where two JSON values differ, with the largest numeric gap seen.
function difference(a, b, path = "$", state = { first: null, maxDelta: 0 }) {
  if (typeof a === "number" && typeof b === "number") {
    if (a !== b) { state.first ||= `${path}: ${a} != ${b}`; state.maxDelta = Math.max(state.maxDelta, Math.abs(a - b)); }
  } else if (a && b && typeof a === "object" && typeof b === "object") {
    for (const key of new Set([...Object.keys(a), ...Object.keys(b)])) difference(a[key], b[key], `${path}.${key}`, state);
  } else if (a !== b) state.first ||= `${path}: ${JSON.stringify(a)} != ${JSON.stringify(b)}`;
  return state;
}

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

const work = keep || mkdtempSync(join(tmpdir(), "headless-layout-"));
mkdirSync(work, { recursive: true });
const failures = [], rows = [];
let browser;
try {
  // 1. Headless: geometry for every stage of every fixture, as JSON.
  const headless = new Map();
  for (const { name, shape } of FIXTURES) {
    const model = JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.json`), "utf8"));
    const started = performance.now();
    const DiagramEngine = loadHeadlessEngine();
    const stages = [];
    for (let index = 0; index < model.stages.length; index += 1) {
      stages.push({ stage: model.stages[index].id, geometry: geometryOf(await DiagramEngine.layoutStage(model, index)) });
    }
    const ms = performance.now() - started, json = JSON.stringify({ fixture: name, stages });
    writeFileSync(join(work, `${name}.geometry.json`), json);
    stages.forEach(({ stage, geometry }) => { if (!geometry.nodes.length) failures.push(`${name}/${stage}: headless layout returned no nodes`); });
    headless.set(name, { model, stages });
    rows.push({ name, shape, stages: stages.length, nodes: stages[0].geometry.nodes.length, engine: stages.map(item => item.geometry.engine).join("/"), ms, bytes: Buffer.byteLength(json), equal: "not compared" });
  }

  // 2. In the page: the same stages from the engine the page loads.
  const chromium = await loadChromium();
  if (!chromium) {
    console.log(`${required ? "FAIL" : "SKIP"} headless_layout_check comparison: Playwright/Chromium unavailable`);
    if (required) failures.push("Playwright/Chromium unavailable");
  } else {
    browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
    for (const row of rows) {
      const { model, stages } = headless.get(row.name);
      const html = join(work, `${row.name}.html`);
      execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", join(HERE, "fixtures", `${row.name}.json`), "--output", html, "--inline", "--offline"]);
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
      const errors = [];
      page.on("pageerror", error => errors.push(String(error)));
      await page.goto(pathToFileURL(html).href, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      await page.evaluate(() => window.diagramReady);
      const inPage = await page.evaluate(`(async model => {
        const geometryOf = ${GEOMETRY_SOURCE};
        // The same options template.html passes when it creates its engine.
        const options = { document, tokenRoot: document.documentElement, presenterRoot: document.body };
        const stages = [];
        for (let index = 0; index < model.stages.length; index += 1) stages.push(geometryOf(await window.DiagramEngine.layoutStage(model, index, options)));
        const painted = window.__diagramLayoutForTest && window.__diagramLayoutForTest();
        return { stages, painted: painted ? { stage: painted.stage?.id ?? painted.stageId ?? null, geometry: geometryOf(painted) } : null };
      })(${JSON.stringify(model)})`);
      await page.close();
      errors.forEach(error => failures.push(`${row.name}: page error ${error}`));
      const diffs = [];
      stages.forEach(({ stage, geometry }, index) => {
        const result = difference(geometry, inPage.stages[index]);
        if (result.first) diffs.push(`${stage}: headless and in-page geometry differ at ${result.first} (largest numeric gap ${result.maxDelta})`);
      });
      // The layout the page painted on load must be one of the stored stages.
      if (!inPage.painted) diffs.push("page exposes no painted layout");
      else if (!stages.some(({ geometry }) => !difference(geometry, inPage.painted.geometry).first)) {
        const nearest = stages.map(({ stage, geometry }) => ({ stage, ...difference(geometry, inPage.painted.geometry) })).sort((a, b) => a.maxDelta - b.maxDelta)[0];
        diffs.push(`painted layout matches no headless stage; nearest ${nearest.stage} differs at ${nearest.first}`);
      }
      row.equal = diffs.length ? "NO" : "yes";
      diffs.forEach(diff => failures.push(`${row.name}/${diff}`));
    }
  }
} finally {
  if (browser) await browser.close();
  if (!keep) rmSync(work, { recursive: true, force: true });
}

for (const row of rows) console.log(`${row.name} (${row.shape}): ${row.stages} stage(s), ${row.nodes} node(s), engine ${row.engine}, headless ${row.ms.toFixed(0)} ms, geometry ${row.bytes} bytes, equals in-page: ${row.equal}`);
if (keep) console.log(`geometry written to ${keep}`);
if (failures.length) {
  failures.forEach(failure => console.log(`FAIL ${failure}`));
  process.exit(1);
}
console.log("headless_layout_check passed");
