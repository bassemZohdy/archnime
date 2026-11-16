/* Responsive visual evidence audit for representative renderer regressions. */
import { execFileSync, execSync } from "node:child_process";
import { pathToFileURL, fileURLToPath } from "node:url";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join, basename } from "node:path";
import { PYTHON } from "../../../scripts/python_command.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const SKILL = resolve(HERE, "..");
const TEMPLATE = join(SKILL, "assets", "template.html");
const BUILDER = join(SKILL, "scripts", "build_bundle.py");
const BROWSER_EXECUTABLE = process.env.BROWSER_EXECUTABLE;
const OUTPUT = resolve(process.argv[2] || process.env.SANDBOX_PREVIEW_DIR || join(ROOT, ".sandbox", "visual-audit"));
const BUNDLES = join(OUTPUT, "bundles");
const SCREENSHOTS = join(OUTPUT, "screenshots");
mkdirSync(BUNDLES, { recursive: true });
mkdirSync(SCREENSHOTS, { recursive: true });

const MODELS = [
  { id: "checkout-flow", path: join(HERE, "fixtures", "checkout-flow.json") },
  { id: "boundary-label-collision-model", path: join(SKILL, "assets", "examples", "boundary-label-collision-model.json") },
  { id: "deep-nested-crosscut", path: join(HERE, "fixtures", "deep-nested-crosscut.json") },
  { id: "wire-routing-style", path: join(HERE, "fixtures", "wire-routing-style.json") },
];
const VIEWPORTS = [
  { id: "wide", width: 1400, height: 900 },
  { id: "medium", width: 900, height: 800 },
  { id: "narrow", width: 420, height: 900 },
];
const VARIANTS = [
  { id: "screen", media: "screen", presenter: false },
  { id: "presenter", media: "screen", presenter: true },
  { id: "print", media: "print", presenter: false },
];

async function loadChromium() {
  const candidates = [];
  try { candidates.push(join(execSync("npm root -g", { encoding: "utf8", shell: true }).trim(), "playwright-core")); } catch {}
  try { candidates.push(join(execSync("npm root", { encoding: "utf8", shell: true }).trim(), "playwright-core")); } catch {}
  for (const directory of candidates) {
    const entry = join(directory, "index.mjs");
    if (existsSync(entry)) { try { const module = await import(pathToFileURL(entry).href); return module.chromium; } catch {} }
  }
  try {
    const module = await import("playwright");
    return module.chromium;
  } catch {
    return null;
  }
}

function buildBundle(modelPath, outputPath) {
  execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", modelPath, "--output", outputPath], { stdio: "pipe" });
}

const chromium = await loadChromium();
if (!chromium) {
  console.error("visual_audit: Playwright is not installed; install dependencies before running the visual audit");
  process.exit(2);
}

const browser = await chromium.launch(BROWSER_EXECUTABLE ? { executablePath: BROWSER_EXECUTABLE } : undefined);
const results = [];
let failures = 0;

try {
  for (const modelInfo of MODELS) {
    const model = JSON.parse(readFileSync(modelInfo.path, "utf8"));
    const bundlePath = join(BUNDLES, `${modelInfo.id}.html`);
    buildBundle(modelInfo.path, bundlePath);
    for (const viewport of VIEWPORTS) {
      for (const variant of VARIANTS) {
        const page = await browser.newPage({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
        const pageErrors = [];
        const consoleErrors = [];
        page.on("pageerror", error => pageErrors.push(String(error)));
        page.on("console", message => { if (message.type() === "error") consoleErrors.push(message.text()); });
        const screenshotName = `${modelInfo.id}__${viewport.id}__${variant.id}.png`;
        const screenshotPath = join(SCREENSHOTS, screenshotName);
        const outcome = { model: modelInfo.id, viewport, variant: variant.id, screenshot: `screenshots/${screenshotName}`, pageErrors, consoleErrors, checks: {}, selfCheckIssues: [] };
        try {
          await page.emulateMedia({ media: variant.media });
          await page.goto(pathToFileURL(bundlePath).href, { waitUntil: "load" });
          await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 30000 });
          if (variant.presenter) {
            await page.locator("#btn-presenter").click();
            await page.waitForFunction(() => document.body.classList.contains("presenter"));
          }
          outcome.checks = await page.evaluate(() => {
            const model = JSON.parse(document.getElementById("diagram-model").textContent);
            const scroller = document.querySelector(".scroller");
            const controls = document.querySelector(".controls");
            const visible = element => {
              if (!element) return false;
              const style = getComputedStyle(element);
              const box = element.getBoundingClientRect();
              return style.display !== "none" && style.visibility !== "hidden" && box.width > 0 && box.height > 0;
            };
            const boundaryLabels = [...document.querySelectorAll("g.boundary text")];
            const markers = [...document.querySelectorAll("g.flow-marker")];
            const pageWidth = Math.max(document.documentElement.scrollWidth, document.body?.scrollWidth || 0);
            const width = window.innerWidth;
            return {
              pageHorizontalOverflow: pageWidth > width + 1,
              scrollerBounded: !!scroller && scroller.getBoundingClientRect().width <= width + 1,
              nodeCount: document.querySelectorAll("g.nodes > g.node").length,
              flowMarkerCount: markers.length,
              flowMarkersVisible: markers.length === 0 || markers.every(visible),
              boundaryLabelCount: boundaryLabels.length,
              boundaryLabelsVisible: boundaryLabels.length === 0 || boundaryLabels.every(label => label.textContent.trim() && visible(label)),
              presenterEnabled: document.body.classList.contains("presenter"),
              printControlsHidden: window.matchMedia("print").matches ? getComputedStyle(controls).display === "none" : true,
              modelHasFlow: !!model.flow,
              modelHasBoundaries: (model.stages || []).some(stage => (stage.boundaries || []).length > 0),
            };
          });
          outcome.selfCheckIssues = await page.evaluate(() => window.diagramSelfCheck ? window.diagramSelfCheck() : [{ type: "missing-self-check" }]);
          await page.screenshot({ path: screenshotPath, fullPage: true });
        } catch (error) {
          outcome.error = String(error?.message || error);
          failures += 1;
        }
        const checks = outcome.checks;
        const requiredFailures = [];
        if (checks.pageHorizontalOverflow) requiredFailures.push("page horizontal overflow");
        if (!checks.scrollerBounded) requiredFailures.push("diagram scroller exceeds viewport");
        if (checks.modelHasFlow && (!checks.flowMarkerCount || !checks.flowMarkersVisible)) requiredFailures.push("flow markers are missing or invisible");
        if (checks.modelHasBoundaries && (!checks.boundaryLabelCount || !checks.boundaryLabelsVisible)) requiredFailures.push("boundary labels are missing or invisible");
        if (variant.presenter && !checks.presenterEnabled) requiredFailures.push("presenter mode did not activate");
        if (variant.media === "print" && !checks.printControlsHidden) requiredFailures.push("print controls remain visible");
        if (pageErrors.length || consoleErrors.length) requiredFailures.push("browser console/page errors");
        if (outcome.selfCheckIssues.length) requiredFailures.push(`renderer self-check issues (${outcome.selfCheckIssues.map(issue => issue.type || "unknown").join(", ")})`);
        if (requiredFailures.length) { outcome.failures = requiredFailures; failures += 1; }
        results.push(outcome);
        console.log(`${requiredFailures.length ? "✗" : "✓"} ${modelInfo.id} ${viewport.id} ${variant.id}${requiredFailures.length ? ` — ${requiredFailures.join(", ")}` : ""}`);
        await page.close();
      }
    }
  }
} finally {
  await browser.close();
}

const summary = {
  models: MODELS.map(model => model.id),
  viewports: VIEWPORTS,
  variants: VARIANTS,
  runs: results.length,
  failures,
  results,
};
writeFileSync(join(OUTPUT, "visual-audit.json"), JSON.stringify(summary, null, 2) + "\n", "utf8");
const index = [
  "# Responsive visual audit",
  "",
  "Representative renderer bundles were checked at wide, medium, and narrow viewports in screen, presenter, and print media.",
  "",
  `- Runs: ${results.length}`,
  `- Failures: ${failures}`,
  "- Machine checks: page overflow, bounded scroller, browser errors, flow-marker visibility, boundary-label visibility, presenter activation, and print controls.",
  "",
  "- [Machine results](visual-audit.json)",
  "- [Screenshots](screenshots/)",
  "- [Bundles](bundles/)",
  "",
  failures ? "Specific findings are recorded per run in `visual-audit.json`." : "All required viewport and mode checks passed.",
  "",
].join("\n");
writeFileSync(join(OUTPUT, "artifact-index.md"), index, "utf8");
process.exit(failures ? 1 : 0);
