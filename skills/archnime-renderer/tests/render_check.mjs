/*
 * Headless render + interaction check for the renderer.
 *
 * `diagramSelfCheck()` validates the geometry the layout engine *computes*.
 * It does not see what the page actually *paints*, nor what an interactive
 * collapse/expand leaves in the DOM. Several real defects have only been
 * visible there: stale nodes after a collapse, a boundary rendered nested
 * inside another whose scopes are disjoint (false containment), a boundary
 * swallowed by another, a node straddling a boundary edge.
 *
 * This harness builds an HTML bundle from every model in `assets/examples/`
 * and `tests/fixtures/`, loads each in headless Chromium, and checks:
 *   - `diagramSelfCheck()` is clean, including declared-leaf reachability
 *   - no page errors
 *   - no duplicate rendered nodes
 *   - no sub-2px or swallowed / false-nested boundary rectangles
 *   - no package shown as both an outline and a collapsed block
 *   - no node straddling a boundary edge (35-85% inside, not nested)
 *   - the first collapse either does nothing (with a status note) or fully
 *     round-trips: collapse then re-expand restores the exact node set
 *
 * Requirements: a supported Python executable (set `PYTHON` to override the
 * shared platform-aware resolver), Node 18+,
 * and Playwright's `chromium` (via a global `playwright-core` install plus a
 * downloaded Chromium build, or `npx playwright install chromium`). When no
 * browser is found the harness prints SKIP and exits 0 so a browserless
 * environment does not hard-fail; CI that wants this as a gate must install
 * one.
 *
 *   node tests/render_check.mjs [name-substring]
 */
import { execFileSync, execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { readdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { tmpdir } from "node:os";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { injectFullEngine } from "./full_engine.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const SKILL = resolve(HERE, "..");
const TEMPLATE = join(SKILL, "assets", "template.html");
const BUILDER = join(SKILL, "scripts", "build_bundle.py");
const BROWSER_EXECUTABLE = process.env.BROWSER_EXECUTABLE;
const only = process.argv[2];

async function loadChromium() {
  const candidates = [];
  try { candidates.push(join(execSync("npm root -g").toString().trim(), "playwright-core")); } catch {}
  try { candidates.push(join(execSync("npm root").toString().trim(), "playwright-core")); } catch {}
  for (const dir of candidates) {
    try {
      try { const module = await import(pathToFileURL(join(dir, "index.mjs")).href); return module.chromium; } catch {}
    } catch {}
  }
  try { const module = await import("playwright"); return module.chromium; } catch {}
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  const message = "render_check: Playwright/Chromium not found. Local runs may skip; CI required mode must install the pinned browser.";
  console.log(`${process.env.REQUIRE_BROWSER_TESTS === "1" ? "FAIL" : "SKIP"} ${message}`);
  process.exit(process.env.REQUIRE_BROWSER_TESTS === "1" ? 2 : 0);
}

const models = [
  ...readdirSync(join(SKILL, "assets", "examples")).filter(f => f.endsWith(".json")).map(f => join(SKILL, "assets", "examples", f)),
  ...readdirSync(join(HERE, "fixtures")).filter(f => f.endsWith(".json")).map(f => join(HERE, "fixtures", f)),
].filter(f => !only || basename(f).includes(only)).sort();

const work = mkdtempSync(join(tmpdir(), "render-check-"));
let browser, crashed = true;
let failures = 0;

try {
  browser = await chromium.launch(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : undefined);
  for (const modelPath of models) {
    const name = basename(modelPath).replace(/\.json$/, "");
    const model = JSON.parse(readFileSync(modelPath, "utf8"));
    const htmlPath = join(work, `${name}.html`);
    try {
      execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", modelPath, "--output", htmlPath], { stdio: "pipe" });
    } catch (e) {
      failures++;
      console.log(`\n✗ ${name}  (build failed)\n    ${String(e.stderr || e).trim().split("\n").slice(-3).join("\n    ")}`);
      continue;
    }

    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    const pageErrors = [];
    page.on("pageerror", e => pageErrors.push(String(e)));
    await page.goto(pathToFileURL(htmlPath).href);
    try {
      await page.waitForFunction(() => window.diagramSelfCheck && document.querySelector("g.nodes g.node"), null, { timeout: 15000 });
    } catch (error) {
      const state = await page.evaluate(() => ({ ready: !!window.diagramReady, selfCheck: !!window.diagramSelfCheck, nodes: document.querySelectorAll("g.nodes g.node").length, status: document.getElementById("status")?.textContent || "", body: document.body?.innerText?.slice(0, 240) || "" }));
      throw new Error(`${error.message}; model=${modelPath}; state=${JSON.stringify(state)}; page errors=${pageErrors.join(" | ")}`);
    }
    await page.waitForTimeout(700); // let entry transitions and any second render settle
    // The page carries the runtime part of the engine only. The checks below also place models
    // themselves (auto-engine probe, corridor regressions, the Tune search), which needs the whole engine.
    await injectFullEngine(page);

    const report = await page.evaluate(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      // TASK-016: renderer transitions run on d3 timers (500 ms) driven by animation
      // frames, so a fixed sleep races a stalled frame. Poll for the state the
      // assertions inspect instead; a state that never arrives still fails them.
      const waitFor = async (settled, timeoutMs = 8000) => {
        const deadline = performance.now() + timeoutMs;
        while (performance.now() < deadline) { if (settled()) return true; await wait(40); }
        return settled();
      };
      const bundle = JSON.parse(document.getElementById("diagram-model").textContent);
      const rawView = Array.isArray(bundle.views) ? (bundle.views.find(view => view.viewId === new URL(location.href).searchParams.get("view")) || bundle.views[0]) : bundle;
      const materialize = view => view === bundle ? bundle : {
        ...view,
        meta: { ...(bundle.meta || {}), ...(view.meta || {}) },
        canvas: { ...(bundle.canvas || {}), ...(view.canvas || {}) },
        catalog: { ...(bundle.catalog || {}), ...(bundle.shared?.catalog || {}), ...(view.catalog || {}) },
        packages: { ...(bundle.packages || {}), ...(bundle.shared?.packages || {}), ...(view.packages || {}) },
      };
      const model = materialize(rawView);
      const box = el => { const r = el.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
      const domState = () => ({
        nodes: [...document.querySelectorAll("g.nodes > g.node")].map(g => g.getAttribute("aria-label").split(";")[0]),
        outlines: [...document.querySelectorAll("g.package-outline text")].map(t => t.textContent.replace(" · click to collapse", "")),
        boundW: [...document.querySelectorAll("g.boundary rect")].map(r => Math.round(+r.getAttribute("width"))),
        boundaries: [...document.querySelectorAll("g.boundary")].map(g => ({ id: g.querySelector("text").textContent, ...box(g.querySelector("rect")), title: box(g.querySelector("text")) })),
        nodeBoxes: [...document.querySelectorAll("g.nodes > g.node")].map(g => ({ id: g.getAttribute("aria-label").split(";")[0], ...box(g.querySelector(".shape") || g) })),
      });
      const geometryState = () => {
        const layout = window.__diagramLayoutForTest?.();
        const length = geometry => {
          if (geometry?.points?.length > 1) return geometry.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - geometry.points[index].x, point.y - geometry.points[index].y), 0);
          if (geometry?.segments?.length) return geometry.segments.reduce((sum, segment) => sum + length(segment), 0);
          if (geometry?.c1 && geometry?.c2) {
            let previous = { x: geometry.x1, y: geometry.y1 }, total = 0;
            for (let index = 1; index <= 24; index += 1) {
              const t = index / 24, u = 1 - t;
              const point = { x: u ** 3 * geometry.x1 + 3 * u * u * t * geometry.c1.x + 3 * u * t * t * geometry.c2.x + t ** 3 * geometry.x2, y: u ** 3 * geometry.y1 + 3 * u * u * t * geometry.c1.y + 3 * u * t * t * geometry.c2.y + t ** 3 * geometry.y2 };
              total += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point;
            }
            return total;
          }
          return geometry ? Math.hypot((geometry.x2 || 0) - (geometry.x1 || 0), (geometry.y2 || 0) - (geometry.y1 || 0)) : 0;
        };
        const nodeById = Object.fromEntries((layout?.nodes || []).map(node => [node.id, node]));
        const face = (node, point) => {
          if (!node || !point) return null;
          const rect = { left: node.x - node.w / 2, right: node.x + node.w / 2, top: node.y - node.h / 2, bottom: node.y + node.h / 2 };
          return Object.entries({ left: Math.abs(point.x - rect.left), right: Math.abs(point.x - rect.right), top: Math.abs(point.y - rect.top), bottom: Math.abs(point.y - rect.bottom) }).sort((a, b) => a[1] - b[1])[0][0];
        };
        const tangentFace = (from, to) => !from || !to ? null : Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? (to.x >= from.x ? "right" : "left") : (to.y >= from.y ? "bottom" : "top");
        const curvedEndpointAlignment = (layout?.wires || []).filter(wire => wire.visible !== false && wire.geom?.mode === "curved" && wire.geom.c1 && wire.geom.c2).map(wire => {
          const geometry = wire.geom, source = nodeById[wire.from], target = nodeById[wire.to], start = { x: geometry.x1, y: geometry.y1 }, end = { x: geometry.x2, y: geometry.y2 }, sourceFace = face(source, start), targetFace = face(target, end), sourceTangentFace = tangentFace(start, geometry.c1), targetTangentFace = tangentFace(end, geometry.c2);
          return { key: wire.key, sourceFace, sourceTangentFace, targetFace, targetTangentFace };
        });
        const orthogonalEndpointAlignment = (layout?.wires || []).filter(wire => wire.visible !== false && wire.geom?.mode === "orthogonal" && wire.geom.points?.length > 1).map(wire => {
          const points = wire.geom.points, source = nodeById[wire.from], target = nodeById[wire.to], start = points[0], end = points[points.length - 1], sourceFace = face(source, start), targetFace = face(target, end), sourceTangentFace = tangentFace(start, points[1]), targetTangentFace = tangentFace(end, points[points.length - 2]);
          return { key: wire.key, sourceFace, sourceTangentFace, targetFace, targetTangentFace };
        });
        return { engine: layout?.engine || null, fallback: layout?.fallback || null, explicitMinWireLen: Number.isFinite(Number(model.meta?.minWireLen)) && Number(model.meta.minWireLen) > 0, minWireLen: layout?.spacing?.minWireLen || 0, readableWireLen: layout?.spacing?.readableWireLen || 0, curvedEndpointAlignment, orthogonalEndpointAlignment, wires: (layout?.wires || []).map(wire => ({ key: wire.key, from: wire.from, to: wire.to, offset: wire.offset, mode: wire.geom?.mode || null, requestedRouting: wire.requestedRouting || null, actualRouting: wire.actualRouting || null, routeMode: wire.routeMode || null, routeFallback: !!wire.routeFallback, routeFallbackReason: wire.routeFallbackReason || null, path: wire.geom?.path || "", reversePath: wire.reverseGeom?.path || "", rawLength: wire.rawLength || 0, length: length(wire.geom), visible: wire.visible !== false })) };
      };
      // Model boundary scopes (leaf closure) — tells a real nested scope from a
      // collapse-induced false containment.
      const pkgs = model.packages || {};
      const leaves = id => pkgs[id] ? (pkgs[id].children || []).flatMap(leaves) : [id];
      const scopes = Object.fromEntries((model.stages?.[0]?.boundaries || []).map(b => [b.id, [...new Set((b.contains || []).flatMap(leaves))]]));
      const declaredNodeCheck = activeModel => {
        const packages = activeModel.packages || {}, catalog = activeModel.catalog || {};
        const leafIds = (id, seen = new Set()) => {
          if (seen.has(id)) return [];
          seen.add(id);
          return packages[id] ? (packages[id].children || []).flatMap(child => leafIds(child, seen)) : [id];
        };
        const declared = new Set((activeModel.stages?.[0]?.nodes || []).flatMap(entry => leafIds(typeof entry === "string" ? entry : entry?.id)));
        const idFor = element => {
          if (element.dataset.id) return element.dataset.id;
          const label = element.getAttribute("aria-label")?.split(";")[0] || "";
          const match = [...Object.entries(catalog), ...Object.entries(packages)].find(([, item]) => (item.label || "") === label);
          return match?.[0] || null;
        };
        const rendered = new Set();
        document.querySelectorAll("g.nodes > g.node").forEach(element => {
          const id = idFor(element);
          if (id) leafIds(id).forEach(leaf => rendered.add(leaf));
        });
        return { viewId: activeModel.viewId || null, declared: [...declared].sort(), rendered: [...rendered].sort(), missing: [...declared].filter(id => !rendered.has(id)).sort(), extra: [...rendered].filter(id => !declared.has(id)).sort() };
      };
      const activeModelForLocation = () => {
        const viewId = new URL(location.href).searchParams.get("view");
        const view = Array.isArray(bundle.views) ? (bundle.views.find(candidate => candidate.viewId === viewId) || bundle.views[0]) : bundle;
        if (view === bundle) return bundle;
        return { ...view, meta: { ...(bundle.meta || {}), ...(view.meta || {}) }, canvas: { ...(bundle.canvas || {}), ...(view.canvas || {}) }, catalog: { ...(bundle.catalog || {}), ...(bundle.shared?.catalog || {}), ...(view.catalog || {}) }, packages: { ...(bundle.packages || {}), ...(bundle.shared?.packages || {}), ...(view.packages || {}) } };
      };
      window.__renderCheckDeclaredNodes = () => declaredNodeCheck(activeModelForLocation());
      // Tune layout is a build option now, not a button (TASK-039). These regressions were found
      // through the button, so they still run the same search: on the whole engine, which the
      // harness loads into the page, for the stage and wire style the old test had on screen.
      const tuneWithFullEngine = async (stageIndex, routingMode) => {
        const engine = window.DiagramEngine.create(model);
        await engine.ready;
        if (routingMode) engine.setRouting(routingMode);
        const stage = engine.model.stages[stageIndex], shown = engine.layoutStage(stage), before = { engine: shown.engine, spacing: shown.spacing, nodes: shown.nodes.map(node => ({ ...node })), wires: shown.wires.map(wire => ({ ...wire })), boundaries: shown.boundaries.map(boundary => ({ ...boundary })) };
        const result = await engine.retryElk(stage, false, null, { variantCount: 3, wireVariantCount: 3, restartCount: 3, strategy: "all" });
        return { engine, stage, before, result, after: result.layout };
      };
      const autoEngineProbe = async () => {
        const engine = window.DiagramEngine.create(model);
        await engine.ready;
        return { available: !!window.ELK, engines: (model.stages || []).map(stage => engine.layoutStage(stage).engine) };
      };
      const out = { title: model.meta.title, composition: model.meta.composition || null, declaredPerspectives: Array.isArray(model.meta?.perspectives) ? model.meta.perspectives : null, stageCount: model.stages?.length || 0, selfcheck: window.diagramSelfCheck(), layout: geometryState(), autoEngines: await autoEngineProbe(), scopes, default: domState(), legendText: document.getElementById("legend")?.textContent || "", declaredNodeChecks: [declaredNodeCheck(model)], steps: [], perspectives: [], flow: null, scenarios: null, routingProbe: null, paintOrder: null, tune: null };

      if (model.meta?.title === "Wire lanes and routing styles") {
        const select = document.querySelector("#routing-select"), modes = {};
        for (const mode of ["curved", "orthogonal", "direct"]) {
          select.value = mode; select.dispatchEvent(new Event("change", { bubbles: true })); await wait(30);
          const layout = window.__diagramLayoutForTest?.();
          const geometryPaths = (layout?.wires || []).filter(wire => wire.visible !== false).map(wire => wire.geom?.path || "").join("|"), paintedPaths = [...document.querySelectorAll("g.wire path.main")].map(path => path.getAttribute("d") || "").join("|");
          const nodeById = Object.fromEntries((layout?.nodes || []).map(node => [node.id, node])), face = (node, point) => { const rect = { left: node.x - node.w / 2, right: node.x + node.w / 2, top: node.y - node.h / 2, bottom: node.y + node.h / 2 }; return Object.entries({ left: Math.abs(point.x - rect.left), right: Math.abs(point.x - rect.right), top: Math.abs(point.y - rect.top), bottom: Math.abs(point.y - rect.bottom) }).sort((a, b) => a[1] - b[1])[0][0]; }, direction = (from, to) => Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? (to.x >= from.x ? "right" : "left") : (to.y >= from.y ? "bottom" : "top");
          const endpointMismatches = mode === "orthogonal" ? (layout?.wires || []).filter(wire => wire.visible !== false && wire.geom?.mode === "orthogonal" && wire.geom.points?.length > 1).map(wire => { const points = wire.geom.points, source = nodeById[wire.from], target = nodeById[wire.to], sourceFace = face(source, points[0]), targetFace = face(target, points.at(-1)), sourceTangentFace = direction(points[0], points[1]), targetTangentFace = direction(points.at(-1), points.at(-2)); return sourceFace !== sourceTangentFace || targetFace !== targetTangentFace ? { key: wire.key, sourceFace, sourceTangentFace, targetFace, targetTangentFace } : null; }).filter(Boolean) : [];
          modes[mode] = { selected: select.value, stable: geometryPaths === paintedPaths, endpointMismatches, wires: (layout?.wires || []).map(wire => ({ key: wire.key, mode: wire.geom?.mode || null, requestedRouting: wire.requestedRouting || null, actualRouting: wire.actualRouting || null, routeFallback: !!wire.routeFallback, path: wire.geom?.path || "", offset: wire.offset })) };
        }
        select.value = "curved"; select.dispatchEvent(new Event("change", { bubbles: true })); await wait(650);
        const tuneRun = await tuneWithFullEngine(0, "curved"), beforeTune = tuneRun.before, beforePaths = (beforeTune?.wires || []).map(wire => wire.geom?.path || "").join("|");

        const afterTune = tuneRun.after, afterPaths = (afterTune?.wires || []).map(wire => wire.geom?.path || "").join("|");
        out.routingProbe = modes;
        out.paintOrder = { layers: [...document.querySelector("g.viewport")?.children || []].map(layer => layer.getAttribute("class")), nodeCount: document.querySelectorAll("g.nodes > g.node").length, nodeShapes: [...document.querySelectorAll("g.nodes > g.node .shape")].map(shape => { const box = shape.getBBox(); return { w: box.width, h: box.height }; }) };
        const tuneResult = tuneRun.result || {}, strategies = [...new Set((tuneResult.tried || []).map(candidate => candidate.strategy?.id).filter(Boolean))];
        out.tune = { buttonHidden: false, changedGeometry: beforePaths !== afterPaths, improved: tuneResult.improved === true, status: "Layout tuned (build-time search)", tried: (tuneResult.tried || []).length, strategyCount: strategies.length, strategies, engine: afterTune?.engine || null };
        // Tuning intentionally selects a new layout before the shared
        // perspective/interaction checks below; make that settled scene the
        // comparison baseline for this fixture.
        out.default = domState();
      }
      if (model.meta?.title === "Forced boundary label collision") {
        const tuneRun = await tuneWithFullEngine(0), boxesOf = layout => JSON.stringify(layout.nodes.map(node => [node.id, node.x, node.y, node.w, node.h]).sort());


        const tuned = tuneRun.after, tunedStatus = "Layout tuned (build-time search)", zoneA = tuned.boundaries.find(boundary => boundary.label === "Zone A"), n3 = tuned.nodes.find(node => node.id === "n3"), inside = (node, boundary) => !!node && !!boundary && node.x - node.w / 2 >= boundary.x && node.y - node.h / 2 >= boundary.y && node.x + node.w / 2 <= boundary.x + boundary.w && node.y + node.h / 2 <= boundary.y + boundary.h;
        const layout = tuned, nodeById = Object.fromEntries((layout?.nodes || []).map(node => [node.id, node])), curved = (layout?.wires || []).find(wire => wire.key === "n1>n3:data"), face = (node, point) => {
          if (!node || !point) return null;
          const rect = { left: node.x - node.w / 2, right: node.x + node.w / 2, top: node.y - node.h / 2, bottom: node.y + node.h / 2 };
          return Object.entries({ left: Math.abs(point.x - rect.left), right: Math.abs(point.x - rect.right), top: Math.abs(point.y - rect.top), bottom: Math.abs(point.y - rect.bottom) }).sort((a, b) => a[1] - b[1])[0][0];
        };
        const distanceToFace = (node, point, side) => {
          if (!node || !point) return Infinity;
          const rect = { left: node.x - node.w / 2, right: node.x + node.w / 2, top: node.y - node.h / 2, bottom: node.y + node.h / 2 };
          return side === "left" ? Math.abs(point.x - rect.left) : side === "right" ? Math.abs(point.x - rect.right) : side === "top" ? Math.abs(point.y - rect.top) : Math.abs(point.y - rect.bottom);
        };
        const outsideFace = (node, point, side) => {
          if (!node || !point) return false;
          const rect = { left: node.x - node.w / 2, right: node.x + node.w / 2, top: node.y - node.h / 2, bottom: node.y + node.h / 2 };
          return side === "left" ? point.x <= rect.left : side === "right" ? point.x >= rect.right : side === "top" ? point.y <= rect.top : point.y >= rect.bottom;
        };
        const tangentFace = (from, to) => !from || !to ? null : Math.abs(to.x - from.x) >= Math.abs(to.y - from.y) ? (to.x >= from.x ? "right" : "left") : (to.y >= from.y ? "bottom" : "top");
        const sourceNode = nodeById.n1, targetNode = nodeById.n3, geom = curved?.geom, sourcePoint = geom && { x: geom.x1, y: geom.y1 }, targetPoint = geom && { x: geom.x2, y: geom.y2 }, sourceFace = face(sourceNode, sourcePoint), targetFace = face(targetNode, targetPoint);
        const curvedWire = geom ? { mode: geom.mode, sourceFace, targetFace, sourceTangentFace: tangentFace(sourcePoint, geom.c1), targetTangentFace: tangentFace(targetPoint, geom.c2), sourceOnFace: distanceToFace(sourceNode, sourcePoint, sourceFace) <= .75, targetOnFace: distanceToFace(targetNode, targetPoint, targetFace) <= .75, sourceHandleOutside: outsideFace(sourceNode, geom.c1, sourceFace), targetHandleOutside: outsideFace(targetNode, geom.c2, targetFace) } : null;
        const orthogonalSelect = document.querySelector("#routing-select"), originalRouting = orthogonalSelect?.value;
        let orthogonalProbe = null;
        if (orthogonalSelect) {
          orthogonalSelect.value = "orthogonal"; orthogonalSelect.dispatchEvent(new Event("change", { bubbles: true })); await wait(120);
          const orthogonalLayout = window.__diagramLayoutForTest?.(), orthogonalWires = (orthogonalLayout?.wires || []).filter(wire => wire.geom?.points), collinearOverlaps = [], segmentOverlap = (a, b, c, d) => {
            const horizontal = Math.abs(a.y - b.y) < .01 && Math.abs(c.y - d.y) < .01 && Math.abs(a.y - c.y) < .01, vertical = Math.abs(a.x - b.x) < .01 && Math.abs(c.x - d.x) < .01 && Math.abs(a.x - c.x) < .01;
            if (horizontal) return Math.max(0, Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) - Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)));
            if (vertical) return Math.max(0, Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) - Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)));
            return 0;
          };
          for (let first = 0; first < orthogonalWires.length; first += 1) for (let second = first + 1; second < orthogonalWires.length; second += 1) for (let a = 1; a < orthogonalWires[first].geom.points.length; a += 1) for (let b = 1; b < orthogonalWires[second].geom.points.length; b += 1) {
            const overlap = segmentOverlap(orthogonalWires[first].geom.points[a - 1], orthogonalWires[first].geom.points[a], orthogonalWires[second].geom.points[b - 1], orthogonalWires[second].geom.points[b]);
            if (overlap > 6) collinearOverlaps.push({ first: orthogonalWires[first].key, second: orthogonalWires[second].key, overlap });
          }
          orthogonalProbe = { selected: orthogonalSelect.value, collinearOverlaps, selfcheck: window.diagramSelfCheck?.() || [] };
          orthogonalSelect.value = originalRouting || "curved"; orthogonalSelect.dispatchEvent(new Event("change", { bubbles: true })); await wait(120);
        }
        out.tune = { status: tunedStatus, nodeBoxesUnchanged: boxesOf(tuneRun.before) === boxesOf(tuned), zoneAContainsN3: inside(n3, zoneA), zoneAFound: !!zoneA && !!n3, curvedWire, orthogonalProbe };
        out.default = domState();
      }

      const perspectiveSelect = document.querySelector("#perspective-select");
      for (const option of [...(perspectiveSelect?.options || [])]) {
        perspectiveSelect.value = option.value;
        perspectiveSelect.dispatchEvent(new Event("change", { bubbles: true }));
        await wait(80);
        out.perspectives.push({ name: option.value, dom: domState(), hiddenWires: document.querySelectorAll("g.wire.perspective-hidden").length, emphasizedBoundaries: document.querySelectorAll("g.boundary.perspective-emphasis").length, dimmedNodes: document.querySelectorAll("g.node.perspective-dim").length, opsNodes: document.querySelectorAll("g.node.perspective-ops").length, opsWires: document.querySelectorAll("g.wire.perspective-ops").length });
      }
      if (perspectiveSelect) { perspectiveSelect.value = "all"; perspectiveSelect.dispatchEvent(new Event("change", { bubbles: true })); await wait(80); }
      const panelToggle = document.querySelector("#btn-panel-toggle");
      out.ui = { hasPerspectiveSelect: !!perspectiveSelect, perspectiveOptions: perspectiveSelect ? [...perspectiveSelect.options].map(option => option.value) : [], perspectiveSelected: perspectiveSelect?.value || null, perspectiveButtonCount: document.querySelectorAll("#perspectives button").length, hasPanelToggle: !!panelToggle, panelHidden: false, panelRestored: false };
      if (perspectiveSelect && perspectiveSelect.options.length > 1) { perspectiveSelect.value = perspectiveSelect.options[1].value; perspectiveSelect.dispatchEvent(new Event("change", { bubbles: true })); await wait(80); out.ui.perspectiveSelected = perspectiveSelect.value; }
      if (panelToggle) { panelToggle.click(); await wait(80); out.ui.panelHidden = document.body.classList.contains("panel-hidden") && document.querySelector("#details-panel")?.getBoundingClientRect().width === 0; panelToggle.click(); await wait(80); out.ui.panelRestored = !document.body.classList.contains("panel-hidden") && document.querySelector("#details-panel")?.getBoundingClientRect().width > 0; }

      const animatedSvg = await window.serializeAnimatedSvg();
      const animatedDoc = new DOMParser().parseFromString(animatedSvg, "image/svg+xml");
      out.animated = {
        stageCount: animatedDoc.querySelectorAll("g.animated-stage").length,
        stageIds: [...animatedDoc.querySelectorAll("g.animated-stage")].map(group => group.id),
        defsCount: animatedDoc.querySelectorAll("defs").length,
        hasKeyframes: animatedSvg.includes("@keyframes animated-stage-slot"),
        hasReducedMotion: animatedSvg.includes("prefers-reduced-motion:reduce"),
        hasLegend: !!animatedDoc.querySelector("g.animated-legend"),
        hasEmbeddedFont: animatedSvg.includes("data:font/woff2;base64,"),
        parseError: !!animatedDoc.querySelector("parsererror"),
      };

      const documentationSvg = window.serializeDocumentationSvg();
      // A documentation image must not depend on the presenter's pan/zoom
      // (FIX-007: the rounded viewBox must match byte for byte at any zoom).
      const liveViewport = document.querySelector("g.viewport");
      const savedViewportTransform = liveViewport?.getAttribute("transform") ?? null;
      let zoomIndependent = false;
      try {
        liveViewport?.setAttribute("transform", "translate(7000,9000) scale(3.5)");
        zoomIndependent = window.serializeDocumentationSvg() === documentationSvg;
      } finally {
        if (savedViewportTransform === null) liveViewport?.removeAttribute("transform");
        else liveViewport?.setAttribute("transform", savedViewportTransform);
      }
      const documentationDoc = new DOMParser().parseFromString(documentationSvg, "image/svg+xml");
      const documentationRoot = documentationDoc.documentElement;
      const documentationBox = document.querySelector("g.viewport")?.getBBox();
      const documentationViewBox = (documentationRoot.getAttribute("viewBox") || "").split(/\s+/).map(Number);
      const documentationImage = await new Promise(resolve => {
        const img = new Image();
        img.onload = () => resolve(img.naturalWidth > 0 && img.naturalHeight > 0);
        img.onerror = () => resolve(false);
        img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(documentationSvg);
      });
      out.documentation = {
        hasButton: !!document.getElementById("btn-export-documentation-svg"),
        zoomIndependent,
        parseError: !!documentationDoc.querySelector("parsererror"),
        hasEmbeddedFont: documentationSvg.includes("data:font/woff2;base64,"),
        hasBackground: !!documentationRoot.querySelector(":scope > rect[fill]"),
        hasViewportTransform: documentationRoot.querySelector("g.viewport")?.hasAttribute("transform") ?? true,
        viewBoxContainsGeometry: documentationBox && documentationViewBox.length === 4 &&
          documentationViewBox.every(Number.isFinite) &&
          documentationViewBox[0] <= documentationBox.x && documentationViewBox[1] <= documentationBox.y &&
          documentationViewBox[0] + documentationViewBox[2] >= documentationBox.x + documentationBox.width &&
          documentationViewBox[1] + documentationViewBox[3] >= documentationBox.y + documentationBox.height,
        loadedAsImage: documentationImage,
        nodeCount: documentationRoot.querySelectorAll("g.node").length,
        liveNodeCount: document.querySelectorAll("#diagram g.node").length,
      };
      const mermaid = window.serializeArchitectureMermaid ? window.serializeArchitectureMermaid() : "";
      const firstStage = model.stages?.[0] || {}, edgeRequired = (firstStage.wires || []).some(wire => !pkgs[wire.from] && !pkgs[wire.to]);
      out.mermaid = {
        hasButton: !!document.getElementById("btn-export-mermaid"),
        hasHeader: mermaid.startsWith("architecture-beta\n"),
        hasService: /\n    service /.test(mermaid),
        hasEdge: /\n    [A-Za-z0-9_]+:[RBLT] (?:-->|--) [RBLT]:[A-Za-z0-9_]+/.test(mermaid),
        edgeRequired,
      };

      if (model.flow) {
        const initial = { title: document.getElementById("stage-title")?.textContent || "", indicator: document.getElementById("stage-indicator")?.textContent || "" };
        const sequence = window.serializeSequenceMermaid ? window.serializeSequenceMermaid() : "";
        const flowButtons = [...document.querySelectorAll("#flow-timeline button")];
        const snapshots = [];
        for (const button of flowButtons) {
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await wait(80);
          if ((model.flow.steps[snapshots.length]?.kind || "call") !== "intro") await waitFor(() => document.querySelectorAll("g.wire.flow-active").length >= 1 && document.querySelectorAll("g.flow-marker.active").length >= 1);
          snapshots.push({ step: button.textContent, kind: model.flow.steps[snapshots.length]?.kind || "call", activeWires: document.querySelectorAll("g.wire.flow-active").length, activeMarkers: document.querySelectorAll("g.flow-marker.active").length, activeMarkerLabels: [...document.querySelectorAll("g.flow-marker.active text")].map(label => label.textContent), returnWires: document.querySelectorAll("g.wire.flow-return").length, parallelGlyphs: document.querySelectorAll("g.flow-decoration.fork, g.flow-decoration.join").length, loopBadges: document.querySelectorAll("g.flow-loop-badge").length, indicator: document.getElementById("stage-indicator")?.textContent || "", labels: [...document.querySelectorAll("text.wire-label")].map(label => ({ key: label.dataset.wireKey, text: label.textContent })) });
        }
        let returnArrow = null;
        const returnIndex = (model.flow.steps || []).findIndex(step => step?.kind === "return");
        if (returnIndex >= 0 && flowButtons[returnIndex]) {
          flowButtons[returnIndex].dispatchEvent(new MouseEvent("click", { bubbles: true }));
          const edge = (model.flow.steps[returnIndex].edges || []).find(item => item.kind === "return");
          const sampleReturnArrow = () => {
            const layout = window.__diagramLayoutForTest?.(), wire = layout?.wires?.find(item => edge && item.from === edge.wireFrom && item.to === edge.wireTo), active = document.querySelector("g.wire.flow-return.flow-active");
            return { mainMarker: active?.querySelector("path.main")?.getAttribute("marker-end") || null, flowMarker: active?.querySelector("path.flow")?.getAttribute("marker-end") || null, flowPath: active?.querySelector("path.flow")?.getAttribute("d") || "", expectedReversePath: wire?.reverseGeom?.path || "", forwardPath: wire?.geom?.path || "" };
          };
          await wait(80);
          await waitFor(() => { const sample = sampleReturnArrow(); return !!sample.flowMarker && sample.flowPath !== "" && sample.flowPath === sample.expectedReversePath; });
          returnArrow = sampleReturnArrow();
        }
        out.flow = { sequenceWideNotes: sequence.split("\n").filter(line => line.trim().startsWith("Note over ") && line.trim().slice(10).split(":")[0].split(",").length > 2), stepCount: model.flow.steps?.length || 0, timelineCount: flowButtons.length, render: model.meta?.flow?.render || "stepwise", intro: !!model.meta?.flow?.intro, introNote: model.flow.steps?.[0]?.note || "", initial, allMarkers: document.querySelectorAll("g.flow-marker").length, markerLabels: [...document.querySelectorAll("g.flow-marker text")].map(label => label.textContent), activeMarkersAtEnd: document.querySelectorAll("g.flow-marker.active").length, activeMarkerLabelsAtEnd: [...document.querySelectorAll("g.flow-marker.active text")].map(label => label.textContent), sequenceButtonVisible: document.getElementById("btn-export-sequence")?.hidden === false, sequenceHeader: sequence.startsWith("sequenceDiagram\n"), returnArrow, snapshots };
      }

      if (model.meta.composition === "scenarios") {
        const variantButtons = [...document.querySelectorAll("#pills button")];
        const snapshots = [];
        for (const button of variantButtons) {
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          await wait(80);
          snapshots.push({ variant: button.textContent, nodeIds: domState().nodeBoxes.map(node => node.id).sort() });
        }
        out.scenarios = { variantCount: model.stages?.length || 0, pillCount: variantButtons.length, previousHidden: document.getElementById("btn-prev")?.hidden === true, playHidden: document.getElementById("btn-play")?.hidden === true, nextHidden: document.getElementById("btn-next")?.hidden === true, snapshots };
      }

      if (model.meta.title === "Orders/Inventory extraction") {
        const stageButtons = [...document.querySelectorAll("#pills button")], routing = document.querySelector("#routing-select");
        const geometryLength = geometry => {
          if (!geometry) return 0;
          if (geometry.segments) return geometry.segments.reduce((sum, segment) => sum + geometryLength(segment), 0);
          if (geometry.points) return geometry.points.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - geometry.points[index].x, point.y - geometry.points[index].y), 0);
          if (geometry.c1 && geometry.c2) {
            let previous = { x: geometry.x1, y: geometry.y1 }, total = 0;
            for (let index = 1; index <= 24; index += 1) { const t = index / 24, u = 1 - t, point = { x: u ** 3 * geometry.x1 + 3 * u * u * t * geometry.c1.x + 3 * u * t * t * geometry.c2.x + t ** 3 * geometry.x2, y: u ** 3 * geometry.y1 + 3 * u * u * t * geometry.c1.y + 3 * u * t * t * geometry.c2.y + t ** 3 * geometry.y2 }; total += Math.hypot(point.x - previous.x, point.y - previous.y); previous = point; }
            return total;
          }
          return Math.hypot((geometry.x2 || 0) - (geometry.x1 || 0), (geometry.y2 || 0) - (geometry.y1 || 0));
        };
        const wireLength = layout => geometryLength((layout?.wires || []).find(item => item.key === "client>gateway:data")?.geom);
        const clientGatewayGap = layout => {
          const nodes = Object.fromEntries((layout?.nodes || []).map(node => [node.id, node])), first = nodes.client, second = nodes.gateway;
          if (!first || !second) return 0;
          const a = { x: first.x - first.w / 2, y: first.y - first.h / 2, w: first.w, h: first.h }, b = { x: second.x - second.w / 2, y: second.y - second.h / 2, w: second.w, h: second.h }, gapX = a.x + a.w < b.x ? b.x - a.x - a.w : b.x + b.w < a.x ? a.x - b.x - b.w : 0, gapY = a.y + a.h < b.y ? b.y - a.y - a.h : b.y + b.h < a.y ? a.y - b.y - b.h : 0;
          return Math.hypot(gapX, gapY);
        };
        stageButtons[2]?.click(); await wait(700);
        if (routing) { routing.value = "orthogonal"; routing.dispatchEvent(new Event("change", { bubbles: true })); await wait(120); }
        const tuneRun = await tuneWithFullEngine(2, routing ? "orthogonal" : null), beforeTune = tuneRun.before, beforeNodes = JSON.stringify((beforeTune?.nodes || []).filter(node => ["client", "gateway"].includes(node.id)).map(node => [node.id, Math.round(node.x), Math.round(node.y)]));


        const afterTune = tuneRun.after, afterNodes = JSON.stringify((afterTune?.nodes || []).filter(node => ["client", "gateway"].includes(node.id)).map(node => [node.id, Math.round(node.x), Math.round(node.y)]));
        out.spacingProbe = { beforeGap: clientGatewayGap(beforeTune), afterGap: clientGatewayGap(afterTune), beforeWireLength: wireLength(beforeTune), afterWireLength: wireLength(afterTune), readableWireLen: afterTune?.spacing?.readableWireLen || 0, changedGeometry: beforeNodes !== afterNodes, engine: afterTune?.engine || null, nodes: (afterTune?.nodes || []).filter(node => ["client", "gateway"].includes(node.id)).map(node => ({ id: node.id, x: node.x, y: node.y, pinned: node.pinned, layout: node.layout })), improved: tuneRun.result.improved === true, status: "Layout tuned (build-time search)", issues: tuneRun.engine.checkLayout(tuneRun.stage, afterTune) };
        stageButtons[0]?.click(); await wait(700);
      }

      if (model.meta.title === "Orders failover scenarios") {
        out.failoverRoutes = [];
        const routing = document.querySelector("#routing-select"), buttons = [...document.querySelectorAll("#pills button")];
        const capture = (label, shown = window.__diagramLayoutForTest(), issues = window.diagramSelfCheck()) => {
          const layout = shown, paths = ["client>gateway:data", "gateway>orders:data"].map(key => {
            const wire = layout.wires.find(item => item.key === key), points = wire?.geom?.points || [];
            return { key, points, length: points.slice(1).reduce((total, point, i) => total + Math.hypot(point.x - points[i].x, point.y - points[i].y), 0) };
          });
          out.failoverRoutes.push({ label, minWireLen: layout.spacing.minWireLen, paths, issues });
        };
        for (const [stageIndex, button] of buttons.entries()) {
          button.click(); await wait(700);
          routing.value = "orthogonal"; routing.dispatchEvent(new Event("change", { bubbles: true })); await wait(120);
          capture(`stage ${button.textContent}: before Tune`);
          const tuneRun = await tuneWithFullEngine(stageIndex, "orthogonal");
          tuneRun.engine.setRouting("orthogonal"); const tunedLayout = tuneRun.engine.layoutStage(tuneRun.stage);

          capture(`stage ${button.textContent}: after Tune`, tunedLayout, tuneRun.engine.checkLayout(tuneRun.stage, tunedLayout));
        }
        buttons[0].click(); await wait(700);
        out.orthogonalCorridors = [];
        for (const [direction, start, end, blocked] of [
          ["LR", [300, 300], [440, 300], false], ["RL", [440, 300], [300, 300], false],
          ["TB", [300, 300], [300, 440], false], ["BT", [300, 440], [300, 300], false],
          ["LR-blocked", [300, 300], [700, 300], true],
        ]) {
          const corridor = { meta: { title: direction, layout: "manual", routing: "orthogonal", minWireLen: 400 }, canvas: { w: 1000, h: 700 }, catalog: { a: { type: "service", shape: "service", w: 100, h: 100 }, b: { type: "service", shape: "service", w: 100, h: 100 }, obstacle: { type: "service", shape: "service", w: 100, h: 100 } }, stages: [{ id: "only", nodes: [{ id: "a", x: start[0], y: start[1] }, { id: "b", x: end[0], y: end[1] }, ...(blocked ? [{ id: "obstacle", x: 500, y: 300 }] : [])], wires: [{ from: "a", to: "b", type: "data" }] }] };
          const engine = window.DiagramEngine.create(corridor); await engine.ready;
          const layout = engine.layoutStage(corridor.stages[0]), points = layout.wires[0].geom.points;
          out.orthogonalCorridors.push({ direction, blocked, points, positionsUnchanged: layout.nodes.every(node => { const source = corridor.stages[0].nodes.find(item => item.id === node.id); return Math.abs(node.x - source.x) < .01 && Math.abs(node.y - source.y) < .01; }), issues: engine.selfCheck() });
        }
      }

      if (model.meta.comparison) {
        const optionButtons = [...document.querySelectorAll("#pills button")], snapshots = [], initialClient = [...document.querySelectorAll("g.nodes > g.node")].find(node => node.getAttribute("aria-label")?.startsWith("Checkout client;"));
        for (const button of optionButtons) { const option = button.dataset.viewId; button.dispatchEvent(new MouseEvent("click", { bubbles: true })); await wait(350); const client = [...document.querySelectorAll("g.nodes > g.node")].find(node => node.getAttribute("aria-label")?.startsWith("Checkout client;")), activeButton = document.querySelector(`#pills button[data-view-id="${option}"]`); out.declaredNodeChecks.push(window.__renderCheckDeclaredNodes()); snapshots.push({ option, recommendation: document.getElementById("comparison-recommendation")?.textContent || "", rows: document.querySelectorAll("#comparison-rows tr").length, recommended: activeButton?.classList.contains("comparison-recommended") === true, nodeReused: !!initialClient && client === initialClient }); }
        out.comparison = { optionCount: bundle.views?.length || 0, pillCount: optionButtons.length, cardVisible: document.getElementById("comparison-card")?.hidden === false, rowCount: document.querySelectorAll("#comparison-rows tr").length, previousHidden: document.getElementById("btn-prev")?.hidden === true, playHidden: document.getElementById("btn-play")?.hidden === true, nextHidden: document.getElementById("btn-next")?.hidden === true, snapshots };
      }

      const focusTarget = [...document.querySelectorAll("g.nodes > g.node")].find(node => !node.classList.contains("shape-package"));
      if (focusTarget) {
        const targetId = focusTarget.getAttribute("aria-label").split(";")[0];
        focusTarget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await wait(300);
        const focused = { targetId, hiddenNodes: document.querySelectorAll("g.node.focus-hidden").length, hiddenWires: document.querySelectorAll("g.wire.focus-hidden").length, status: document.getElementById("status")?.textContent || "" };
        const selected = [...document.querySelectorAll("g.nodes > g.node")].find(node => node.getAttribute("aria-label").startsWith(`${targetId};`));
        selected?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await wait(300);
        out.focus = { ...focused, restoredHiddenNodes: document.querySelectorAll("g.node.focus-hidden").length, restoredHiddenWires: document.querySelectorAll("g.wire.focus-hidden").length };
      } else out.focus = null;

      const firstHit = [...document.querySelectorAll("g.package-hit")][0];
      if (firstHit) {
        const before = domState().nodes.join(",");
        firstHit.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await wait(700);
        const collapsed = domState();
        out.status = document.getElementById("status")?.textContent || "";
        if (collapsed.nodes.join(",") !== before) {
          out.steps.push({ action: "collapse", dom: collapsed });
          const block = [...document.querySelectorAll("g.nodes > g.node")].find(g => g.getAttribute("aria-label").includes("expand package"));
          if (block) {
            block.dispatchEvent(new MouseEvent("click", { bubbles: true }));
            await wait(700);
            out.steps.push({ action: "re-expand", dom: domState(), expected: { nodes: [...before.split(",")].filter(Boolean) } });
          }
        }
      }
      return out;
    });

    const problems = [];
    const legacyExpected = Array.isArray(model.meta?.validation?.expectedIssueTypes) ? model.meta.validation.expectedIssueTypes.map(type => ({ type })) : [];
    const expectedFindings = Array.isArray(model.meta?.validation?.expectedFindings) ? model.meta.validation.expectedFindings.filter(item => item && typeof item === "object" && typeof item.type === "string") : legacyExpected;
    const expectedMatches = expected => report.selfcheck.filter(issue => issue.type === expected.type && (!expected.stage || issue.detail.startsWith(`${expected.stage}:`)) && (!expected.entity || issue.detail.includes(String(expected.entity))));
    const unexpectedIssues = report.selfcheck.filter(issue => issue.type !== "edge-route-fallback" && !expectedFindings.some(expected => expectedMatches(expected).includes(issue)));
    const missingExpectedIssues = expectedFindings.filter(expected => expectedMatches(expected).length < Math.max(1, Number(expected.min ?? 1)));
    const overMatchedExpectedIssues = expectedFindings.filter(expected => expected.max !== undefined && expectedMatches(expected).length > Number(expected.max));
    if (unexpectedIssues.length) problems.push(`unexpected selfcheck findings: ${JSON.stringify(unexpectedIssues)}`);
    if (missingExpectedIssues.length) problems.push(`expected selfcheck findings were not reported: ${JSON.stringify(missingExpectedIssues)}`);
    if (overMatchedExpectedIssues.length) problems.push(`expected selfcheck findings exceeded their bounded count: ${JSON.stringify(overMatchedExpectedIssues)}`);
    if (!report.legendText.includes("Trust & compliance") || !report.legendText.includes("Operations")) problems.push("perspective legend is missing the zones or Operations explanation");
    const shortWires = ["manual", "force"].includes(report.layout?.engine) || !report.layout?.explicitMinWireLen ? [] : (report.layout?.wires || []).filter(wire => wire.visible && wire.length + .5 < report.layout.minWireLen);
    if (shortWires.length) problems.push(`final wire geometry is below minWireLen: ${JSON.stringify(shortWires)}`);
    if (pageErrors.length) problems.push(`pageerror: ${pageErrors.join(" | ")}`);
    const declaredNodeProblems = report.declaredNodeChecks.filter(check => check.missing.length || check.extra.length);
    if (declaredNodeProblems.length) problems.push(`declared nodes were not reachable in the rendered DOM: ${JSON.stringify(declaredNodeProblems)}`);
    const packageDepth = id => {
      let depth = 0, current = id;
      while (current) {
        const parent = Object.entries(model.packages || {}).find(([, pack]) => (pack.children || []).includes(current))?.[0] || null;
        if (!parent) break;
        depth++;
        current = parent;
      }
      return depth;
    };
    const hasNestedPackages = Object.keys(model.packages || {}).some(id => packageDepth(id) >= 2);
    const explicitLayout = model.meta?.layout && model.meta.layout !== "auto" || (model.stages || []).some(stage => stage.layout && stage.layout !== "auto");
    if (hasNestedPackages && !explicitLayout && report.autoEngines.available && !report.autoEngines.engines.includes("elk")) problems.push(`auto layout did not select ELK for nested compound packages: ${JSON.stringify(report.autoEngines.engines)}`);

    const interArea = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const nested = (a, b) => a.x >= b.x - 2 && a.y >= b.y - 2 && a.x + a.w <= b.x + b.w + 2 && a.y + a.h <= b.y + b.h + 2;
    const area = a => a.w * a.h;
    const disjointModel = (x, y) => {
      const a = new Set(report.scopes[x] || []), b = new Set(report.scopes[y] || []);
      return a.size && b.size && ![...a].some(m => b.has(m));
    };
    const checkDom = (tag, dom) => {
      const dup = dom.nodes.filter((n, i) => dom.nodes.indexOf(n) !== i);
      if (dup.length) problems.push(`${tag}: duplicate rendered nodes ${JSON.stringify(dup)}`);
      const tiny = dom.boundW.filter(w => w <= 2);
      if (tiny.length) problems.push(`${tag}: ${tiny.length} boundary(ies) <=2px wide`);
      const clash = dom.outlines.filter(o => dom.nodes.includes(o));
      if (clash.length) problems.push(`${tag}: package shown as BOTH outline and block ${JSON.stringify(clash)}`);
      const B = dom.boundaries || [];
      for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
        const a = B[i], b = B[j], swallowed = interArea(a, b) / Math.min(area(a), area(b));
        const [inner, outer] = area(a) < area(b) ? [a, b] : [b, a];
        if (swallowed > 0.82 && !nested(a, b) && !nested(b, a)) {
          problems.push(`${tag}: boundary "${inner.id}" is ${(swallowed * 100) | 0}% swallowed by "${outer.id}" but not cleanly nested`);
        } else if (tag === "default" && (nested(a, b) || nested(b, a)) && swallowed > 0.5 && disjointModel(a.id, b.id)) {
          problems.push(`${tag}: boundary "${inner.id}" renders nested inside "${outer.id}" but their model scopes are disjoint - false containment`);
        }
      }
      for (const n of dom.nodeBoxes || []) for (const bd of B) {
        const frac = interArea(n, bd) / area(n);
        if (frac > 0.35 && frac < 0.85 && !nested(n, bd)) problems.push(`${tag}: node "${n.id}" straddles the "${bd.id}" boundary edge (${(frac * 100) | 0}% inside)`);
      }
    };
    checkDom("default", report.default);
    const geometryKey = dom => JSON.stringify({ nodes: dom.nodeBoxes, boundaries: dom.boundaries });
    const expectedPerspectives = ["all", ...(report.declaredPerspectives || ["data", "security", "migration", "devops"])].filter((name, index, list) => ["all", "data", "security", "migration", "devops", "control", "compat", "neutral", "zones"].includes(name) && list.indexOf(name) === index);
    if (JSON.stringify(report.perspectives.map(snapshot => snapshot.name)) !== JSON.stringify(expectedPerspectives)) problems.push(`perspective dropdown does not match the authoritative list: expected ${JSON.stringify(expectedPerspectives)}, got ${JSON.stringify(report.perspectives.map(snapshot => snapshot.name))}`);
    report.perspectives.forEach(snapshot => {
      if (geometryKey(snapshot.dom) !== geometryKey(report.default)) problems.push(`perspective ${snapshot.name} changed node or boundary geometry`);
      if (snapshot.name === "zones" && report.default.boundaries.length && snapshot.emphasizedBoundaries !== report.default.boundaries.length) problems.push("zones perspective did not emphasize every boundary");
    });
    if (!report.ui?.hasPerspectiveSelect || report.ui.perspectiveOptions.length !== expectedPerspectives.length || report.ui.perspectiveButtonCount !== 0 || !report.ui.perspectiveSelected || report.ui.perspectiveSelected === "all") problems.push(`perspective dropdown did not expose the authoritative perspectives without redundant buttons: ${JSON.stringify(report.ui)}`);
    if (!report.ui?.hasPanelToggle || !report.ui.panelHidden || !report.ui.panelRestored) problems.push(`right details panel did not hide and restore cleanly: ${JSON.stringify(report.ui)}`);
    if (name === "orders-failover-scenarios") {
      if (report.orthogonalCorridors?.length !== 5) problems.push("orthogonal corridor regressions did not run");
      for (const corridor of report.orthogonalCorridors || []) if (!corridor.positionsUnchanged || corridor.issues.length || (corridor.blocked ? corridor.points?.length <= 2 : corridor.points?.length !== 2)) problems.push(`orthogonal corridor ${corridor.direction}: ${JSON.stringify(corridor)}`);
      if (report.failoverRoutes?.length !== 6) problems.push("failover regression did not visit all three stages before/after Tune");
      for (const state of report.failoverRoutes || []) {
        for (const wire of state.paths) {
          const first = wire.points[0], last = wire.points.at(-1), dx = first && last ? Math.abs(last.x - first.x) : 0, dy = first && last ? Math.abs(last.y - first.y) : 0;
          const maxPoints = Math.min(dx, dy) < .01 ? 2 : 4;
          if (wire.points.length < 2 || wire.points.length > maxPoints || wire.length > dx + dy + .5 || wire.length + .5 < state.minWireLen) problems.push(`${state.label}: unobstructed ${wire.key} needs physical spacing, not a detour: ${JSON.stringify(wire)}`);
        }
        if (state.issues.length) problems.push(`${state.label}: ${JSON.stringify(state.issues)}`);
      }
    }
    if (name === "min-wire-length") {
      if (!(report.layout?.wires || []).some(wire => wire.rawLength > 0 && wire.rawLength < report.layout.minWireLen)) problems.push("minimum-wire-length fixture did not start with a sub-minimum raw edge");
      if ((report.layout?.wires || []).some(wire => wire.visible && wire.length + .5 < report.layout.minWireLen)) problems.push("minimum-wire-length fixture was not corrected");
    }
    if (name === "orthogonal-routing") {
      const shortOrthogonal = (report.layout?.wires || []).filter(wire => wire.visible && wire.length + .5 < report.layout.minWireLen);
      if (shortOrthogonal.length) problems.push(`orthogonal routing retained sub-minimum wires: ${JSON.stringify(shortOrthogonal)}`);
    }
    if (name === "nested-sibling-packages-model") {
      const probe = report.spacingProbe;
      if (!probe || !probe.status.includes("Layout tuned") || (probe.improved && !probe.changedGeometry) || probe.afterGap < Math.max(48, probe.beforeGap) - .5 || probe.afterWireLength + .5 < probe.readableWireLen || probe.issues.length) problems.push(`Tune did not keep the client → API gateway relationship readable: ${JSON.stringify(probe)}`);
    }
    const misalignedCurved = (report.layout?.curvedEndpointAlignment || []).filter(wire => wire.sourceFace !== wire.sourceTangentFace || wire.targetFace !== wire.targetTangentFace);
    if (misalignedCurved.length) problems.push(`curved wire arrows are not face-normal at block endpoints: ${JSON.stringify(misalignedCurved)}`);
    const misalignedOrthogonal = (report.layout?.orthogonalEndpointAlignment || []).filter(wire => wire.sourceFace !== wire.sourceTangentFace || wire.targetFace !== wire.targetTangentFace);
    if (misalignedOrthogonal.length) problems.push(`orthogonal wire arrows are not face-normal at block endpoints: ${JSON.stringify(misalignedOrthogonal)}`);
    if (name === "wire-routing-style") {
      const parallel = (report.layout?.wires || []).filter(wire => wire.from === "source" && wire.to === "target");
      if (parallel.length !== 3 || new Set(parallel.map(wire => wire.offset)).size !== parallel.length) problems.push(`parallel wires did not receive distinct lanes: ${JSON.stringify(parallel)}`);
      for (const mode of ["curved", "orthogonal", "direct"]) {
        const probe = report.routingProbe?.[mode];
        if (!probe || probe.selected !== mode || !probe.stable || probe.endpointMismatches?.length || probe.wires.some(wire => wire.requestedRouting !== mode || !["curved", "orthogonal", "direct"].includes(wire.mode) || !wire.path)) problems.push(`routing style ${mode} did not update every wire atomically, including bundled wires: ${JSON.stringify(probe)}`);
      }
      const layers = report.paintOrder?.layers || [], nodeLayer = layers.indexOf("nodes"), wireLayer = layers.indexOf("wires");
      if (nodeLayer < 0 || wireLayer < 0 || nodeLayer <= wireLayer) problems.push(`node paint layer is not above wires: ${JSON.stringify(layers)}`);
      if (report.paintOrder?.nodeCount !== 3 || report.paintOrder.nodeShapes.some(shape => shape.w <= 0 || shape.h <= 0)) problems.push(`wire rendering lost or covered a block: ${JSON.stringify(report.paintOrder)}`);
      if (report.tune?.buttonHidden || !report.tune?.status.includes("Layout tuned") || report.tune?.tried < 1 || (report.tune?.strategyCount || 0) < 2) problems.push(`Tune layout did not run a useful multi-strategy search: ${JSON.stringify(report.tune)}`);
    }
    if (name === "boundary-label-collision-model") {
      const [first, second] = report.default.boundaries;
      if (!first || !second || Math.abs(first.x - second.x) < 8 || Math.abs(first.y - second.y) < 8) problems.push(`cross-cutting boundary rails are visually coincident: ${JSON.stringify(report.default.boundaries)}`);
      if (first?.title && second?.title) {
        const titleOverlap = Math.max(0, Math.min(first.title.x + first.title.w, second.title.x + second.title.w) - Math.max(first.title.x, second.title.x)) * Math.max(0, Math.min(first.title.y + first.title.h, second.title.y + second.title.h) - Math.max(first.title.y, second.title.y));
        if (titleOverlap > 0) problems.push(`cross-cutting boundary titles overlap: ${JSON.stringify([first.title, second.title])}`);
      }
      const zoneA = report.default.boundaries.find(boundary => boundary.id === "Zone A"), n3 = report.default.nodeBoxes.find(node => node.id === "N3");
      if (zoneA && n3 && n3.y - (zoneA.y + zoneA.h) < 12) problems.push(`exclusive N3 block is too close to Zone A: ${JSON.stringify({ zoneA, n3 })}`);
      if (!report.tune?.status.includes("Layout tuned") || !report.tune?.nodeBoxesUnchanged || report.tune?.zoneAContainsN3) problems.push(`Tune changed the manual boundary layout or put N3 into Zone A: ${JSON.stringify(report.tune)}`);
      const curvedWire = report.tune?.curvedWire;
      if (!curvedWire || curvedWire.mode !== "curved" || !curvedWire.sourceOnFace || !curvedWire.targetOnFace || curvedWire.sourceFace !== curvedWire.sourceTangentFace || curvedWire.targetFace !== curvedWire.targetTangentFace || !curvedWire.sourceHandleOutside || !curvedWire.targetHandleOutside) problems.push(`curved wire is not anchored and tangent-aligned to its block faces: ${JSON.stringify(curvedWire)}`);
      if (!report.tune?.orthogonalProbe || report.tune.orthogonalProbe.selected !== "orthogonal" || report.tune.orthogonalProbe.collinearOverlaps.length || report.tune.orthogonalProbe.selfcheck.length) problems.push(`orthogonal wires still overlap or fail self-check: ${JSON.stringify(report.tune?.orthogonalProbe)}`);
    }
    if (name === "db-label-placement" && report.selfcheck.some(issue => issue.type === "wire-label-over-endpoint")) problems.push("database fixture placed its labelled wire over a node endpoint");
    if (report.flow?.returnArrow && (report.flow.returnArrow.mainMarker || !report.flow.returnArrow.flowMarker || report.flow.returnArrow.flowPath !== report.flow.returnArrow.expectedReversePath || report.flow.returnArrow.flowPath === report.flow.returnArrow.forwardPath)) problems.push(`flow return arrow did not reverse its active wire: ${JSON.stringify(report.flow.returnArrow)}`);
    if (name === "perspectives") {
      const migration = report.perspectives.find(snapshot => snapshot.name === "migration"), zones = report.perspectives.find(snapshot => snapshot.name === "zones"), devops = report.perspectives.find(snapshot => snapshot.name === "devops");
      if (!migration || migration.hiddenWires < 1 || migration.dimmedNodes < 1) problems.push(`migration perspective did not isolate transitional flows: ${JSON.stringify(migration)}`);
      if (!zones || zones.emphasizedBoundaries < 1 || zones.dimmedNodes < 1) problems.push(`zones perspective did not emphasize boundaries and dim non-boundary nodes: ${JSON.stringify(zones)}`);
      if (!devops || devops.opsNodes < 1 || devops.opsWires < 1) problems.push(`devops perspective did not surface operational nodes and wires: ${JSON.stringify(devops)}`);
    }
    if (report.focus && (!report.focus.status.includes("Focused on") || report.focus.restoredHiddenNodes || report.focus.restoredHiddenWires)) problems.push("node focus did not hide distant content and restore the full view");
    const animatedFrameCount = report.flow ? report.flow.stepCount : report.stageCount;
    if (report.animated.parseError || report.animated.stageCount !== animatedFrameCount || report.animated.stageIds.join(",") !== Array.from({ length: animatedFrameCount }, (_, index) => `stage-${index + 1}`).join(",")) problems.push("animated SVG does not contain the expected stage groups");
    if (report.animated.defsCount !== 1) problems.push(`animated SVG contains ${report.animated.defsCount} defs blocks; expected one shared block`);
    if (report.selfcheck.some(issue => issue.type === "flow-marker-overflow" || issue.type === "flow-marker-collision")) problems.push(`flow marker self-check reported ${report.selfcheck.filter(issue => issue.type.startsWith("flow-marker-")).map(issue => issue.type).join(", ")}`);
    if (!report.animated.hasKeyframes || !report.animated.hasReducedMotion || !report.animated.hasLegend || !report.animated.hasEmbeddedFont) problems.push("animated SVG is missing keyframes, reduced-motion fallback, legend, or embedded font");
    if (!report.documentation.hasButton || report.documentation.parseError || !report.documentation.hasEmbeddedFont || !report.documentation.hasBackground || report.documentation.hasViewportTransform || !report.documentation.viewBoxContainsGeometry || !report.documentation.zoomIndependent || !report.documentation.loadedAsImage || report.documentation.nodeCount !== report.documentation.liveNodeCount) problems.push(`documentation SVG is incomplete or not usable as an image: ${JSON.stringify(report.documentation)}`);
    if (!report.mermaid.hasButton || !report.mermaid.hasHeader || !report.mermaid.hasService || (report.mermaid.edgeRequired && !report.mermaid.hasEdge)) problems.push("Mermaid architecture export is missing its button, header, service, or required edge projection");
    if (report.flow) {
      if (!report.flow.sequenceButtonVisible || !report.flow.sequenceHeader) problems.push("flow sequence Mermaid export is missing or malformed");
      if (report.flow.render === "stepwise" && report.flow.timelineCount !== report.flow.stepCount) problems.push(`flow timeline has ${report.flow.timelineCount} button(s) for ${report.flow.stepCount} step(s)`);
      if (report.flow.sequenceWideNotes?.length) problems.push(`exported Mermaid sequence has a Note over with more than two participants: ${report.flow.sequenceWideNotes[0].trim()}`);
      if (report.flow.render === "stepwise" && (report.flow.snapshots.length !== report.flow.stepCount || report.flow.snapshots.some(snapshot => snapshot.kind !== "intro" && (snapshot.activeWires < 1 || snapshot.activeMarkers < 1)))) problems.push(`flow timeline did not activate at least one wire and marker for every non-intro step: ${JSON.stringify(report.flow.snapshots)}`);
      if (report.flow.render === "stepwise" && report.flow.intro && (report.flow.snapshots[0]?.kind !== "intro" || !report.flow.introNote.includes("Client request"))) problems.push("flow intro step did not list the flow step titles");
      if (report.flow.render === "stepwise" && report.flow.intro && report.flow.snapshots[1] && !report.flow.snapshots[1].activeMarkerLabels.some(label => label.split(",").includes("1"))) problems.push(`first geometric flow step marker did not start at 1: ${JSON.stringify(report.flow.snapshots[1].activeMarkerLabels)}`);
      const lastFlow = report.flow.snapshots.at(-1);
      if (lastFlow && !lastFlow.indicator.includes(`Step ${report.flow.stepCount} / ${report.flow.stepCount}`)) problems.push("flow indicator did not follow the final timeline step");
      const labelSnapshot = report.flow.snapshots[report.flow.intro ? 4 : 3];
      if (labelSnapshot && labelSnapshot.labels.find(label => label.key === "gateway>orders:data")?.text !== "POST /orders · authenticated") problems.push("flow step label override was not rendered on the active wire");
      const returnSnapshot = report.flow.snapshots.find(snapshot => snapshot.kind === "return");
      if (returnSnapshot && returnSnapshot.returnWires < 1) problems.push("return step did not receive dashed return styling");
      const parallelSnapshot = report.flow.snapshots.find(snapshot => snapshot.parallelGlyphs > 0);
      if (parallelSnapshot && (parallelSnapshot.parallelGlyphs < 2 || parallelSnapshot.loopBadges < 1)) problems.push("parallel/loop flow decorations were not rendered");
      if (report.flow.render === "all-steps" && (report.flow.timelineCount !== 0 || report.flow.allMarkers < 1 || report.flow.activeMarkersAtEnd !== report.flow.allMarkers || !report.flow.markerLabels.some(label => label.split(",").includes("1")))) problems.push("all-steps flow did not render all markers, starting at 1, without timeline controls");
      if (report.flow.render === "single" && (report.flow.timelineCount !== 0 || report.flow.allMarkers !== 1 || report.flow.activeMarkersAtEnd !== 1 || !report.flow.activeMarkerLabelsAtEnd.some(label => label.split(",").includes("1")))) problems.push(`single flow did not render exactly the current geometric step marker starting at 1 without timeline controls: ${JSON.stringify(report.flow)}`);
    }
    if (report.scenarios) {
      if (report.scenarios.pillCount !== report.scenarios.variantCount) problems.push(`scenario selector has ${report.scenarios.pillCount} pill(s) for ${report.scenarios.variantCount} variant(s)`);
      if (!report.scenarios.previousHidden || !report.scenarios.playHidden || !report.scenarios.nextHidden) problems.push("scenario selector left sequential playback controls visible");
      const defaultNodeIds = JSON.stringify(report.default.nodeBoxes.map(node => node.id).sort());
      if (report.scenarios.snapshots.some(snapshot => JSON.stringify(snapshot.nodeIds) !== defaultNodeIds)) problems.push("switching scenarios recreated or dropped keyed nodes");
    }
    if (report.comparison && (report.comparison.pillCount !== report.comparison.optionCount || !report.comparison.cardVisible || report.comparison.rowCount < 1 || !report.comparison.previousHidden || !report.comparison.playHidden || !report.comparison.nextHidden || !report.comparison.snapshots.some(snapshot => snapshot.option === "option-b" && snapshot.recommendation.includes("Recommended: option-b") && snapshot.recommended) || report.comparison.snapshots.some(snapshot => snapshot.option !== "option-a" && !snapshot.nodeReused))) problems.push(`comparison selector/card did not expose every option, recommendation, or keyed node reuse: ${JSON.stringify(report.comparison)}`);
    if (name === "commerce-views") {
      const bundleUrl = pathToFileURL(htmlPath).href;
      await page.goto(`${bundleUrl}?view=production`);
      await page.waitForFunction(() => window.diagramSelfCheck && document.querySelector("g.nodes g.node"), null, { timeout: 15000 });
      await page.waitForTimeout(700);
      const deploymentReport = await page.evaluate(() => ({
        title: document.getElementById("stage-title")?.textContent || "",
        selectedView: document.getElementById("view-select")?.value || "",
        viewCount: document.querySelectorAll("#view-select option").length,
        infrastructureCount: document.querySelectorAll("g.package-outline.deployment-infra").length,
        physicalNodeCount: document.querySelectorAll("g.nodes > g.node").length,
        hasRootBreadcrumb: [...document.querySelectorAll("#breadcrumbs button")].some(button => button.textContent === "Commerce context"),
      }));
      if (deploymentReport.title !== "Production deployment" || deploymentReport.selectedView !== "production" || deploymentReport.viewCount !== 3 || deploymentReport.infrastructureCount < 4 || deploymentReport.physicalNodeCount !== 4 || !deploymentReport.hasRootBreadcrumb) problems.push(`v2 deployment/view selector regression: ${JSON.stringify(deploymentReport)}`);
      await page.click("#btn-presenter");
      await page.selectOption("#view-select", "checkout");
      await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "checkout", null, { timeout: 15000 });
      await page.waitForFunction(() => document.getElementById("stage-indicator")?.textContent.startsWith("Step 1 /"), null, { timeout: 15000 });
      const softSwap = await page.evaluate(() => ({ presenter: document.body.classList.contains("presenter"), view: document.getElementById("view-select")?.value || "", indicator: document.getElementById("stage-indicator")?.textContent || "", status: document.getElementById("status")?.textContent || "" }));
      if (!softSwap.presenter || softSwap.view !== "checkout" || !softSwap.indicator.startsWith("Step 1 /") || softSwap.status.startsWith("Loading")) problems.push(`soft view swap regression: ${JSON.stringify(softSwap)}`);
      const plainNode = page.locator("g.nodes > g.node").filter({ hasText: "Checkout web app" }).first();
      if (await plainNode.count()) {
        await plainNode.dblclick(); await page.waitForTimeout(300);
        const doubleClickState = await page.evaluate(() => [...document.querySelectorAll("g.nodes > g.node")].find(node => node.getAttribute("aria-label")?.startsWith("Checkout web app;"))?.classList.contains("search-hit"));
        if (!doubleClickState) problems.push("double-click activated a plain node more than once or left it unselected");
      }
      const drilldown = await page.evaluate(async () => {
        const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
        const packageNode = document.querySelector("g.nodes > g.node.shape-package");
        packageNode?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
        await wait(650);
        const gateway = [...document.querySelectorAll("g.nodes > g.node")].find(node => node.getAttribute("aria-label")?.startsWith("API gateway;"));
        gateway?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
        await wait(650);
        return {
          opened: document.getElementById("status")?.textContent || "",
          gatewayPresent: !!gateway,
          breadcrumb: [...document.querySelectorAll("#breadcrumbs button")].map(button => button.textContent),
        };
      });
      if (!drilldown.gatewayPresent || !drilldown.opened.includes("Opened API gateway") || !drilldown.breadcrumb.includes("Commerce context") || drilldown.breadcrumb.includes("Commerce platform")) problems.push(`contains drill-down regression: ${JSON.stringify(drilldown)}`);
      await page.click("#btn-play");
      await page.waitForTimeout(3400);
      const autoplay = await page.evaluate(() => ({ view: new URL(location.href).searchParams.get("view"), step: new URL(location.href).searchParams.get("step"), title: document.getElementById("stage-title")?.textContent || "" }));
      if (autoplay.view !== "checkout" || autoplay.step !== "2" || autoplay.title !== "Persist") problems.push(`autoplay navigated away from the active bundle: ${JSON.stringify(autoplay)}`);
      await page.evaluate(() => document.querySelectorAll("#flow-timeline button")[1]?.click());
      await page.waitForFunction(() => new URL(location.href).searchParams.get("view") === "production", null, { timeout: 15000 });
      await page.waitForFunction(() => document.getElementById("stage-title")?.textContent === "Production deployment", null, { timeout: 15000 });
    }
    if (name === "flow-single" && report.flow?.render === "single" && report.flow.initial?.title === "Flow overview") problems.push(`single-flow default opened on the intro: ${JSON.stringify(report.flow.initial)}`);
    try {
      const baselineIssues = new Set((report.selfcheck || []).map(issue => `${issue.type}|${issue.detail}`));
      await page.emulateMedia({ media: "print" });
      await page.waitForTimeout(80);
      const printState = await page.evaluate(() => ({ issues: window.diagramSelfCheck?.() || [], nodes: document.querySelectorAll("g.nodes > g.node").length }));
      const newPrintIssues = printState.issues.filter(issue => issue.type !== "edge-route-fallback" && !baselineIssues.has(`${issue.type}|${issue.detail}`));
      if (newPrintIssues.length) problems.push(`print introduced new geometry findings: ${JSON.stringify(newPrintIssues)}`);
      await page.emulateMedia({ media: "screen" });
      await page.waitForTimeout(80);
      const fitState = await page.evaluate(() => {
        document.querySelector("#btn-fit")?.click();
        const transform = window.d3?.zoomTransform?.(document.querySelector("#diagram")) || null;
        return { scale: transform?.k || 0, nodes: document.querySelectorAll("g.nodes > g.node").length };
      });
      if (!fitState.scale || fitState.nodes < 1) problems.push(`Fit did not retain a rendered occupied scene: ${JSON.stringify(fitState)}`);
    } catch (error) {
      problems.push(`presentation regression probe failed: ${error.message || error}`);
    }
    report.steps.forEach(s => checkDom(s.action, s.dom));
    if (report.steps.length === 2) {
      const a = [...(report.steps[1].expected?.nodes || report.default.nodes)].sort().join(",");
      const b = [...report.steps[1].dom.nodes].sort().join(",");
      if (a !== b) problems.push(`collapse->expand did not restore nodes\n    was:  ${a}\n    now:  ${b}`);
    }

    if (problems.length) {
      failures++;
      console.log(`\n✗ ${name}  (${report.title})`);
      problems.forEach(p => console.log(`    ${p}`));
    } else {
      console.log(`✓ ${name}  (${report.title})`);
    }
    await page.close();
  }

  // ELK is asynchronous, so parity runs through the browser page after its
  // bounded expansion matrix has been prepared. Compare issue classes and
  // reject only additional ELK findings: an alternate backend may legitimately
  // improve a geometry defect that the baseline backend reports.
  const parity = [];
  for (const modelPath of models) {
    const name = basename(modelPath).replace(/\.json$/, "");
    const variants = {};
    for (const engine of ["dagre", "elk"]) {
      const variant = JSON.parse(readFileSync(modelPath, "utf8"));
      variant.meta = { ...(variant.meta || {}), layout: engine };
      // Stage/view layout settings are authoritative inside the renderer, so
      // force the backend on every rendered stage for a real parity run.
      if (Array.isArray(variant.stages)) variant.stages = variant.stages.map(stage => ({ ...stage, layout: engine }));
      if (Array.isArray(variant.views)) variant.views = variant.views.map(view => ({ ...view, stages: (view.stages || []).map(stage => ({ ...stage, layout: engine })) }));
      const variantModel = join(work, `${name}-${engine}.json`), htmlPath = join(work, `${name}-${engine}.html`);
      writeFileSync(variantModel, JSON.stringify(variant), "utf8");
      const outcome = { engine, issues: [], pageErrors: [], error: null, semantic: null, actualEngine: null, fallback: null, diagnostics: null };
      try {
        execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", variantModel, "--output", htmlPath], { stdio: "pipe" });
        const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
        // Parity must compare fresh unfiltered DOMs. The preceding interactive
        // case can persist a perspective per diagram title in localStorage;
        // leaking that state into only one backend makes semantic parity look
        // like a layout-engine difference.
        await page.addInitScript(() => localStorage.clear());
        page.on("pageerror", error => outcome.pageErrors.push(String(error)));
        await page.goto(pathToFileURL(htmlPath).href);
        await page.waitForFunction(() => window.diagramReady && window.diagramSelfCheck, null, { timeout: 30000 });
        await page.evaluate(() => window.diagramReady);
        outcome.issues = await page.evaluate(() => window.diagramSelfCheck());
        outcome.actualEngine = await page.evaluate(() => document.getElementById("stage-eyebrow")?.textContent?.match(/·\s*(\w+) layout$/i)?.[1]?.toLowerCase() || null);
        outcome.fallback = await page.evaluate(() => window.__diagramLayoutForTest?.()?.fallback || null);
        outcome.diagnostics = await page.evaluate(() => window.__diagramEngineDiagnostics?.() || null);
        outcome.semantic = await page.evaluate(() => {
          const layout = window.__diagramLayoutForTest?.() || {};
          return {
            nodes: (layout.nodes || []).map(node => node.id).sort(),
            wires: (layout.wires || []).filter(wire => wire.visible !== false).map(wire => wire.key).sort(),
            boundaries: (layout.boundaries || []).map(boundary => boundary.id).sort(),
          };
        });
        await page.close();
      } catch (error) {
        outcome.error = String(error?.message || error);
      }
      outcome.types = [...new Set(outcome.issues.map(issue => issue.type))].sort();
      variants[engine] = outcome;
    }
    parity.push({ name, ...variants });
    const dagre = variants.dagre, elk = variants.elk;
    const newClasses = (elk.types || []).filter(type => !(dagre.types || []).includes(type));
    const semanticMismatch = JSON.stringify(dagre.semantic) !== JSON.stringify(elk.semantic);
    const backendMismatch = dagre.actualEngine !== "dagre" || elk.actualEngine !== "elk";
    const issueCountMismatch = (elk.issues || []).length > (dagre.issues || []).length;
    if (dagre.error || elk.error || dagre.pageErrors.length || elk.pageErrors.length || newClasses.length || semanticMismatch || backendMismatch || issueCountMismatch) {
      failures++;
      console.log(`\n✗ ${name}  (ELK parity)`);
      if (dagre.error) console.log(`    dagre: ${dagre.error}`);
      if (elk.error) console.log(`    elk: ${elk.error}`);
      if (dagre.pageErrors.length) console.log(`    dagre pageerror: ${dagre.pageErrors.join(" | ")}`);
      if (elk.pageErrors.length) console.log(`    elk pageerror: ${elk.pageErrors.join(" | ")}`);
      if (newClasses.length) console.log(`    new ELK issue classes: ${newClasses.join(", ")} (${elk.issues.filter(issue => newClasses.includes(issue.type)).map(issue => issue.detail).join(" | ")})`);
      if (semanticMismatch) console.log(`    semantic mismatch: dagre=${JSON.stringify(dagre.semantic)} elk=${JSON.stringify(elk.semantic)}`);
      if (backendMismatch) console.log(`    requested backend was not exercised: dagre=${dagre.actualEngine} elk=${elk.actualEngine}`);
      if (backendMismatch && (dagre.fallback || elk.fallback)) console.log(`    backend fallback detail: dagre=${dagre.fallback || "none"} elk=${elk.fallback || "none"}`);
      if (backendMismatch && elk.diagnostics) console.log(`    ELK cache diagnostics: ${JSON.stringify(elk.diagnostics)}`);
      if (issueCountMismatch) console.log(`    ELK introduced additional findings: dagre=${dagre.issues.length} elk=${elk.issues.length}`);
    } else {
      console.log(`✓ ${name}  (dagre ↔ elk parity; ${elk.issues.length} ELK issue(s))`);
    }
  }
  console.log(`ELK parity completed (${parity.length} models)`);
  crashed = false;
} finally {
  if (browser) await browser.close();
  retainWork(work, "render-check", crashed || failures > 0);
  rmSync(work, { recursive: true, force: true });
}

console.log(failures ? `\n${failures} model(s) with problems` : `\nall render checks passed (${models.length} models)`);
process.exit(failures ? 1 : 0);
