#!/usr/bin/env node
/* Write one documentation SVG from a diagram source, headless and with nothing from the network.
 *
 *   node export_svg.mjs <spec.yaml | model.json> --out diagram.svg [--state N|id] [--view id] [--sequence]
 *
 * A YAML spec is translated with the shipped translator; a JSON model is used as it is. The model is
 * built into a single offline HTML file (vendored libraries, checked against their pinned hashes),
 * opened in headless Chromium, and the SVG is the exact one the presenter's "SVG (documentation)"
 * (or, with --sequence, "SVG (sequence)") produces. That SVG carries the light and the dark palette
 * and follows the reader's prefers-color-scheme. It holds no timestamps or random ids, so the same
 * source and renderer write the same bytes on every run. Nothing is patched in the generated HTML.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DEFAULT_TEMPLATE, describeStates, loadChromium } from "./export_snapshots.mjs";

// Same interpreter policy as the repository harnesses (scripts/python_command.mjs), inlined so an installed skill needs nothing outside its folder.
const PYTHON = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const BUILDER = join(HERE, "build_bundle.py");
const TRANSLATOR = join(HERE, "..", "..", "archnime-dsl", "scripts", "translate_transition_diagram.py");

export const USAGE = "usage: export_svg.mjs <spec.yaml|model.json> --out file.svg [--state N|id] [--view id] [--sequence] [--template template.html]";

export function parseArguments(argv) {
  const options = { sequence: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--sequence") { options.sequence = true; continue; }
    if (!arg.startsWith("--")) { if (options.source) throw new Error(`unexpected argument ${arg}`); options.source = arg; continue; }
    const value = argv[index + 1];
    if (!["--out", "--state", "--view", "--template"].includes(arg)) throw new Error(`unknown option ${arg}`);
    if (value === undefined || value.startsWith("--")) throw new Error(`${arg} needs a value`);
    options[arg.slice(2)] = value;
    index += 1;
  }
  if (!options.source || !options.out) throw new Error(USAGE);
  return options;
}

function pickState(described, view, state, sequence) {
  const item = view ? described.find(entry => entry.view === view) : described[0];
  if (!item) throw new Error(`no view "${view}" (available: ${described.map(entry => entry.view).filter(Boolean).join(", ") || "none, this model has a single view"})`);
  if (sequence && item.parameter !== "step") throw new Error("--sequence needs a flow (a spec with flow: steps)");
  if (state === undefined) return { item, state: null };
  const found = item.states.find(entry => String(entry.index) === String(state) || entry.id === String(state));
  if (!found) throw new Error(`no state "${state}" (available: ${item.states.map(entry => `${entry.index}=${entry.id}`).join(", ")})`);
  return { item, state: found };
}

/** Render one SVG and return its text; write it to `out` when given. */
export async function exportSvg({ source, out, state, view, sequence = false, template = DEFAULT_TEMPLATE, chromium }) {
  const work = mkdtempSync(join(tmpdir(), "export-svg-"));
  let browser;
  try {
    let modelPath = resolve(source);
    if ([".yaml", ".yml"].includes(extname(modelPath).toLowerCase())) {
      const translated = join(work, "model.json");
      if (!existsSync(TRANSLATOR)) throw new Error(`a YAML spec needs archnime-dsl installed beside archnime-renderer (looked for ${TRANSLATOR}); or pass a translated model.json`);
      execFileSync(PYTHON, [TRANSLATOR, modelPath, "--output", translated], { stdio: ["ignore", "ignore", "pipe"] });
      modelPath = translated;
    }
    const model = JSON.parse(readFileSync(modelPath, "utf8"));
    const picked = pickState(describeStates(model), view, state, sequence);
    const html = join(work, "diagram.html");
    execFileSync(PYTHON, [BUILDER, "--template", template, "--model", modelPath, "--output", html, "--inline", "--offline"], { stdio: ["ignore", "ignore", "pipe"] });

    const browserType = chromium || await loadChromium();
    if (!browserType) throw new Error("Playwright/Chromium is required (npm i playwright && npx playwright install chromium)");
    browser = await browserType.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
    // Light is the base palette whatever the machine's setting; the SVG carries dark as a media rule.
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", colorScheme: "light" });
    const query = new URLSearchParams();
    if (picked.item.view) query.set("view", picked.item.view);
    if (picked.state) query.set(picked.item.parameter, String(picked.state.index));
    await page.goto(`${pathToFileURL(html).href}${query.size ? `?${query}` : ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
    await page.evaluate(() => window.diagramReady);
    await page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 30000 });
    await page.waitForTimeout(150);
    const result = await page.evaluate(asSequence => {
      try { return { svg: asSequence ? window.serializeSequenceSvg() : window.serializeDocumentationSvg() }; }
      catch (error) { return { error: String(error.message || error) }; }
    }, sequence);
    if (result.error) throw new Error(result.error);
    if (out) { mkdirSync(dirname(resolve(out)), { recursive: true }); writeFileSync(resolve(out), result.svg, "utf8"); }
    return result.svg;
  } finally {
    await browser?.close();
    rmSync(work, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const svg = await exportSvg({ source: options.source, out: options.out, state: options.state, view: options.view, sequence: options.sequence, template: options.template ? resolve(options.template) : DEFAULT_TEMPLATE });
    console.log(`wrote ${resolve(options.out)} (${Buffer.byteLength(svg)} bytes)`);
  } catch (error) {
    console.error(`export_svg: ${error.message}`);
    process.exit(error.message.startsWith("usage:") || /needs a value|unknown option|unexpected argument/.test(error.message) ? 2 : 1);
  }
}
