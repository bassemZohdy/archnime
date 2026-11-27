/* Browser translator + JS-validator parity check.
 *
 * The browser port intentionally shares the Python validator's rule names.
 * This harness serves the repository over localhost because translate.html
 * fetches template.html and its sidecars before producing a download.
 */
import { execFileSync, execSync } from "node:child_process";
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, extname, sep } from "node:path";
import { PYTHON } from "../../../scripts/python_command.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const TRANSLATOR = join(ROOT, "archnime-renderer", "assets", "translate.html");
const EXAMPLES = join(ROOT, "archnime-dsl", "assets", "examples");
const INVALID = join(ROOT, "archnime-dsl", "assets", "fixtures", "invalid");
const PYTHON_VALIDATOR = join(ROOT, "archnime-dsl", "scripts", "validate_transition_diagram.py");
const PYTHON_TRANSLATOR = join(ROOT, "archnime-dsl", "scripts", "translate_transition_diagram.py");
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

function contentType(path) {
  return { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".yaml": "text/yaml", ".yml": "text/yaml", ".json": "application/json", ".css": "text/css" }[extname(path)] || "application/octet-stream";
}

function startServer() {
  const server = createServer((request, response) => {
    try {
      const pathname = decodeURIComponent(new URL(request.url, "http://127.0.0.1").pathname);
      if (pathname === "/favicon.ico") { response.writeHead(204); response.end(); return; }
      const path = resolve(ROOT, `.${pathname}`);
      if (path !== ROOT && !path.startsWith(`${ROOT}${sep}`)) { response.writeHead(403); response.end(); return; }
      if (!existsSync(path)) { response.writeHead(404); response.end(); return; }
      response.writeHead(200, { "Content-Type": contentType(path), "Cache-Control": "no-store" });
      response.end(readFileSync(path));
    } catch (error) { response.writeHead(500); response.end(String(error)); }
  });
  return new Promise(resolveServer => server.listen(0, "127.0.0.1", () => resolveServer({ server, port: server.address().port })));
}

function pythonFindings() {
  const files = readdirSync(INVALID).filter(name => name.endsWith(".yaml")).sort().map(name => join(INVALID, name));
  let output;
  try {
    output = execFileSync(PYTHON, [PYTHON_VALIDATOR, "--format", "json", ...files], { encoding: "utf8" });
  } catch (error) {
    if (!error.stdout) throw error;
    output = error.stdout;
  }
  return JSON.parse(output);
}

const chromium = await loadChromium();
if (!chromium) {
  const message = "translate_check: Playwright/Chromium not found. Local runs may skip; CI required mode must install the pinned browser.";
  console.log(`${process.env.REQUIRE_BROWSER_TESTS === "1" ? "FAIL" : "SKIP"} ${message}`);
  process.exit(process.env.REQUIRE_BROWSER_TESTS === "1" ? 2 : 0);
}

const { server, port } = await startServer();
let browser;
let failures = 0;
try {
  browser = await chromium.launch(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : undefined);
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(String(error)));
  const consoleErrors = [];
  page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${port}/archnime-renderer/assets/translate.html`);
  try {
    await page.waitForFunction(() => window.jsyaml && window.TransitionDiagramValidator && window.TransitionDiagramTranslator && window.DiagramEngine && window.translateSource, null, { timeout: 15000 });
  } catch (error) {
    const state = await page.evaluate(() => ({ jsYaml: !!window.jsyaml, validator: !!window.TransitionDiagramValidator, translator: !!window.TransitionDiagramTranslator, engine: !!window.DiagramEngine, handler: !!window.translateSource }));
    throw new Error(`${error.message}; script state=${JSON.stringify(state)}; page errors=${pageErrors.join(" | ")}; console errors=${consoleErrors.join(" | ")}`);
  }

  for (const name of ["one-shot-checkout.yaml", "strangler-migration.yaml", "strangler-migration-steps.yaml", "steps-refinement.yaml", "orders-failover-scenarios.yaml", "checkout-flow.yaml", "commerce-views.yaml", "comparison-views.yaml", "sign-in-sequence.yaml", "agent-refusal-flow.yaml"]) {
    const text = readFileSync(join(EXAMPLES, name), "utf8");
    await page.evaluate(async value => { document.getElementById("source").value = value; await window.translateSource(); }, text);
    const result = await page.evaluate(() => ({
      enabled: !document.getElementById("download-html").disabled,
      status: document.getElementById("status").textContent,
      model: window.lastTranslation?.model,
      geometry: window.lastTranslation?.geometry || [],
      html: window.lastTranslation?.html || "",
      sequence: window.lastTranslation?.model?.flow ? window.TransitionDiagramTranslator.sequenceMermaid(window.lastTranslation.model) : "",
    }));
    const activeModel = result.model?.views?.[0] || result.model;
    const problems = [];
    if (!result.enabled) problems.push(`download disabled (${result.status})`);
    if (!activeModel?.stages?.length) problems.push("no translated stages");
    if (name === "strangler-migration-steps.yaml" && activeModel.stages.length !== 3) problems.push("steps mode did not materialize base plus sequence stages");
    if (name === "steps-refinement.yaml") { const refined = activeModel.stages[2]?.nodes?.find(node => node && node.id === "gateway"); if (!refined || refined.kind !== "mixed" || refined.detail !== "auth + routing") problems.push("steps set override did not merge the accumulated presentation fields"); }
    if (name === "orders-failover-scenarios.yaml" && (activeModel.meta?.composition !== "scenarios" || activeModel.stages.length !== 3)) problems.push("scenarios mode did not materialize base plus named variants");
    if (name === "checkout-flow.yaml" && (!activeModel?.flow?.steps?.length || activeModel.flow.steps.slice(activeModel.meta.flow?.intro ? 1 : 0).some(step => !step.edges?.length))) problems.push("flow steps were not normalized into renderer edges");
    if (name === "checkout-flow.yaml" && (!result.sequence.startsWith("sequenceDiagram\n") || !result.html.includes('id="btn-export-sequence"'))) problems.push("flow sequence Mermaid export was not exposed");
    if (name === "checkout-flow.yaml" && (activeModel.flow.steps[0]?.kind !== "intro" || !activeModel.flow.steps[0].note.includes("Client request"))) problems.push("flow intro did not synthesize a title list");
    if (name === "commerce-views.yaml" && (result.model.views?.length !== 3 || result.model.views[1]?.viewMode !== "deployment" || result.model.views[1]?.deployment?.placements?.[1]?.instanceIds?.length !== 2 || result.model.shared?.catalog?.client?.navigateTo !== "checkout")) problems.push("v2 views did not preserve the compact bundle or deployment instances");
    if (name === "comparison-views.yaml" && (result.model.meta?.comparison?.recommended !== "option-b" || result.model.views?.[1]?.comparison?.tradeoffs?.operability?.rating !== 4)) problems.push("comparison metadata or per-option tradeoffs were not preserved");
    if (name === "agent-refusal-flow.yaml") { const last = activeModel.flow?.steps?.at(-1)?.edges?.[0], model = activeModel.catalog?.model, index = activeModel.catalog?.index; if (last?.kind !== "refused" || last.wireFrom !== "agent" || !result.sequence.includes("guard--xagent")) problems.push("refused step was not bound to its forward wire or exported as a cross"); if (model?.variant !== "external" || model?.type !== "llm" || index?.shape !== "db") problems.push("variant external or AI node types were not translated"); }
    if (name === "sign-in-sequence.yaml") {
      // FEAT-024: the browser translator flattens fragments exactly as the Python one does, and the
      // three Mermaid sequence writers (Python, JS translator, presenter) agree byte for byte.
      const modelPath = join(tmpdir(), `translate-check-${process.pid}.json`); execFileSync(PYTHON, [PYTHON_TRANSLATOR, join(EXAMPLES, name), "--output", modelPath]); const pythonModel = JSON.parse(readFileSync(modelPath, "utf8")); rmSync(modelPath, { force: true });
      const pythonSequence = execFileSync(PYTHON, [PYTHON_TRANSLATOR, join(EXAMPLES, name), "--sequence"], { encoding: "utf8" }).replace(/\r\n/g, "\n");
      if (JSON.stringify(activeModel.flow?.steps) !== JSON.stringify(pythonModel.flow?.steps)) problems.push("JS and Python flatten the flow fragments differently");
      if (result.sequence !== pythonSequence) problems.push("JS and Python Mermaid sequences differ");
      const presenter = await browser.newPage();
      await presenter.setContent(result.html, { waitUntil: "domcontentloaded" });
      await presenter.waitForFunction(() => typeof window.serializeSequenceMermaid === "function" && window.diagramReady, null, { timeout: 60000 });
      const presented = await presenter.evaluate(async () => { await window.diagramReady; return window.serializeSequenceMermaid(); });
      await presenter.close();
      if (presented !== pythonSequence) problems.push("the presenter's Mermaid sequence differs from the translator's");
      if (!/alt password matches\n {8}api-->>browser: 200 · session\n {4}else\n/.test(result.sequence)) problems.push("the alt and its else branch were not written");
    }
    if (!result.html.includes("diagram-runtime.js (inlined by translate.html)")) problems.push("the runtime engine was not inlined");
    // TASK-039: translate.html computes the layout with the whole engine and stores it in the page it
    // produces. That page carries no placement code and no layout library, and shows the stored layout.
    if (!result.html.includes('type="application/json" id="diagram-geometry"')) problems.push("the produced page carries no stored geometry");
    for (const placement of ["function dagreLayout", "function forceLayout", "function computeLayout", "function retryElk", "elkjs@", "dagre@", "btn-retry-elk"]) if (result.html.includes(placement)) problems.push(`the produced page still carries placement code or a layout library (${placement})`);
    {
      const produced = await browser.newPage(), producedErrors = [];
      produced.on("pageerror", error => producedErrors.push(String(error)));
      await produced.setContent(result.html, { waitUntil: "domcontentloaded" });
      try {
        await produced.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 60000 });
        const shown = await produced.evaluate(async () => { await window.diagramReady; const engine = window.__diagramEngineForTest(); return { stored: !!engine.stored, dagre: typeof window.dagre, elk: typeof window.ELK, nodes: document.querySelectorAll("g.nodes g.node").length, findings: window.diagramSelfCheck({ displayed: true }).length }; });
        if (!shown.stored || shown.dagre !== "undefined" || shown.elk !== "undefined") problems.push(`the produced page does not run from stored geometry alone (${JSON.stringify(shown)})`);
        if (!shown.nodes || shown.findings) problems.push(`the produced page painted ${shown.nodes} node(s) with ${shown.findings} finding(s) in the displayed layout`);
      } catch (error) { problems.push(`the produced page did not render: ${String(error.message || error).split("\n")[0]} ${producedErrors.join(" | ")}`); }
      await produced.close();
    }
    if (problems.length) {
      failures++;
      const geometry = (result.geometry || []).map(issue => `${issue.type}: ${issue.detail}`).join(" | ");
      console.log(`✗ ${name}: ${problems.join("; ")}${geometry ? ` [${geometry}]` : ""}`);
    }
    else console.log(`✓ ${name}: browser translation and geometry validation passed`);
  }

  const hostile = `dsl: transition-diagram/1.0
meta:
  title: Escaping regression
catalog:
  gateway:
    label: Gateway
    type: gateway
system:
  title: Escaping regression
  callout: "</script><script>window.pwned = true</script>"
  nodes: [gateway]
  wires: []
`;
  await page.evaluate(async value => { document.getElementById("source").value = value; await window.translateSource(); }, hostile);
  const escaped = await page.evaluate(() => ({ html: window.lastTranslation?.html || "", pwned: window.pwned === true }));
  if (!escaped.html.includes('type="application/json" id="diagram-model"') || !escaped.html.includes("\\u003c/script>") || escaped.html.includes("</script><script>window.pwned" ) || escaped.pwned) {
    failures++;
    console.log("✗ embedding: model payload did not use the escaped application/json contract");
  } else console.log("✓ embedding: escaped application/json model contract");

  const expected = pythonFindings();
  for (const item of expected) {
    const name = item.file.split(/[\\/]/).pop();
    const actual = await page.evaluate(async relative => {
      const response = await fetch(`/archnime-dsl/assets/fixtures/invalid/${relative}`);
      const text = await response.text();
      try {
        const doc = window.jsyaml.load(text);
        return window.TransitionDiagramValidator.validateDocument(doc).map(finding => finding.rule);
      } catch (error) { return [window.TransitionDiagramValidator.parseErrorFinding(error).rule]; }
    }, name);
    const expectedRules = [...new Set(item.findings.map(finding => finding.rule))];
    const missing = expectedRules.filter(rule => !actual.includes(rule));
    if (missing.length) { failures++; console.log(`✗ ${name}: missing JS rule(s) ${missing.join(", ")} (actual: ${actual.join(", ")})`); }
    else console.log(`✓ ${name}: JS rule parity (${expectedRules.join(", ")})`);
  }
  if (pageErrors.length || consoleErrors.length) { failures++; console.log(`✗ page errors: ${[...pageErrors, ...consoleErrors].join(" | ")}`); }
} finally {
  if (browser) await browser.close();
  await new Promise(resolveServer => server.close(resolveServer));
}
console.log(failures ? `\n${failures} translator check(s) failed` : "\nall browser translator checks passed");
process.exit(failures ? 1 : 0);
