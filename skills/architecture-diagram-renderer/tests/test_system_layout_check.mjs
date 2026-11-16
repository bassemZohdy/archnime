/* Rank and explicit trust-scope regression from the canonical Test System DSL. */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../scripts/python_command.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const SOURCE = join(ROOT, "architecture-diagram-dsl", "assets", "examples", "test-system.yaml");
const TEMPLATE = join(ROOT, "architecture-diagram-renderer", "assets", "template.html");
const TRANSLATOR = join(ROOT, "architecture-diagram-dsl", "scripts", "translate_transition_diagram.py");
const BUILDER = join(ROOT, "architecture-diagram-renderer", "scripts", "build_bundle.py");
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
  console.log(`${required ? "FAIL" : "SKIP"} test_system_layout_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

const work = mkdtempSync(join(tmpdir(), "test-system-layout-"));
let browser, page, failed = true;
try {
  const model = join(work, "test-system.json"), html = join(work, "test-system.html");
  execFileSync(PYTHON, [TRANSLATOR, SOURCE, "--output", model]);
  execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", model, "--output", html]);
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, reducedMotion: "reduce" });
  await page.goto(pathToFileURL(html).href, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
  const result = await page.evaluate(async () => {
    const source = JSON.parse(document.getElementById("diagram-model").textContent);
    const failures = [], summaries = [];
    const rect = node => ({ x: node.x - node.w / 2, y: node.y - node.h / 2, w: node.w, h: node.h });
    const inside = (outer, inner) => inner.x >= outer.x - 1 && inner.y >= outer.y - 1 && inner.x + inner.w <= outer.x + outer.w + 1 && inner.y + inner.h <= outer.y + outer.h + 1;
    const overlap = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
    const shown = window.__diagramLayoutForTest?.(), viewBox = document.getElementById("diagram")?.getAttribute("viewBox");
    if (shown?.canvas && viewBox !== `0 0 ${shown.canvas.w} ${shown.canvas.h}`) failures.push(`displayed viewport does not match committed layout: ${viewBox}`);
    if (shown?.nodes?.length === 14) {
      const painted = new Map(shown.nodes.map(node => [node.id, node]));
      const scope = shown.boundaries.find(item => item.id === "server_side");
      for (const [upstream, downstream] of [["users", "web_client"], ["users", "mobile_client"], ["gateway", "web_bff"], ["gateway", "mobile_bff"]]) {
        if (!(painted.get(upstream).x < painted.get(downstream).x)) failures.push(`displayed layout reverses ${upstream} → ${downstream}`);
      }
      if (scope) for (const id of ["users", "web_client", "mobile_client"]) {
        if (overlap({ x: scope.x, y: scope.y, w: scope.w, h: scope.h }, rect(painted.get(id))) > 1) failures.push(`displayed ${id} entered Server side`);
      }
    } else failures.push(`displayed layout has ${shown?.nodes?.length || 0} nodes`);
    if (source.stages[0].nodes.length !== 14 || source.stages[0].wires.length !== 24) failures.push("canonical translation lost nodes or wires");
    // force/LR at a short authored canvas pins the clients between users and
    // the Server side envelope on every platform; the default canvas only did
    // so with Linux text metrics.
    for (const [direction, mode, canvas] of [["LR", "auto"], ["TB", "auto"], ["LR", "force"], ["LR", "force", { w: 1200, h: 700 }]]) {
      const model = { ...source, ...(canvas ? { canvas: { ...source.canvas, ...canvas } } : {}), meta: { ...source.meta, direction, layout: mode, layoutValidation: { maxTrials: 1, maxExpansionScenarios: 4 } } };
      const engine = window.DiagramEngine.create(model);
      await engine.ready;
      const layout = engine.layoutStage(model.stages[0], true);
      const nodes = new Map(layout.nodes.map(node => [node.id, node]));
      const boundary = layout.boundaries.find(item => item.id === "server_side");
      const axis = direction === "TB" ? "y" : "x", tag = `${mode}/${direction}${canvas ? `@${canvas.w}x${canvas.h}` : ""}`;
      if (!boundary || layout.nodes.length !== 14 || layout.wires.length !== 24) { failures.push(`${tag}: lost boundary, nodes, or wires`); continue; }
      for (const [upstream, downstream] of [["users", "web_client"], ["users", "mobile_client"], ["gateway", "web_bff"], ["gateway", "mobile_bff"]]) {
        if (!(nodes.get(upstream)[axis] < nodes.get(downstream)[axis])) failures.push(`${tag}: ${upstream} is not before ${downstream}`);
      }
      const boundaryBox = { x: boundary.x, y: boundary.y, w: boundary.w, h: boundary.h };
      if (mode === "auto" && !(direction === "LR" ? layout.canvas.w > source.canvas.w : layout.canvas.h > source.canvas.h)) failures.push(`${tag}: dense ranks did not grow their logical canvas`);
      for (const node of layout.nodes) {
        const box = rect(node), member = boundary.contains.includes(node.id);
        if (!inside({ x: 0, y: 0, w: layout.canvas.w, h: layout.canvas.h }, box)) failures.push(`${tag}: ${node.id} is off canvas`);
        if (member && !inside(boundaryBox, box)) failures.push(`${tag}: ${node.id} escaped Server side`);
        if (!member && overlap(boundaryBox, box) > 1) failures.push(`${tag}: foreign ${node.id} entered Server side`);
      }
      // CASE-30: a package that is not part of the trust scope needs the same
      // clearance outside the envelope that member packages get inside it.
      const boundaryGap = engine.hierarchyGaps(layout.spacing.margin).boundaryGap;
      for (const pack of layout.packages) {
        if ([...engine.descendants(pack.id)].some(id => boundary.contains.includes(id))) continue;
        const separation = Math.max(boundaryBox.x - (pack.x + pack.w), pack.x - (boundaryBox.x + boundaryBox.w), boundaryBox.y - (pack.y + pack.h), pack.y - (boundaryBox.y + boundaryBox.h));
        if (separation < boundaryGap - .5) failures.push(`${tag}: foreign package ${pack.id} is ${Math.round(separation)}px from Server side (need ${boundaryGap}px)`);
      }
      engine.checkLayout(model.stages[0], layout).filter(issue => issue.type === "boundary-package-gap").forEach(issue => failures.push(`${tag}: ${issue.detail}`));
      for (let first = 0; first < layout.nodes.length; first += 1) for (let second = first + 1; second < layout.nodes.length; second += 1) {
        if (overlap(rect(layout.nodes[first]), rect(layout.nodes[second])) > 1) failures.push(`${tag}: ${layout.nodes[first].id} overlaps ${layout.nodes[second].id}`);
      }
      summaries.push({ tag, engine: layout.engine, canvas: layout.canvas, users: nodes.get("users")[axis], clients: [nodes.get("web_client")[axis], nodes.get("mobile_client")[axis]], gateway: nodes.get("gateway")[axis], bffs: [nodes.get("web_bff")[axis], nodes.get("mobile_bff")[axis]] });
    }
    return { failures, summaries };
  });
  if (result.failures.length) throw new Error(`${result.failures.join("\n")}; summaries=${JSON.stringify(result.summaries)}`);
  console.log(`PASS ${basename(SOURCE)}: rank, canvas, and trust scope ${JSON.stringify(result.summaries)}`);
  failed = false;
} finally {
  // Evidence for a CI failure: the page as it stood, beside the built HTML.
  if (failed && page) await page.screenshot({ path: join(work, "failure.png") }).catch(() => {});
  await browser?.close();
  retainWork(work, "test-system-layout", failed);
  rmSync(work, { recursive: true, force: true });
}
