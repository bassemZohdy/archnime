/* Layout computed in Node equals layout computed in a browser.
 *
 * Layout is computed where the diagram is built: `store_geometry.mjs` runs the
 * whole engine in plain Node, with no `document`, and `translate.html` runs it in
 * a browser. Both must give the same geometry, or a diagram would depend on where
 * it was built. For each fixture this check:
 *
 *   1. computes the geometry in Node (every stage, every reachable expansion
 *      state, every view of a bundle);
 *   2. builds the page, loads the whole engine into it, and computes the same
 *      geometry there, with the page's own CSS tokens and a real `document`;
 *   3. fails when any value differs. Numbers are compared exactly, not rounded.
 *
 * It also checks that the geometry embedded in the page is the one Node computed
 * and that the layout painted on load is its opening state. Reports the time each
 * side took and the geometry size.
 *
 *   node skills/archnime-renderer/tests/headless_layout_check.mjs [fixture-name]
 *
 * Covers TASK-034 (the spike that showed this holds), TASK-036 and TASK-039.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { computeGeometry, geometryParts } from "../scripts/store_geometry.mjs";
import { injectFullEngine } from "./full_engine.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const TEMPLATE = resolve(HERE, "../assets/template.html");
const BUILDER = resolve(HERE, "../scripts/build_bundle.py");
const FIXTURES = [
  { name: "orders-failover-scenarios", shape: "flat" },
  { name: "deep-nested-crosscut", shape: "nested packages" },
  { name: "checkout-flow", shape: "flow" },
  { name: "orthogonal-routing", shape: "nested packages, ELK" },
  { name: "force-mesh-packages", shape: "nested packages, force" },
  { name: "free-form-mesh", shape: "free-form, no lanes" },
  { name: "nested-three-levels", shape: "three levels of packages" },
  { name: "commerce-views", shape: "bundle of three views" },
].filter(fixture => !process.argv[2] || fixture.name.includes(process.argv[2]));
const required = process.env.REQUIRE_BROWSER_TESTS === "1";

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

const work = mkdtempSync(join(tmpdir(), "headless-layout-"));
const failures = [], rows = [];
let browser, crashed = true;
try {
  const chromium = await loadChromium();
  if (!chromium) {
    console.log(`${required ? "FAIL" : "SKIP"} headless_layout_check: Playwright/Chromium unavailable`);
    if (required) failures.push("Playwright/Chromium unavailable");
  } else browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);

  for (const { name, shape } of FIXTURES) {
    const fail = message => failures.push(`${name}: ${message}`);
    const modelPath = join(HERE, "fixtures", `${name}.json`), model = JSON.parse(readFileSync(modelPath, "utf8"));
    // 1. Node
    const started = performance.now(), { geometry } = await computeGeometry(modelPath), nodeMs = performance.now() - started;
    const stored = geometry.views ? { views: Object.fromEntries(Object.entries(geometry.views).map(([id, part]) => [id, { states: part.states, layouts: part.layouts }])) } : { states: geometry.states, layouts: geometry.layouts };
    const parts = geometryParts(geometry), stateCount = parts.reduce((sum, part) => sum + Object.values(part.states).reduce((count, stage) => count + Object.keys(stage).length, 0), 0);
    if (!stateCount) fail("Node computed no layout state");
    const row = { name, shape, states: stateCount, engines: [...new Set(parts.flatMap(part => part.layouts.map(layout => layout.engine)))].join("/"), nodeMs, bytes: Buffer.byteLength(JSON.stringify(stored)), equal: "not compared" };
    rows.push(row);
    if (!browser) continue;

    // 2. the browser, in the built page
    const geometryPath = join(work, `${name}.geometry.json`), html = join(work, `${name}.html`);
    writeFileSync(geometryPath, JSON.stringify(geometry));
    execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", modelPath, "--output", html, "--inline", "--offline", "--geometry", geometryPath], { stdio: "pipe" });
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.goto(pathToFileURL(html).href, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
    await page.evaluate(() => window.diagramReady);
    const shown = await page.evaluate(() => ({ embedded: JSON.parse(document.getElementById("diagram-geometry").textContent), painted: window.DiagramEngine.packLayout(window.__diagramLayoutForTest()) }));
    await injectFullEngine(page);
    const inPage = await page.evaluate(async model => {
      const started = performance.now(), views = Array.isArray(model.views) ? model.views : null;
      // The options the page's renderer passes: a real document and its CSS tokens.
      const collect = merged => window.DiagramEngine.create(merged, { document, tokenRoot: document.documentElement, presenterRoot: document.body }).collectGeometry();
      let geometry;
      if (views) { geometry = { views: {} }; for (const view of views) geometry.views[view.viewId] = await collect(window.DiagramEngine.materializeView(model, view)); }
      else geometry = await collect(model);
      return { geometry, ms: performance.now() - started };
    }, model);
    await page.close();
    errors.forEach(error => fail(`page error ${error}`));

    // 3. compare
    const computed = difference(stored, inPage.geometry);
    if (computed.first) fail(`Node and the browser compute different geometry at ${computed.first} (largest numeric gap ${computed.maxDelta})`);
    const embedded = difference(stored, shown.embedded);
    if (embedded.first) fail(`the geometry embedded in the page is not the one Node computed: ${embedded.first}`);
    const opening = geometry.views ? geometry.views[model.views[0].viewId] : geometry, firstStage = Object.keys(opening.states)[0];
    if (!Object.values(opening.states[firstStage]).some(index => !difference(opening.layouts[index], shown.painted).first)) fail("the layout painted on load is not a stored state of the first stage");
    row.equal = computed.first || embedded.first ? "NO" : "yes";
    row.pageMs = inPage.ms;
  }
  crashed = false;
} finally {
  if (browser) await browser.close();
  retainWork(work, "headless_layout_check", crashed || failures.length > 0);
  rmSync(work, { recursive: true, force: true });
}

for (const row of rows) console.log(`${row.name} (${row.shape}): ${row.states} state(s), engine ${row.engines}, Node ${row.nodeMs.toFixed(0)} ms${row.pageMs === undefined ? "" : `, browser ${row.pageMs.toFixed(0)} ms`}, geometry ${(row.bytes / 1024).toFixed(0)} KB, equal: ${row.equal}`);
if (failures.length) {
  failures.forEach(failure => console.log(`FAIL ${failure}`));
  process.exit(1);
}
console.log("headless_layout_check passed");
