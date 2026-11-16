/* CASE-21 regression: a wire-style change reroutes wires without re-placing nodes.
 *
 * Cycles Curved -> Orthogonal -> Direct -> back through the template control
 * on the canonical Test System artifact, and through the engine API on routing
 * fixtures. Node boxes, expansion state, and package/boundary envelopes must be
 * unchanged by every switch; each switch must actually reroute (requested
 * routing follows the selector); and returning to the starting style must
 * reproduce the starting wire geometry exactly. Each wire's reported
 * actualRouting must match its painted geometry family (CASE-22).
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const SOURCE = join(ROOT, "architecture-diagram-dsl", "assets", "examples", "test-system.yaml");
const TEMPLATE = join(ROOT, "architecture-diagram-renderer", "assets", "template.html");
const TRANSLATOR = join(ROOT, "architecture-diagram-dsl", "scripts", "translate_transition_diagram.py");
const BUILDER = join(ROOT, "architecture-diagram-renderer", "scripts", "build_bundle.py");
const FIXTURES = ["wire-routing-style", "orthogonal-routing", "min-wire-length", "deep-nested-crosscut"];
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
  console.log(`${required ? "FAIL" : "SKIP"} routing_stability_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

// Runs in the page. Snapshot helpers are shared by the UI and engine checks.
const SNAPSHOT_HELPERS = `
  const round = value => Math.round(value * 100) / 100;
  const boxes = layout => JSON.stringify([
    ...layout.nodes.map(node => [node.id, round(node.x), round(node.y), round(node.w), round(node.h)]).sort(),
    ...(layout.packages || []).map(pack => [pack.id, round(pack.x), round(pack.y), round(pack.w), round(pack.h)]).sort(),
    ...(layout.boundaries || []).map(item => [item.id, round(item.x), round(item.y), round(item.w), round(item.h)]).sort(),
    [...(layout.expanded || [])].sort(),
  ]);
  const routes = layout => JSON.stringify(layout.wires.filter(wire => wire.visible !== false).map(wire => [wire.key, wire.geom, wire.lx, wire.ly]));
  const requested = layout => [...new Set(layout.wires.filter(wire => wire.visible !== false && wire.geom).map(wire => wire.requestedRouting))];
  // Independent of the engine's classifier: the families a painted geometry
  // can truthfully claim. A Bezier is curved; a polyline with a diagonal run is
  // direct; an axis-aligned polyline (e.g. a straight Direct line between
  // aligned blocks) is compatible with both direct and orthogonal.
  const families = geom => !geom ? [] : (geom.c1 && geom.c2) || geom.segments?.length ? ["curved"] : (geom.points || []).length > 1 && geom.points.every((point, index, all) => !index || Math.abs(point.x - all[index - 1].x) < .5 || Math.abs(point.y - all[index - 1].y) < .5) ? ["orthogonal", "direct"] : ["direct"];
  const misreported = layout => layout.wires.filter(wire => wire.visible !== false && wire.geom && (!families(wire.geom).includes(wire.actualRouting) || wire.routeFallback !== (wire.actualRouting !== wire.requestedRouting))).map(wire => wire.key + " reports " + wire.actualRouting + " for " + families(wire.geom).join("/") + " geometry");
  const cycleFrom = start => ["curved", "orthogonal", "direct", "curved", "orthogonal", "direct"].slice(["curved", "orthogonal", "direct"].indexOf(start) + 1).slice(0, 2).concat([start]);
`;

const work = mkdtempSync(join(tmpdir(), "routing-stability-"));
let browser, page, crashed = true;
const failures = [], summaries = [];
try {
  const model = join(work, "test-system.json"), html = join(work, "test-system.html");
  execFileSync(PYTHON, [TRANSLATOR, SOURCE, "--output", model]);
  execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", model, "--output", html]);
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  // Motion stays enabled so the switch exercises the template's instant
  // commit rather than the reduced-motion shortcut.
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "no-preference" });
  await page.goto(pathToFileURL(html).href, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
  await page.waitForFunction(() => !document.getAnimations().some(animation => animation.playState === "running" && animation.transitionProperty), null, { timeout: 30000 });

  // 1. Template control on the displayed artifact.
  const ui = await page.evaluate(`(() => {
    ${SNAPSHOT_HELPERS}
    const select = document.getElementById("routing-select"), out = { failures: [], modes: [] };
    if (!select) return { failures: ["routing selector is missing"], modes: [] };
    const painted = () => JSON.stringify([...document.querySelectorAll("g.nodes g.node")].map(node => { const box = node.getBBox(); return [node.getAttribute("data-id"), round(box.x), round(box.y), round(box.width), round(box.height)]; }).sort());
    const start = select.value, initial = window.__diagramLayoutForTest(), initialBoxes = boxes(initial), initialRoutes = routes(initial), initialPaint = painted();
    for (const mode of cycleFrom(start)) {
      select.value = mode; select.dispatchEvent(new Event("change"));
      const shown = window.__diagramLayoutForTest(), modes = requested(shown);
      out.modes.push(mode + ":" + modes.join("/"));
      if (boxes(shown) !== initialBoxes) out.failures.push("UI " + start + "->" + mode + ": node/package/boundary boxes moved");
      if (painted() !== initialPaint) out.failures.push("UI " + start + "->" + mode + ": painted node boxes moved");
      misreported(shown).forEach(problem => out.failures.push("UI " + mode + ": " + problem));
      if (modes.length !== 1 || modes[0] !== mode) out.failures.push("UI " + mode + ": wires report requested routing " + modes.join("/"));
      if (document.querySelectorAll("g.nodes g.node").length !== shown.nodes.length) out.failures.push("UI " + mode + ": painted node count differs from layout");
      // The switch is committed atomically: no deferred transition may leave
      // the previous style's route painted, even for one frame.
      const byKey = new Map(shown.wires.map(wire => [wire.key, wire]));
      const stale = [...document.querySelectorAll("g.wire[data-wire-key]")].filter(group => { const wire = byKey.get(group.getAttribute("data-wire-key")), overlay = group.querySelector("path.flow")?.getAttribute("d"); return group.querySelector("path.main")?.getAttribute("d") !== wire?.geom?.path || ![wire?.geom?.path, wire?.reverseGeom?.path].includes(overlay); });
      const morphing = [...document.querySelectorAll("g.wire path.main")].filter(path => path.getAnimations().some(animation => animation.transitionProperty === "d"));
      if (morphing.length) out.failures.push("UI " + mode + ": " + morphing.length + " wire path(s) are still morphing from the previous route");
      if (stale.length) out.failures.push("UI " + mode + ": " + stale.length + " painted wire or flow-overlay path(s) still show the previous route");
    }
    if (routes(window.__diagramLayoutForTest()) !== initialRoutes) out.failures.push("UI: returning to " + start + " did not reproduce its wire geometry");
    return out;
  })()`);
  failures.push(...ui.failures);
  summaries.push(`test-system UI ${ui.modes.join(" ")}`);

  // 2. Engine API on routing fixtures, across stages and expansion states.
  for (const name of FIXTURES) {
    const fixture = JSON.parse(readFileSync(join(HERE, "fixtures", `${name}.json`), "utf8"));
    const result = await page.evaluate(`(async model => {
      ${SNAPSHOT_HELPERS}
      const out = { failures: [], checked: 0 };
      const engine = window.DiagramEngine.create(model);
      await engine.ready;
      const start = engine.routing;
      const states = model.stages.flatMap(stage => [[stage, false], [stage, true]]);
      const initial = states.map(([stage, all]) => { const layout = engine.layoutStage(stage, all); return { boxes: boxes(layout), routes: routes(layout) }; });
      // Style switches reroute lazily: nothing eagerly, then exactly one reroute
      // for the first layout requested, and none for repeat access.
      const reroutes = () => engine.layoutDiagnostics().reroutes, lazyBefore = reroutes();
      engine.setRouting(cycleFrom(start)[0]);
      if (reroutes() !== lazyBefore) out.failures.push("setRouting rerouted eagerly (" + (reroutes() - lazyBefore) + " layout(s))");
      engine.layoutStage(states[0][0], states[0][1]);
      if (reroutes() !== lazyBefore + 1) out.failures.push("first access after a switch rerouted " + (reroutes() - lazyBefore) + " time(s), expected 1");
      engine.layoutStage(states[0][0], states[0][1]);
      if (reroutes() !== lazyBefore + 1) out.failures.push("repeat access rerouted again");
      engine.setRouting(start);
      for (const mode of cycleFrom(start)) {
        if (!engine.setRouting(mode)) out.failures.push(mode + ": setRouting reported no change");
        states.forEach(([stage, all], index) => {
          const layout = engine.layoutStage(stage, all), tag = stage.id + (all ? "/all" : "/default") + " " + start + "->" + mode, modes = requested(layout);
          out.checked += 1;
          if (boxes(layout) !== initial[index].boxes) out.failures.push(tag + ": boxes moved");
          if (modes.length && (modes.length !== 1 || modes[0] !== mode)) out.failures.push(tag + ": requested routing " + modes.join("/"));
          misreported(layout).forEach(problem => out.failures.push(tag + ": " + problem));
          if (mode === start && routes(layout) !== initial[index].routes) out.failures.push(tag + ": returning did not reproduce wire geometry");
        });
      }
      // A committed Tune result is placement the user asked for; a later
      // wire-style switch must reroute it rather than discard it.
      if (engine.tuneAvailable) {
        const stage = model.stages[0];
        const tuned = await engine.retryElk(stage, false, null, { variantCount: 1, wireVariantCount: 1, restartCount: 1 });
        if (!tuned?.layout) out.failures.push("Tune produced no layout");
        else {
          const tunedStart = engine.routing, tunedBoxes = boxes(engine.layoutStage(stage, false));
          for (const mode of cycleFrom(tunedStart)) {
            engine.setRouting(mode);
            out.checked += 1;
            if (boxes(engine.layoutStage(stage, false)) !== tunedBoxes) out.failures.push("tuned " + stage.id + " " + tunedStart + "->" + mode + ": Tune placement was discarded");
          }
        }
      }
      return out;
    })(${JSON.stringify(fixture)})`);
    failures.push(...result.failures.map(failure => `${name} ${failure}`));
    summaries.push(`${name} ${result.checked} state(s)`);
  }
  // 3. Self-check contract (CASE-31). A flow gets the same bounded expansion
  // matrix as any other stage, and the layout on screen can be checked exactly
  // as painted, in every wire style, instead of with recomputed placements.
  const flowFixture = JSON.parse(readFileSync(join(HERE, "fixtures", "checkout-flow.json"), "utf8"));
  const flowContract = await page.evaluate(async fixture => {
    const out = { failures: [] };
    const ids = Object.keys(fixture.catalog || {}).slice(0, 2);
    const engine = window.DiagramEngine.create({ ...fixture, packages: { contractGroup: { label: "Group", children: ids } } });
    await engine.ready;
    engine.selfCheck();
    const scenarios = engine.layoutDiagnostics().selfCheckScenarios;
    if (scenarios.length < 2 || !scenarios.includes("all")) out.failures.push("flow self-check evaluated only " + JSON.stringify(scenarios) + "; it must run the expansion matrix");
    return out;
  }, flowFixture);
  failures.push(...flowContract.failures);
  const displayedContract = await page.evaluate(async () => {
    const out = { failures: [] }, select = document.querySelector("#routing-select");
    for (const mode of ["curved", "orthogonal", "direct"]) {
      select.value = mode;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 80));
      const issues = window.diagramSelfCheck({ displayed: true }), painted = window.__diagramLayoutForTest();
      if (!Array.isArray(issues)) { out.failures.push(mode + ": displayed self-check did not return an issue list"); continue; }
      if (issues.some(issue => !String(issue.detail).includes("[displayed]"))) out.failures.push(mode + ": displayed issues must be tagged [displayed]");
      if (painted.routing !== mode) out.failures.push(mode + ": displayed layout is routed for " + painted.routing);
      if (issues.some(issue => issue.type === "boundary-package-gap")) out.failures.push(mode + ": displayed layout has a package/boundary clearance gap");
    }
    return out;
  });
  failures.push(...displayedContract.failures);
  summaries.push("self-check contract (flow matrix, displayed layout x3 styles)");
  crashed = false;
} finally {
  if ((crashed || failures.length > 0) && page) await page.screenshot({ path: join(work, "failure.png") }).catch(() => {});
  await browser?.close();
  retainWork(work, "routing-stability", crashed || failures.length > 0);
  rmSync(work, { recursive: true, force: true });
}
if (failures.length) {
  console.error(`FAIL routing_stability_check\n${failures.join("\n")}`);
  process.exit(1);
}
console.log(`PASS routing_stability_check: ${summaries.join("; ")}`);
