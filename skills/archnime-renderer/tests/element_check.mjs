/* Headless check for the shadow-root <architecture-diagram> element. */
import { execSync } from "node:child_process";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { resolve, join, extname, sep } from "node:path";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const MODEL_PATH = join(ROOT, "archnime-renderer", "assets", "examples", "portable-transition-model.json");
const BROWSER_EXECUTABLE = process.env.BROWSER_EXECUTABLE;

async function loadChromium() {
  const candidates = [];
  try { candidates.push(join(execSync("npm root -g", { encoding: "utf8", shell: true }).trim(), "playwright-core")); } catch {}
  try { candidates.push(join(execSync("npm root", { encoding: "utf8", shell: true }).trim(), "playwright-core")); } catch {}
  for (const directory of candidates) {
    const entry = join(directory, "index.mjs");
    if (existsSync(entry)) { try { const module = await import(pathToFileURL(entry).href); return module.chromium; } catch {} }
  }
  try { const module = await import("playwright"); return module.chromium; } catch {}
  return null;
}

function startServer() {
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      const path = resolve(ROOT, `.${pathname}`);
      if (path !== ROOT && !path.startsWith(`${ROOT}${sep}`)) { response.writeHead(403); response.end(); return; }
      if (!existsSync(path)) { response.writeHead(404); response.end(); return; }
      const type = { ".html": "text/html", ".js": "text/javascript", ".json": "application/json" }[extname(path)] || "application/octet-stream";
      response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store" });
      response.end(readFileSync(path));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  return new Promise(resolveServer => server.listen(0, "127.0.0.1", () => resolveServer({ server, port: server.address().port })));
}

const chromium = await loadChromium();
if (!chromium) {
  const message = "element_check: Playwright/Chromium not found. Local runs may skip; CI required mode must install the pinned browser.";
  console.log(`${process.env.REQUIRE_BROWSER_TESTS === "1" ? "FAIL" : "SKIP"} ${message}`);
  process.exit(process.env.REQUIRE_BROWSER_TESTS === "1" ? 2 : 0);
}

const model = readFileSync(MODEL_PATH, "utf8");
const { server, port } = await startServer();
let browser;
let failures = 0;
try {
  browser = await chromium.launch(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : undefined);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error)));
  await page.goto(`http://127.0.0.1:${port}/archnime-renderer/assets/translate.html`, { waitUntil: "load" });
  const textSizing = await page.evaluate(async () => {
    const node = async (entry, asPackage = false) => {
      const model = {
        meta: { layout: "manual" }, canvas: { w: 1600, h: 1000 },
        catalog: { item: { ...entry, x: 400, y: 300 } },
        packages: asPackage ? { group: { ...entry, x: 400, y: 300, children: ["item"] } } : {},
        stages: [{ id: "test", nodes: [asPackage ? "group" : "item"], wires: [] }],
      };
      const engine = window.DiagramEngine.create(model, {
        elk: null, dagre: null,
        measureContext: { measureText: text => ({ width: String(text).length * 8 }) },
      });
      await engine.ready;
      return engine.layoutStage(model.stages[0]).nodes[0];
    };
    return {
      label: await node({ label: "Alpha Beta Gamma Delta Epsilon", w: 150 }),
      package: await node({ label: "Group", detail: "One sufficiently long detail", w: 200 }, true),
      capped: await node({ label: "Group", detail: "x".repeat(80), w: 200 }, true),
      wide: await node({ label: "Group", detail: "x".repeat(80), w: 400 }),
    };
  });
  if (textSizing.label.labelLines > 2 || textSizing.package.detailOverflow || textSizing.package.w <= 200 || !textSizing.capped.detailOverflow || textSizing.capped.w > 300 || textSizing.wide.w < 400) {
    failures++;
    console.error(`Node text sizing regression: ${JSON.stringify(textSizing)}`);
  } else console.log("✓ node text sizing: two-line labels, collapsed-package details, width cap, and authored widths");
  await page.addScriptTag({ url: `http://127.0.0.1:${port}/archnime-renderer/assets/architecture-diagram-element.js` });
  await page.evaluate(({ port, model }) => {
    const src = document.createElement("architecture-diagram");
    src.id = "from-src";
    src.setAttribute("src", `http://127.0.0.1:${port}/archnime-renderer/assets/examples/portable-transition-model.json`);
    src.setAttribute("stage", "2");
    src.setAttribute("mode", "static");
    src.setAttribute("perspective", "security");
    src.setAttribute("controls", "none");
    document.body.appendChild(src);
    const inline = document.createElement("architecture-diagram");
    inline.id = "from-inline";
    inline.setAttribute("controls", "minimal");
    const customModel = JSON.parse(model);
    customModel.meta.theme = { light: { data: "#0b6e4f" } };
    customModel.meta.icons = { worker: "agent", mobile: { viewBox: "0 0 24 24", markup: '<path d="M12 2v20"/>' } };
    customModel.catalog.worker = { label: "Worker", type: "worker", kind: "new" };
    customModel.catalog.mobile = { label: "Mobile client", type: "mobile", kind: "existing" };
    customModel.stages[0].nodes.push("worker", "mobile");
    const script = document.createElement("script");
    script.type = "application/json";
    script.textContent = JSON.stringify(customModel);
    inline.appendChild(script);
    document.body.appendChild(inline);
    const broken = document.createElement("architecture-diagram");
    broken.id = "broken-src";
    broken.setAttribute("src", `http://127.0.0.1:${port}/archnime-renderer/assets/examples/missing-model.json`);
    document.body.appendChild(broken);
  }, { port, model });
  try {
    await page.waitForFunction(() => ["from-src", "from-inline"].every(id => document.getElementById(id)?.shadowRoot?.querySelector("g.nodes > g.node")), null, { timeout: 30000 });
    await page.waitForFunction(() => document.getElementById("broken-src")?.diagramStatus === "error", null, { timeout: 30000 });
  } catch (error) {
    const state = await page.evaluate(() => [...document.querySelectorAll("architecture-diagram")].map(element => ({ id: element.id, shadow: !!element.shadowRoot, body: element.shadowRoot?.querySelector("body")?.className || "", status: element.shadowRoot?.querySelector("#status")?.textContent || "", hasReady: !!element.diagramReady, text: element.shadowRoot?.textContent?.slice(0, 240) || "" })));
    throw new Error(`${error.message}; state=${JSON.stringify(state)}; page errors=${pageErrors.join(" | ")}`);
  }
  await page.evaluate(({ port }) => {
    const element = document.getElementById("from-src");
    element.setAttribute("src", `http://127.0.0.1:${port}/archnime-renderer/assets/examples/missing-model.json`);
    element.setAttribute("src", `http://127.0.0.1:${port}/archnime-renderer/assets/examples/portable-transition-model.json`);
    element.setAttribute("perspective", "migration");
  }, { port });
  await page.waitForFunction(() => document.getElementById("from-src")?.diagramStatus === "ready" && document.getElementById("from-src")?.shadowRoot?.querySelector("g.nodes > g.node"), null, { timeout: 30000 });
  await page.waitForFunction(() => document.getElementById("from-src")?.shadowRoot?.querySelector("#perspective-select")?.value === "migration", null, { timeout: 30000 });
  const result = await page.evaluate(() => {
    const inspect = element => {
      const root = element.shadowRoot;
      const body = root.querySelector("body");
      const mermaid = element.serializeArchitectureMermaid();
      let documentation = ""; try { documentation = element.serializeDocumentationSvg(); } catch (error) { documentation = `error: ${error.message}`; }
      return {
        stage: root.querySelector("#stage-indicator")?.textContent || "",
        selfcheck: element.diagramSelfCheck(),
        mermaid: { header: mermaid.startsWith("architecture-beta\n"), service: /\n    service /.test(mermaid), edge: /\n    [A-Za-z0-9_]+:[RBLT] (?:-->|--) [RBLT]:[A-Za-z0-9_]+/.test(mermaid) },
        documentation: documentation.startsWith("<svg") && documentation.includes("doc-background") ? "ok" : documentation.slice(0, 200),
        controlsHidden: getComputedStyle(root.querySelector(".controls")).display === "none",
        perspective: root.querySelector("#perspective-select")?.value || "",
        nodeCount: root.querySelectorAll("g.nodes > g.node").length,
        customAlias: !!root.querySelector('use[href="#icon-agent"]'),
        customInline: !!root.querySelector('use[href="#icon-mobile"]'),
        bodyClasses: body?.className || "",
        themeData: body ? getComputedStyle(body).getPropertyValue("--data").trim() : "",
        nodeFill: getComputedStyle(root.querySelector("g.node .shape")).fill,
        themeInExport: /rgb\(11, 110, 79\)/.test(documentation),
      };
    };
    return { src: inspect(document.getElementById("from-src")), inline: inspect(document.getElementById("from-inline")), broken: { status: document.getElementById("broken-src").diagramStatus, selfcheck: document.getElementById("broken-src").diagramSelfCheck() }, hostDiagram: !!document.querySelector("#diagram") };
  });
  const problems = [];
  for (const key of ["src", "inline"]) if (result[key].documentation !== "ok") problems.push(`${key}: documentation SVG export failed inside the element (${result[key].documentation})`);
  if (!result.src.stage.includes("Stage 2 / 2")) problems.push(`src stage attribute was not applied: ${result.src.stage}`);
  if (!result.src.controlsHidden || !result.src.bodyClasses.includes("element-static")) problems.push("static/none controls were not scoped to the shadow root");
  if (result.src.perspective !== "migration") problems.push("changed perspective attribute was not applied through the dropdown");
  for (const [name, item] of Object.entries(result)) {
    if (name === "hostDiagram" || name === "broken") continue;
    if (item.selfcheck.length) problems.push(`${name} self-check: ${JSON.stringify(item.selfcheck)}`);
    if (!item.mermaid.header || !item.mermaid.service || !item.mermaid.edge) problems.push(`${name} Mermaid projection is incomplete`);
    if (item.nodeCount < 1) problems.push(`${name} rendered no nodes`);
  }
  if (result.inline.themeData !== "#0b6e4f" || !result.inline.themeInExport) problems.push(`meta.theme was not applied inside the shadow root (${result.inline.themeData}, export ${result.inline.themeInExport})`);
  for (const key of ["src", "inline"]) if (result[key].nodeFill === "rgb(0, 0, 0)" || result[key].nodeFill === "none") problems.push(`${key}: the palette did not reach the shadow root (node fill ${result[key].nodeFill})`);
  if (result.src.themeData !== "#0f9bb5" || result.src.themeInExport) problems.push(`one element's theme leaked into another (${result.src.themeData})`);
  if (!result.inline.customAlias || !result.inline.customInline) problems.push("registered alias or inline SVG icon was not merged into the renderer library");
  if (result.hostDiagram) problems.push("shadow-root renderer leaked #diagram into the host document");
  if (result.broken.status !== "error" || result.broken.selfcheck[0]?.type !== "runtime-error") problems.push(`failed model did not expose explicit runtime error state: ${JSON.stringify(result.broken)}`);
  if (pageErrors.length) problems.push(`page errors: ${pageErrors.join(" | ")}`);
  if (problems.length) { failures++; problems.forEach(problem => console.log(`✗ ${problem}`)); }
  else console.log("✓ shadow-root element: src/inline models, scoped controls, perspective, self-check, and Mermaid export passed");
} finally {
  if (browser) await browser.close();
  await new Promise(resolveServer => server.close(resolveServer));
}
console.log(failures ? `\n${failures} element check(s) failed` : "all element checks passed");
process.exit(failures ? 1 : 0);
