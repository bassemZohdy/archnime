/* FEAT-038: a page built from stored geometry shows what the page that lays out
 * at runtime shows, with the layout libraries absent.
 *
 * For each fixture it computes the geometry (`store_geometry.mjs`), builds the
 * page twice, once the usual way and once with `--geometry`, and drives both
 * through the same steps: every stage, every wire style, collapsing and
 * expanding each package, presenter mode, then the documentation SVG and the
 * animated SVG exports. After each step the layout the page holds and what it
 * painted (node positions, wire paths, package outlines) must be identical in
 * both, and so must the exported files. A multi-view bundle is walked view by
 * view.
 *
 * Last, the `<architecture-diagram>` element is given a model and its geometry on
 * a host page that loads neither dagre nor ELK: it must show the stored layout,
 * and report a geometry that belongs to another model instead of laying out.
 *
 * The stored page is offline and inline, every network request is refused, and
 * `window.dagre` and `window.ELK` must be undefined: it renders with the layout
 * libraries blocked. It must not offer Tune, and asking its engine for a state
 * that was not stored must fail with a message, not fall back to layout.
 *
 *   node skills/archnime-renderer/tests/stored_geometry_check.mjs [fixture-name]
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const TEMPLATE = resolve(HERE, "../assets/template.html");
const BUILDER = resolve(HERE, "../scripts/build_bundle.py");
const STORE = resolve(HERE, "../scripts/store_geometry.mjs");
// historyDependent: the runtime force layout starts each simulation from where the
// nodes last were, so what it shows after a collapse depends on the clicks before
// it, and expanding again does not bring the first layout back. Stored geometry
// has one layout per state. For such a fixture only the steps before the first
// collapse are compared with the runtime page.
const FIXTURES = [
  { name: "orders-failover-scenarios" },
  { name: "free-form-mesh" },
  { name: "checkout-flow" },
  { name: "deep-nested-crosscut" },
  { name: "orthogonal-routing" },
  { name: "nested-three-levels" },
  { name: "force-mesh-packages", historyDependent: true },
  // Multi-view bundles: context, deployment and flow views; and a comparison of two options.
  { name: "commerce-views" },
  { name: "comparison-views", directory: resolve(HERE, "../assets/examples") },
].filter(fixture => !process.argv[2] || fixture.name.includes(process.argv[2]));
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
  console.log(`${required ? "FAIL" : "SKIP"} stored_geometry_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

// Runs in the page: walk the diagram and record the layout and the paint after each step.
const WALK = async () => {
  const wait = ms => new Promise(done => setTimeout(done, ms));
  const settle = async () => { await wait(120); await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done))); };
  const until = async (settled, timeoutMs = 2500) => { const deadline = performance.now() + timeoutMs; while (performance.now() < deadline) { if (settled()) return true; await wait(40); } return settled(); };
  const box = item => [item.id, item.x, item.y, item.w, item.h];
  const snapshot = () => {
    const layout = window.__diagramLayoutForTest();
    return JSON.stringify({
      engine: layout.engine, canvas: layout.canvas, expanded: [...layout.expanded].sort(),
      nodes: layout.nodes.map(box).sort(), packages: layout.packages.map(box).sort(), boundaries: layout.boundaries.map(box).sort(),
      wires: layout.wires.filter(wire => wire.visible !== false).map(wire => [wire.key, wire.geom?.path ?? null, wire.lx ?? null, wire.ly ?? null, wire.actualRouting ?? null]),
      paintedNodes: [...document.querySelectorAll("g.nodes g.node")].map(node => [node.getAttribute("data-id"), node.getAttribute("transform")]).sort(),
      paintedWires: [...document.querySelectorAll("g.wire path.main")].map(path => path.getAttribute("d")).sort(),
      paintedPackages: [...document.querySelectorAll("g.package-outline rect")].map(rect => ["x", "y", "width", "height"].map(name => rect.getAttribute(name)).join(",")).sort(),
    });
  };
  const steps = [], record = label => steps.push([label, snapshot()]);
  // In a comparison the pills switch views, not stages; views are walked by the caller.
  const stageButtons = () => [...document.querySelectorAll("#pills button")].filter(button => !button.hidden && button.offsetParent !== null && !button.dataset.viewId);
  const count = Math.max(1, stageButtons().length), routing = document.getElementById("routing-select");
  for (let index = 0; index < count; index += 1) {
    if (stageButtons()[index]) { stageButtons()[index].click(); await settle(); }
    const tag = `stage ${index + 1}`;
    record(tag);
    if (routing && !routing.disabled) {
      const start = routing.value;
      for (const mode of ["orthogonal", "direct", "curved", start]) {
        if (routing.value === mode) continue;
        routing.value = mode; routing.dispatchEvent(new Event("change", { bubbles: true })); await settle();
        record(`${tag} wires ${mode}`);
      }
    }
    // Collapse each expanded package and expand it again, outermost last.
    const expanded = [...window.__diagramLayoutForTest().expanded].sort();
    for (const id of expanded) {
      const hit = [...document.querySelectorAll("g.package-hit")].find(element => element.__data__?.id === id);
      if (!hit) continue;
      hit.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      // A click can be held back briefly to tell it from a double click, so wait for its effect.
      if (!(await until(() => !window.__diagramLayoutForTest().expanded.has(id)))) continue;
      await settle();
      record(`${tag} collapse ${id}`);
      const node = document.querySelector(`g.nodes g.node[data-id="${id}"]`);
      if (!node) continue;
      node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
      await until(() => window.__diagramLayoutForTest().expanded.has(id));
      await settle();
      record(`${tag} expand ${id}`);
    }
  }
  const presenter = document.getElementById("btn-presenter");
  // Presenter mode on, then off again: the boxes are read in both, after the repaint each toggle causes.
  const boxes = () => JSON.stringify(window.__diagramLayoutForTest().nodes.map(box).sort());
  if (presenter) { presenter.click(); await settle(); steps.push(["presenter boxes", boxes()]); presenter.click(); await settle(); steps.push(["after presenter boxes", boxes()]); }
  // Exports are made from the layouts, so they must not differ either.
  if (window.serializeDocumentationSvg) steps.push(["documentation svg", window.serializeDocumentationSvg()]);
  if (window.serializeAnimatedSvg) steps.push(["animated svg", await window.serializeAnimatedSvg()]);
  const engine = window.__diagramEngineForTest();
  let missing = null;
  try { engine.layoutStage({ id: "no-such-stage", nodes: [], wires: [] }); missing = "returned a layout"; } catch (error) { missing = String(error.message || error); }
  return { steps, stored: !!engine.stored, tuneAvailable: !!engine.tuneAvailable, tuneShown: !!document.getElementById("btn-retry-elk") && !document.getElementById("btn-retry-elk").hidden, dagre: typeof window.dagre, elk: typeof window.ELK, missing, status: document.getElementById("status")?.textContent || "" };
};

const work = mkdtempSync(join(tmpdir(), "stored-geometry-"));
let browser, crashed = true;
const failures = [], lines = [];
try {
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  for (const fixture of FIXTURES) {
    const fail = message => failures.push(`${fixture.name}: ${message}`);
    const model = join(fixture.directory || join(HERE, "fixtures"), `${fixture.name}.json`), geometry = join(work, `${fixture.name}.geometry.json`);
    const runtimeHtml = join(work, `${fixture.name}.runtime.html`), storedHtml = join(work, `${fixture.name}.stored.html`);
    execFileSync(process.execPath, [STORE, model, "--output", geometry], { stdio: "pipe" });
    execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", model, "--output", runtimeHtml, "--inline", "--offline"], { stdio: "pipe" });
    execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", model, "--output", storedHtml, "--inline", "--offline", "--geometry", geometry], { stdio: "pipe" });

    const bundle = JSON.parse(readFileSync(model, "utf8")), viewIds = Array.isArray(bundle.views) ? bundle.views.map(view => view.viewId) : [null];
    const run = async (html, blockNetwork, viewId) => {
      // Reduced motion makes every transition instant, so a snapshot is the settled state.
      const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
      const errors = [], requests = [];
      page.on("pageerror", error => errors.push(String(error)));
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      if (blockNetwork) await page.route(url => !/^(file|data|blob):/.test(url.href), route => { requests.push(route.request().url()); return route.abort(); });
      const started = Date.now();
      await page.goto(pathToFileURL(html).href + (viewId ? `?view=${encodeURIComponent(viewId)}` : ""), { waitUntil: "load", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      await page.evaluate(() => window.diagramReady);
      const readyMs = Date.now() - started;
      await page.waitForTimeout(300);
      const result = await page.evaluate(WALK);
      await page.close();
      return { ...result, errors, requests, readyMs };
    };
    let totalCompared = 0, totalSteps = 0, storedReady = 0, runtimeReady = 0;
    for (const viewId of viewIds) {
    const fail = message => failures.push(`${fixture.name}${viewId ? ` view ${viewId}` : ""}: ${message}`);
    const runtime = await run(runtimeHtml, false, viewId), stored = await run(storedHtml, true, viewId);

    stored.errors.forEach(error => fail(`stored page error: ${error}`));
    stored.requests.forEach(url => fail(`stored page asked the network for ${url}`));
    if (!stored.stored) fail("the stored page's engine does not report stored geometry");
    if (stored.dagre !== "undefined" || stored.elk !== "undefined") fail(`the stored page still has a layout library (dagre ${stored.dagre}, ELK ${stored.elk})`);
    if (stored.tuneAvailable || stored.tuneShown) fail("the stored page still offers Tune layout");
    if (!/No stored geometry/.test(stored.missing)) fail(`a state with no stored layout did not fail clearly: ${stored.missing}`);
    if (runtime.stored) fail("the runtime page unexpectedly reports stored geometry");
    if (runtime.steps.length !== stored.steps.length) fail(`walk length differs: runtime ${runtime.steps.length} steps, stored ${stored.steps.length}`);
    let differing = 0, compared = 0;
    const firstCollapse = runtime.steps.findIndex(([label]) => / collapse /.test(label));
    runtime.steps.forEach(([label, expected], index) => {
      const [storedLabel, actual] = stored.steps[index] || [];
      if (label === "presenter boxes") return; // presenter mode is checked on the stored page alone, below
      if (fixture.historyDependent && firstCollapse > -1 && index >= firstCollapse) return;
      compared += 1;
      if (storedLabel !== label) { fail(`step ${index} is "${storedLabel}" on the stored page and "${label}" on the runtime page`); return; }
      if (actual === expected) return;
      differing += 1;
      const a = JSON.parse(expected), b = JSON.parse(actual), part = Object.keys(a).find(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]));
      if (differing <= 4) fail(`"${label}" differs in ${part}: runtime ${JSON.stringify(a[part]).slice(0, 160)} stored ${JSON.stringify(b[part]).slice(0, 160)}`);
    });
    if (differing > 4) fail(`${differing} steps differ in all`);
    // One layout per state: expanding a package again brings back exactly what the stage showed.
    const stageShot = new Map(stored.steps.filter(([label]) => /^stage \d+$/.test(label)));
    stored.steps.filter(([label]) => / expand /.test(label)).forEach(([label, shot]) => { if (shot !== stageShot.get(label.replace(/ expand .*/, ""))) fail(`"${label}" on the stored page is not the layout the stage opened with`); });
    // Presenter mode reuses the stored geometry: boxes do not move.
    const presenter = stored.steps.find(([label]) => label === "presenter boxes"), after = stored.steps.find(([label]) => label === "after presenter boxes");
    if (presenter && after && presenter[1] !== after[1]) fail(`presenter mode moved node boxes on the stored page: ${presenter[1].slice(0, 200)} against ${after[1].slice(0, 200)} outside it`);
    totalCompared += compared; totalSteps += stored.steps.length - 1; storedReady = Math.max(storedReady, stored.readyMs); runtimeReady = Math.max(runtimeReady, runtime.readyMs);
    }
    lines.push(`${fixture.name}: ${viewIds.length > 1 ? `${viewIds.length} views, ` : ""}${totalCompared} of ${totalSteps} steps compared with the runtime page, all equal${fixture.historyDependent ? " (runtime depends on click history after a collapse)" : ""}; ready in ${storedReady} ms stored, ${runtimeReady} ms runtime; page ${(statSync(storedHtml).size / 1024).toFixed(0)} KB stored, ${(statSync(runtimeHtml).size / 1024).toFixed(0)} KB runtime; geometry ${(statSync(geometry).size / 1024).toFixed(0)} KB`);
  }

  // The <architecture-diagram> element with stored geometry, on a host page with no layout library.
  if (!process.argv[2]) {
    const SKILLS = resolve(HERE, "../.."), name = "nested-three-levels", other = "deep-nested-crosscut";
    for (const fixture of [name, other]) execFileSync(process.execPath, [STORE, join(HERE, "fixtures", `${fixture}.json`), "--output", join(work, `${fixture}.element.geometry.json`)], { stdio: "pipe" });
    const host = (geometryName) => `<!doctype html><meta charset="utf-8"><title>host</title>
<script src="/skills/archnime-renderer/assets/architecture-library.js"></script>
<script src="/skills/archnime-renderer/assets/vendor/d3.min.js"></script>
<script src="/skills/archnime-renderer/assets/diagram-engine.js"></script>
<script src="/skills/archnime-renderer/assets/architecture-diagram-element.js"></script>
<architecture-diagram id="diagram" src="/skills/archnime-renderer/tests/fixtures/${name}.json" geometry-src="/work/${geometryName}.element.geometry.json"></architecture-diagram>`;
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
          return { status: element.diagramStatus, error: element.diagramError, dagre: typeof window.dagre, elk: typeof window.ELK, stored: !!runtime?.__diagramEngineForTest?.().stored, painted: element.shadowRoot.querySelectorAll("g.nodes g.node").length, nodes: layout ? JSON.stringify(layout.nodes.map(node => [node.id, node.x, node.y, node.w, node.h]).sort()) : null, findings: element.diagramStatus === "ready" ? element.diagramSelfCheck().length : null };
        });
        await page.close();
        return result;
      };
      const good = await open(name), stale = await open(other);
      const expected = JSON.parse(readFileSync(join(work, `${name}.element.geometry.json`), "utf8")), first = expected.layouts[Object.values(expected.states)[0][Object.keys(Object.values(expected.states)[0])[0]]];
      if (good.status !== "ready") failures.push(`element: status ${good.status} (${good.error})`);
      if (good.dagre !== "undefined" || good.elk !== "undefined") failures.push("element: the host page has a layout library, so the check proves nothing");
      if (!good.stored) failures.push("element: its engine does not report stored geometry");
      if (good.nodes !== JSON.stringify(first.nodes.map(node => [node.id, node.x, node.y, node.w, node.h]).sort())) failures.push("element: the layout shown is not the stored layout of the first stage");
      if (!good.painted || good.findings !== 0) failures.push(`element: painted ${good.painted} node(s), ${good.findings} self-check finding(s)`);
      if (stale.status !== "error" || !/Stored geometry|No stored geometry/.test(stale.error || "")) failures.push(`element: a geometry of another model gave status ${stale.status} (${stale.error}), expected a stored-geometry error`);
      lines.push(`element: ${good.painted} nodes from stored geometry with no dagre or ELK on the page; another model's geometry is refused: ${String(stale.error).slice(0, 90)}`);
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
