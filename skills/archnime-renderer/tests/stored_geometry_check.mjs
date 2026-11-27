/* A delivered page shows the layouts stored in it, and nothing else lays it out.
 *
 * For each fixture this check builds the offline single-file page and walks it:
 * every stage, every wire style, collapsing and expanding each package, presenter
 * mode, then the documentation SVG and animated SVG exports. A multi-view bundle
 * is walked view by view. It holds that:
 *
 *   - the page loads with every network request refused, has no `window.dagre`
 *     and no `window.ELK`, and carries no placement code;
 *   - after each step, the layout the page holds is exactly what the runtime
 *     engine gives in Node for the same stage, expanded packages and wire style
 *     from the same stored geometry, and the painted wires are that layout's;
 *   - expanding a package again brings back the layout the stage opened with,
 *     and presenter mode moves no box;
 *   - a state with no stored layout fails with a message instead of laying out.
 *
 * Last, the `<architecture-diagram>` element is given a model and its geometry on
 * a host page that loads the runtime engine and no layout library: it must show
 * the stored layout, and refuse a model with no geometry or with another model's.
 *
 *   node skills/archnime-renderer/tests/stored_geometry_check.mjs [fixture-name]
 *
 * Covers FEAT-038 and TASK-039.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { loadHeadlessEngine } from "../scripts/headless_engine.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const TEMPLATE = resolve(HERE, "../assets/template.html");
const BUILDER = resolve(HERE, "../scripts/build_bundle.py");
const STORE = resolve(HERE, "../scripts/store_geometry.mjs");
const FIXTURES = [
  { name: "orders-failover-scenarios" },
  { name: "free-form-mesh" },
  { name: "checkout-flow" },
  { name: "deep-nested-crosscut" },
  { name: "orthogonal-routing" },
  { name: "nested-three-levels" },
  { name: "force-mesh-packages" },
  // Multi-view bundles: context, deployment and flow views; and a comparison of two options.
  { name: "commerce-views" },
  { name: "comparison-views", directory: resolve(HERE, "../assets/examples") },
].filter(fixture => !process.argv[2] || fixture.name.includes(process.argv[2]));
const required = process.env.REQUIRE_BROWSER_TESTS === "1";
const PLACEMENT = ["function dagreLayout", "function forceLayout", "function elkLayout", "function computeLayout", "function retryElk", "function collectGeometry", "ELKNode", "btn-retry-elk"];

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.log(`${required ? "FAIL" : "SKIP"} stored_geometry_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

// Runs in the page: walk the diagram and record, after each step, the layout it holds.
const WALK = async () => {
  const wait = ms => new Promise(done => setTimeout(done, ms));
  const settle = async () => { await wait(120); await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); };
  const until = async (settled, timeoutMs = 2500) => { const deadline = performance.now() + timeoutMs; while (performance.now() < deadline) { if (settled()) return true; await wait(40); } return settled(); };
  const routing = document.getElementById("routing-select"), steps = [], ignored = [];
  const boxes = () => JSON.stringify(window.__diagramLayoutForTest().nodes.map(node => [node.id, node.x, node.y, node.w, node.h]).sort());
  const record = (label, stageIndex) => {
    const layout = window.__diagramLayoutForTest();
    const expected = layout.wires.filter(wire => wire.visible !== false && wire.geom?.path).map(wire => wire.geom.path).sort(), painted = [...document.querySelectorAll("g.wire path.main")].map(path => path.getAttribute("d")).sort();
    steps.push({ label, stageIndex, routing: layout.routing, expanded: [...layout.expanded].sort(), layout: window.DiagramEngine.packLayout(layout), paintedIsLayout: JSON.stringify(expected) === JSON.stringify(painted), paintedNodes: document.querySelectorAll("g.nodes g.node").length, layoutNodes: layout.nodes.length });
  };
  // In a comparison the pills switch views, not stages; views are walked by the caller.
  const stageButtons = () => [...document.querySelectorAll("#pills button")].filter(button => !button.hidden && button.offsetParent !== null && !button.dataset.viewId);
  const count = Math.max(1, stageButtons().length);
  for (let index = 0; index < count; index += 1) {
    if (stageButtons()[index]) { stageButtons()[index].click(); await settle(); }
    const tag = `stage ${index + 1}`;
    record(tag, index);
    if (routing && !routing.disabled) {
      const start = routing.value;
      for (const mode of ["orthogonal", "direct", "curved", start]) {
        if (routing.value === mode) continue;
        routing.value = mode; routing.dispatchEvent(new Event("change", { bubbles: true })); await settle();
        record(`${tag} wires ${mode}`, index);
      }
    }
    // Collapse each expanded package and expand it again.
    for (const id of [...window.__diagramLayoutForTest().expanded].sort()) {
      const hit = [...document.querySelectorAll("g.package-hit")].find(element => element.__data__?.id === id);
      if (!hit) continue;
      hit.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      // A click can be held back briefly to tell it from a double click, so wait for its effect.
      // FIX-042: a collapse must take effect; in a flow view it used to wait for the next repaint.
      if (!(await until(() => !window.__diagramLayoutForTest().expanded.has(id)))) { ignored.push(`${tag} collapse ${id}`); continue; }
      await settle();
      record(`${tag} collapse ${id}`, index);
      const node = document.querySelector(`g.nodes g.node[data-id="${id}"]`);
      if (!node) continue;
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      await until(() => window.__diagramLayoutForTest().expanded.has(id));
      await settle();
      record(`${tag} expand ${id}`, index);
    }
  }
  // Presenter mode on, then off again: the boxes are read in both, after the repaint each toggle causes.
  const presenter = document.getElementById("btn-presenter"), presenterBoxes = {};
  if (presenter) { presenter.click(); await settle(); presenterBoxes.inside = boxes(); presenter.click(); await settle(); presenterBoxes.outside = boxes(); }
  const exports = { documentation: window.serializeDocumentationSvg ? window.serializeDocumentationSvg() : null, animated: window.serializeAnimatedSvg ? await window.serializeAnimatedSvg() : null };
  const engine = window.__diagramEngineForTest();
  let missing = null;
  try { engine.layoutStage({ id: "no-such-stage", nodes: [], wires: [] }); missing = "returned a layout"; } catch (error) { missing = String(error.message || error); }
  return { steps, ignored, presenterBoxes, exports: { documentation: (exports.documentation || "").slice(0, 5), documentationLength: (exports.documentation || "").length, animatedLength: (exports.animated || "").length }, stored: !!engine.stored, hasPlacementApi: ["collectGeometry", "retryElk", "prepareElk"].filter(name => name in engine), tuneShown: !!document.getElementById("btn-retry-elk"), dagre: typeof window.dagre, elk: typeof window.ELK, missing, findings: window.diagramSelfCheck({ displayed: true }).length };
};

const work = mkdtempSync(join(tmpdir(), "stored-geometry-"));
let browser, crashed = true;
const failures = [], lines = [];
try {
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  for (const fixture of FIXTURES) {
    const modelPath = join(fixture.directory || join(HERE, "fixtures"), `${fixture.name}.json`), geometryPath = join(work, `${fixture.name}.geometry.json`), html = join(work, `${fixture.name}.html`);
    execFileSync(process.execPath, [STORE, modelPath, "--output", geometryPath], { stdio: "pipe" });
    execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", modelPath, "--output", html, "--inline", "--offline", "--geometry", geometryPath], { stdio: "pipe" });
    const bundle = JSON.parse(readFileSync(modelPath, "utf8")), geometry = JSON.parse(readFileSync(geometryPath, "utf8")), source = readFileSync(html, "utf8");
    PLACEMENT.filter(text => source.includes(text)).forEach(text => failures.push(`${fixture.name}: the page still carries placement code (${text})`));
    const viewIds = Array.isArray(bundle.views) ? bundle.views.map(view => view.viewId) : [null];
    let compared = 0, readyMs = 0;
    for (const viewId of viewIds) {
      const fail = message => failures.push(`${fixture.name}${viewId ? ` view ${viewId}` : ""}: ${message}`);
      // Reduced motion makes every transition instant, so a snapshot is the settled state.
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
      const errors = [], requests = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await page.route(url => !/^(file|data|blob):/.test(url.href), route => { requests.push(route.request().url()); return route.abort(); });
      const started = Date.now();
      await page.goto(pathToFileURL(html).href + (viewId ? `?view=${encodeURIComponent(viewId)}` : ""), { waitUntil: "load", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      await page.evaluate(() => window.diagramReady);
      readyMs = Math.max(readyMs, Date.now() - started);
      await page.waitForTimeout(300);
      const walked = await page.evaluate(WALK);
      await page.close();

      errors.forEach(error => fail(`page error: ${error}`));
      requests.forEach(url => fail(`the page asked the network for ${url}`));
      if (!walked.stored) fail("the page's engine does not report stored geometry");
      if (walked.dagre !== "undefined" || walked.elk !== "undefined") fail(`the page has a layout library (dagre ${walked.dagre}, ELK ${walked.elk})`);
      if (walked.hasPlacementApi.length || walked.tuneShown) fail(`the page still offers placement (${walked.hasPlacementApi.join(", ") || "Tune button"})`);
      if (!/No stored geometry/.test(walked.missing)) fail(`a state with no stored layout did not fail clearly: ${walked.missing}`);
      walked.ignored.forEach(step => fail(`"${step}" had no effect on the layout the page holds`));
      if (walked.findings) fail(`${walked.findings} self-check finding(s) in the displayed layout`);
      if (walked.exports.documentation !== "<svg " || walked.exports.documentationLength < 2000 || walked.exports.animatedLength < 2000) fail(`an export is empty: ${JSON.stringify(walked.exports)}`);
      if (walked.presenterBoxes.inside !== walked.presenterBoxes.outside) fail("presenter mode moved node boxes");

      // The same steps on the runtime engine in Node, from the same geometry.
      const Runtime = loadHeadlessEngine(undefined, { runtime: true }), view = viewId ? bundle.views.find(candidate => candidate.viewId === viewId) : bundle;
      const engine = Runtime.create(Runtime.materializeView(bundle, view), { geometry: viewId ? geometry.views[viewId] : geometry });
      let differing = 0;
      for (const step of walked.steps) {
        compared += 1;
        if (!step.paintedIsLayout || step.paintedNodes !== step.layoutNodes) { fail(`"${step.label}": what is painted is not the layout the page holds`); continue; }
        engine.setRouting(step.routing);
        const expected = JSON.stringify(Runtime.packLayout(engine.layoutStage(engine.model.stages[step.stageIndex], false, new Set(step.expanded))));
        if (expected === JSON.stringify(step.layout)) continue;
        differing += 1;
        if (differing > 3) continue;
        const a = JSON.parse(expected), b = step.layout, part = Object.keys(a).find(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
        fail(`"${step.label}" differs from the runtime engine in Node in ${part}: ${JSON.stringify(a[part]).slice(0, 150)} against ${JSON.stringify(b[part]).slice(0, 150)}`);
      }
      if (differing > 3) fail(`${differing} steps differ in all`);
      // One layout per state: expanding a package again brings back exactly what the stage showed.
      // Geometry is compared, not the whole object: a reroute leaves bookkeeping fields behind (routeControlOffset).
      const box = item => [item.id, item.x, item.y, item.w, item.h], shape = layout => JSON.stringify({ expanded: layout.expanded, canvas: layout.canvas, nodes: layout.nodes.map(box), packages: layout.packages.map(box), boundaries: layout.boundaries.map(box), wires: layout.wires.map(wire => [wire.key, wire.visible, wire.geom ?? null, wire.lx ?? null, wire.ly ?? null]) });
      const opened = new Map(walked.steps.filter(step => /^stage \d+$/.test(step.label)).map(step => [step.label, shape(step.layout)]));
      walked.steps.filter(step => / expand /.test(step.label)).forEach(step => { if (shape(step.layout) !== opened.get(step.label.replace(/ expand .*/, ""))) fail(`"${step.label}" is not the layout the stage opened with`); });
    }
    lines.push(`${fixture.name}: ${viewIds.length > 1 ? `${viewIds.length} views, ` : ""}${compared} steps equal to the runtime engine in Node; ready in ${readyMs} ms; page ${(statSync(html).size / 1024).toFixed(0)} KB, of which geometry ${(statSync(geometryPath).size / 1024).toFixed(0)} KB`);
  }

  // The <architecture-diagram> element, on a host page with the runtime engine and no layout library.
  if (!process.argv[2]) {
    const SKILLS = resolve(HERE, "../.."), name = "nested-three-levels", other = "deep-nested-crosscut";
    for (const fixture of [name, other]) execFileSync(process.execPath, [STORE, join(HERE, "fixtures", `${fixture}.json`), "--output", join(work, `${fixture}.element.geometry.json`)], { stdio: "pipe" });
    const host = geometryName => `<!doctype html><meta charset="utf-8"><title>host</title>
<script src="/skills/archnime-renderer/assets/architecture-library.js"></script>
<script src="/skills/archnime-renderer/assets/vendor/d3.min.js"></script>
<script src="/skills/archnime-renderer/assets/diagram-runtime.js"></script>
<script src="/skills/archnime-renderer/assets/architecture-diagram-element.js"></script>
<architecture-diagram id="diagram" src="/skills/archnime-renderer/tests/fixtures/${name}.json"${geometryName === "none" ? "" : ` geometry-src="/work/${geometryName}.element.geometry.json"`}></architecture-diagram>`;
    const server = createServer((request, response) => {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname.startsWith("/host/")) { response.writeHead(200, { "Content-Type": "text/html" }); response.end(host(pathname.slice(6))); return; }
      const base = pathname.startsWith("/work/") ? work : pathname.startsWith("/skills/") ? SKILLS : null, path = base && resolve(base, `.${pathname.replace(/^\/(work|skills)/, "")}`);
      if (!path || !path.startsWith(`${base}${sep}`) || !existsSync(path)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
      response.end(readFileSync(path));
    });
    await new Promise(done => server.listen(0, "127.0.0.1", done));
    try {
      const open = async geometryName => {
        const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
        await page.goto(`http://127.0.0.1:${server.address().port}/host/${geometryName}`, { waitUntil: "load" });
        await page.waitForFunction(() => ["ready", "error"].includes(document.getElementById("diagram").diagramStatus), null, { timeout: 60000 });
        const result = await page.evaluate(() => {
          const element = document.getElementById("diagram"), runtime = element._runtime?.localWindow, layout = runtime?.__diagramLayoutForTest?.();
          return { status: element.diagramStatus, error: element.diagramError, dagre: typeof window.dagre, elk: typeof window.ELK, stored: !!runtime?.__diagramEngineForTest?.().stored, painted: element.shadowRoot.querySelectorAll("g.nodes g.node").length, layout: layout ? window.DiagramEngine.packLayout(layout) : null, findings: element.diagramStatus === "ready" ? element.diagramSelfCheck().length : null };
        });
        await page.close();
        return result;
      };
      const good = await open(name), stale = await open(other), none = await open("none");
      const expected = JSON.parse(readFileSync(join(work, `${name}.element.geometry.json`), "utf8")), firstStage = Object.keys(expected.states)[0];
      if (good.status !== "ready") failures.push(`element: status ${good.status} (${good.error})`);
      if (good.dagre !== "undefined" || good.elk !== "undefined") failures.push("element: the host page has a layout library, so the check proves nothing");
      if (!good.stored) failures.push("element: its engine does not report stored geometry");
      if (!Object.values(expected.states[firstStage]).some(index => JSON.stringify(expected.layouts[index]) === JSON.stringify(good.layout))) failures.push("element: the layout shown is not a stored layout of the first stage");
      if (!good.painted || good.findings !== 0) failures.push(`element: painted ${good.painted} node(s), ${good.findings} self-check finding(s)`);
      if (stale.status !== "error" || !/stored geometry/i.test(stale.error || "")) failures.push(`element: a geometry of another model gave status ${stale.status} (${stale.error}), expected a stored-geometry error`);
      if (none.status !== "error" || !/no stored geometry/i.test(none.error || "")) failures.push(`element: a model with no geometry gave status ${none.status} (${none.error}), expected a refusal`);
      lines.push(`element: ${good.painted} nodes from stored geometry with no layout library on the page; refused another model's geometry and a model with none`);
    } finally { server.close(); }
  }
  crashed = false;
} finally {
  if (browser) await browser.close();
  retainWork(work, "stored_geometry_check", crashed || failures.length > 0);
  rmSync(work, { recursive: true, force: true });
}

lines.forEach(line => console.log(line));
if (failures.length) {
  failures.forEach(failure => console.log(`FAIL ${failure}`));
  process.exit(1);
}
console.log("stored_geometry_check passed");
