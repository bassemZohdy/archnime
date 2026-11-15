/* Shared harness for the documentation-export tests (node --test files).
 *
 * Each test builds a real HTML bundle from a portable model with the shipped
 * builder, opens it in Chromium, waits for the renderer, and talks to the page
 * through the same window functions the toolbar uses. Nothing here patches the
 * generated HTML.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../scripts/python_command.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
export const ROOT = resolve(HERE, "../..");
export const TEMPLATE = join(ROOT, "architecture-diagram-renderer", "assets", "template.html");
const BUILDER = join(ROOT, "architecture-diagram-renderer", "scripts", "build_bundle.py");
export const FIXTURES = join(ROOT, "architecture-diagram-renderer", "tests", "fixtures");
export const EXAMPLES = join(ROOT, "architecture-diagram-renderer", "assets", "examples");
export const REQUIRED = process.env.REQUIRE_BROWSER_TESTS === "1";

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

export const chromium = await loadChromium();

/** node:test `skip` option: a missing browser is a skip locally and a failure under CI. */
export function browserSkip() {
  if (chromium) return false;
  if (REQUIRED) throw new Error("Playwright/Chromium is required (REQUIRE_BROWSER_TESTS=1) but unavailable");
  return "Playwright/Chromium unavailable";
}

/**
 * Open a model in the renderer. `template` lets a test point at another template file
 * (used to prove a test fails against a known-bad one).
 */
export async function openDiagram(modelPath, { viewport = { width: 1440, height: 900 }, query = "", template = TEMPLATE, colorScheme, acceptDownloads } = {}) {
  const work = mkdtempSync(join(tmpdir(), "doc-export-"));
  const html = join(work, "diagram.html");
  execFileSync(PYTHON, [BUILDER, "--template", template, "--model", modelPath, "--output", html]);
  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  const page = await browser.newPage({ viewport, reducedMotion: "reduce", ...(colorScheme ? { colorScheme } : {}), ...(acceptDownloads === undefined ? {} : { acceptDownloads }) });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(pathToFileURL(html).href + query, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
  await page.evaluate(() => window.diagramReady);
  await page.waitForTimeout(400);
  return {
    page,
    pageErrors,
    async close() {
      await browser.close();
      rmSync(work, { recursive: true, force: true });
    },
  };
}

/** The documentation SVG the way the toolbar produces it, or the error it throws. */
export function documentationSvg(page) {
  return page.evaluate(() => {
    try { return { svg: window.serializeDocumentationSvg() }; }
    catch (error) { return { error: String(error.message || error) }; }
  });
}
