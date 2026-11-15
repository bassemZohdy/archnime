#!/usr/bin/env node
/* Export every requested architecture state as its own documentation SVG.
 *
 *   node export_snapshots.mjs --model model.json --out snapshots [--views a,b] [--states 1,3|id,id] [--viewer-url URL]
 *
 * A portable model (single mode or a v2 bundle) is built into an HTML bundle with the
 * shipped builder, opened in Chromium, and each view's states (migration stages, scenario
 * variants, flow steps) are selected through the same URL parameters the presenter uses.
 * Each state is written once, as the exact SVG that "SVG (documentation)" produces, under a
 * stable name: <model>--[<view>--]<NN>-<state>.svg, together with a manifest.json that records the
 * SHA-256 of the source model, the renderer and every file (see snapshot_manifest.mjs), and a
 * snapshots.md that shows each state and links to the interactive presenter (see snapshot_links.mjs).
 * Nothing is patched in the generated HTML.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../scripts/python_command.mjs";
import { buildManifest, writeManifest } from "./snapshot_manifest.mjs";
import { buildMarkdown, checkViewerUrl } from "./snapshot_links.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const DEFAULT_TEMPLATE = join(HERE, "..", "assets", "template.html");
const BUILDER = join(HERE, "build_bundle.py");

export const slug = value => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "untitled";

export async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

/** The views of a model and the states each one steps through, read from the model alone. */
export function describeStates(model) {
  const views = Array.isArray(model.views)
    ? model.views.map(view => ({ id: view.viewId, mode: view.viewMode, meta: { ...model.meta, ...(view.meta || {}) }, flow: view.flow, stages: view.stages }))
    : [{ id: null, mode: null, meta: model.meta || {}, flow: model.flow, stages: model.stages }];
  return views.map(view => {
    const isFlow = Boolean(view.flow), isScenarios = !isFlow && view.meta.composition === "scenarios";
    const items = isFlow ? view.flow.steps : view.stages;
    return {
      view: view.id,
      mode: view.mode,
      parameter: isFlow ? "step" : isScenarios ? "variant" : "stage",
      states: items.map((item, index) => ({ index: index + 1, id: item.id || `${isFlow ? "step" : "stage"}-${index + 1}`, title: item.title || item.note || item.label || item.id || `State ${index + 1}` })),
    };
  });
}

function wanted(states, selection) {
  if (!selection?.length) return states;
  const picked = [];
  for (const choice of selection) {
    const state = states.find(item => String(item.index) === String(choice) || item.id === String(choice));
    if (!state) throw new Error(`no state "${choice}" (available: ${states.map(item => `${item.index}=${item.id}`).join(", ")})`);
    if (!picked.includes(state)) picked.push(state);
  }
  return picked.sort((a, b) => a.index - b.index);
}

/**
 * Write one documentation SVG per selected state.
 * @returns {Promise<{files: Array<{file: string, path: string, view: string|null, mode: string|null, index: number, id: string, title: string}>}>}
 */
export async function exportSnapshots({ modelPath, outDir, template = DEFAULT_TEMPLATE, views, states, chromium, viewerUrl }) {
  if (viewerUrl !== undefined) checkViewerUrl(viewerUrl);
  const model = JSON.parse(readFileSync(modelPath, "utf8"));
  const described = describeStates(model);
  const modelSlug = slug(model.meta?.title || basename(modelPath, ".json"));

  // Validate the whole request before building or writing anything.
  const plan = [];
  const knownViews = described.map(item => item.view).filter(Boolean);
  for (const name of views || []) if (!knownViews.includes(name)) throw new Error(`no view "${name}" (available: ${knownViews.join(", ") || "none, this model has a single view"})`);
  for (const item of described) {
    if (views?.length && item.view && !views.includes(item.view)) continue;
    for (const state of wanted(item.states, states)) plan.push({ item, state });
  }
  if (!plan.length) throw new Error("nothing selected to export");

  const browserType = chromium || await loadChromium();
  if (!browserType) throw new Error("Playwright/Chromium is required to export snapshots (npm i playwright && npx playwright install chromium)");

  const work = mkdtempSync(join(tmpdir(), "snapshots-"));
  let browser;
  try {
    const html = join(work, "diagram.html");
    execFileSync(PYTHON, [BUILDER, "--template", template, "--model", modelPath, "--output", html], { stdio: ["ignore", "ignore", "pipe"] });
    browser = await browserType.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
    const rendered = [];
    for (const { item, state } of plan) {
      const query = new URLSearchParams();
      if (item.view) query.set("view", item.view);
      query.set(item.parameter, String(state.index));
      await page.goto(`${pathToFileURL(html).href}?${query}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      await page.evaluate(() => window.diagramReady);
      // Progressive disclosure reveals supporting flows on a timer: export once it has finished.
      await page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 30000 });
      await page.waitForTimeout(150);
      const result = await page.evaluate(() => { try { return { svg: window.serializeDocumentationSvg() }; } catch (error) { return { error: String(error.message || error) }; } });
      if (result.error) throw new Error(`${item.view ? `view ${item.view}, ` : ""}state ${state.index} (${state.id}): ${result.error}`);
      const file = `${modelSlug}--${item.view ? `${slug(item.view)}--` : ""}${String(state.index).padStart(2, "0")}-${slug(state.id)}.svg`;
      rendered.push({ file, svg: result.svg, view: item.view, mode: item.mode, parameter: item.parameter, index: state.index, id: state.id, title: state.title });
    }
    if (new Set(rendered.map(entry => entry.file)).size !== rendered.length) throw new Error("two states would be written to the same file name");
    mkdirSync(outDir, { recursive: true });
    const files = rendered.map(({ svg, ...entry }) => {
      const path = join(outDir, entry.file);
      writeFileSync(path, svg, "utf8");
      return { ...entry, path };
    });
    const manifestData = buildManifest({ modelPath, template, files });
    const manifest = writeManifest(outDir, manifestData);
    const markdown = join(outDir, "snapshots.md");
    writeFileSync(markdown, buildMarkdown({ manifest: manifestData, title: model.meta?.title || basename(modelPath, ".json"), viewerUrl }), "utf8");
    return { files, manifest, markdown };
  } finally {
    await browser?.close();
    rmSync(work, { recursive: true, force: true });
  }
}

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) throw new Error(`unexpected argument ${flag}`);
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (!options.model || !options.out) throw new Error("usage: export_snapshots.mjs --model model.json --out dir [--views a,b] [--states 1,3|id,id] [--viewer-url URL] [--template template.html]");
    const { files, manifest } = await exportSnapshots({
      modelPath: resolve(options.model), outDir: resolve(options.out), template: options.template ? resolve(options.template) : DEFAULT_TEMPLATE,
      views: options.views?.split(",").filter(Boolean), states: options.states?.split(",").filter(Boolean), viewerUrl: options["viewer-url"],
    });
    files.forEach(entry => console.log(entry.file));
    console.log(`exported ${files.length} snapshot(s), ${basename(manifest)} and snapshots.md to ${resolve(options.out)}`);
  } catch (error) {
    console.error(`export_snapshots: ${error.message}`);
    process.exit(error.message.startsWith("usage:") ? 2 : 1);
  }
}
