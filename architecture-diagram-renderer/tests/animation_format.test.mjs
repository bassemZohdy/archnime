/* TASK-006.2: is a SMIL variant of the Animated SVG worth its complexity?
 *
 * The exporter writes CSS keyframes only. SMIL (<animate>) would be a second renderer to keep in step with
 * it, so it is only worth adding for a destination that is verified to ignore CSS animation. This test
 * measures what can be measured here, in every browser engine installed (Chromium always; Firefox and
 * WebKit when a build is found), and pins the decision:
 *
 *   - CSS keyframes play the stages in order in every measured engine, honour prefers-reduced-motion and
 *     degrade to the first stage;
 *   - SMIL plays them in order too, but no measured engine lets prefers-reduced-motion stop it, so it would
 *     be an accessibility regression, not a fix;
 *   - the exporter contains no SMIL, so there is a single renderer.
 *
 * Engines that are not installed are reported as "not measured" in the test output. Office, Google Docs,
 * GitHub's image proxy and other sanitising destinations cannot be run here: that is a limitation of this
 * evidence, recorded in documentation-export.md, not a pass.
 */
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { FIXTURES, TEMPLATE, browserSkip, chromium, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const STAGES = 4, STEP = 2000, CYCLE = STAGES * STEP;

async function playwrightCore() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href); } catch {}
  }
  return null;
}

/** Launchers for every engine that starts here: the registered build, else the newest installed one. */
async function engines() {
  const found = [{ name: "chromium", launch: () => chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined) }];
  const core = await playwrightCore();
  const caches = [process.env.PLAYWRIGHT_BROWSERS_PATH, process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright"), join(homedir(), "AppData", "Local", "ms-playwright"), join(homedir(), "Library", "Caches", "ms-playwright"), join(homedir(), ".cache", "ms-playwright")].filter(Boolean);
  for (const [name, folder, executables] of [["firefox", "firefox-", ["firefox/firefox.exe", "firefox/firefox", "firefox/Nightly.app/Contents/MacOS/firefox"]], ["webkit", "webkit-", ["Playwright.exe", "pw_run.sh", "Playwright.app/Contents/MacOS/Playwright"]]]) {
    if (!core?.[name]) continue;
    const candidates = [{ launch: () => core[name].launch({ timeout: 20000 }) }];
    for (const cache of caches) {
      if (!existsSync(cache)) continue;
      for (const directory of readdirSync(cache).filter(entry => entry.startsWith(folder)).sort().reverse()) {
        const executable = executables.map(relative => join(cache, directory, relative)).find(existsSync);
        if (executable) candidates.push({ launch: () => core[name].launch({ executablePath: executable, timeout: 20000 }) });
      }
    }
    for (const candidate of candidates) {
      try { const browser = await candidate.launch(); await browser.close(); found.push({ name, launch: candidate.launch }); break; } catch {}
    }
  }
  return found;
}

/** The same four-stage timing as the exporter, in CSS keyframes or SMIL. Stage k is a rectangle at x = 100 * k. */
function syntheticSvg(format) {
  const fraction = 100 / STAGES;
  const groups = Array.from({ length: STAGES }, (_, index) => {
    const rect = `<rect x="${100 * index + 10}" y="10" width="60" height="60" fill="#0f9bb5"/>`;
    return format === "css"
      ? `<g id="stage-${index + 1}" class="stage" style="--delay:${index * STEP}ms">${rect}</g>`
      : `<g id="stage-${index + 1}" visibility="${index === 0 ? "visible" : "hidden"}"><animate attributeName="visibility" calcMode="discrete" keyTimes="0;${1 / STAGES};1" values="visible;hidden;hidden" dur="${CYCLE}ms" begin="${index * STEP}ms" repeatCount="indefinite"/>${rect}</g>`;
  }).join("");
  const style = format === "css"
    ? `<style>.stage{opacity:0;visibility:hidden;animation:slot ${CYCLE}ms linear infinite;animation-delay:var(--delay)}#stage-1{opacity:1;visibility:visible}@keyframes slot{0%,${fraction - 1}%{opacity:1;visibility:visible}${fraction}%,100%{opacity:0;visibility:hidden}}@media(prefers-reduced-motion:reduce){.stage{animation:none}}</style>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${100 * STAGES}" height="80" viewBox="0 0 ${100 * STAGES} 80">${style}${groups}</svg>`;
}

/** Which stage rectangles can be hit at each slot of the cycle, and how many animations are still running. */
async function measure(browser, svg, reducedMotion) {
  const context = await browser.newContext({ reducedMotion });
  try {
    const page = await context.newPage();
    await page.setContent(`<body style="margin:0">${svg}</body>`);
    return await page.evaluate(({ stages, step }) => {
      const root = document.querySelector("svg"), running = () => (document.getAnimations ? document.getAnimations().filter(a => a.playState === "running").length : 0) + (root.animationsPaused && !root.animationsPaused() ? document.querySelectorAll("animate").length : 0);
      const stillAnimating = running() > 0;
      root.pauseAnimations?.();
      document.getAnimations?.().forEach(animation => animation.pause());
      const slots = [];
      for (let slot = 0; slot < stages; slot += 1) {
        const time = slot * step + step * 0.25;
        root.setCurrentTime?.(time / 1000);
        document.getAnimations?.().forEach(animation => { animation.currentTime = time; });
        const shown = [];
        for (let stage = 0; stage < stages; stage += 1) {
          const element = document.elementFromPoint(100 * stage + 40, 40);
          if (element && element.tagName === "rect") shown.push(stage + 1);
        }
        slots.push(shown);
      }
      return { slots, stillAnimating };
    }, { stages: STAGES, step: STEP });
  } finally { await context.close(); }
}

test("CSS keyframes and SMIL measured in every installed engine; CSS is the single supported format", { skip }, async t => {
  const available = await engines();
  const table = [];
  for (const { name, launch } of available) {
    const browser = await launch();
    try {
      const css = await measure(browser, syntheticSvg("css"), "no-preference");
      const cssReduced = await measure(browser, syntheticSvg("css"), "reduce");
      const smil = await measure(browser, syntheticSvg("smil"), "no-preference");
      const smilReduced = await measure(browser, syntheticSvg("smil"), "reduce");
      const inOrder = result => result.slots.every((shown, slot) => shown.length === 1 && shown[0] === slot + 1);
      table.push({ engine: name, version: browser.version(), cssInOrder: inOrder(css), cssReducedShowsFirstOnly: cssReduced.slots.every(shown => shown.length === 1 && shown[0] === 1) && !cssReduced.stillAnimating, smilInOrder: inOrder(smil), smilStopsOnReducedMotion: !smilReduced.stillAnimating });
    } finally { await browser.close(); }
  }
  t.diagnostic(`measured engines: ${table.map(row => `${row.engine} ${row.version}`).join(", ")}`);
  table.forEach(row => t.diagnostic(JSON.stringify(row)));
  assert.ok(table.some(row => row.engine === "chromium"), "Chromium is the required engine");
  for (const row of table) {
    assert.equal(row.cssInOrder, true, `${row.engine}: CSS keyframes must play the stages in order`);
    assert.equal(row.cssReducedShowsFirstOnly, true, `${row.engine}: CSS keyframes must stop and show the first stage under reduced motion`);
    assert.equal(row.smilStopsOnReducedMotion, false, `${row.engine}: SMIL turned out to honour reduced motion; revisit the decision to keep CSS only`);
  }
});

test("the exporter writes CSS keyframes only: one renderer, no SMIL", () => {
  const template = readFileSync(TEMPLATE, "utf8");
  const start = template.indexOf("async function serializeAnimatedSvg"), end = template.indexOf("async function exportAnimatedSvg");
  assert.ok(start > 0 && end > start);
  const exporter = template.slice(start, end);
  assert.match(exporter, /@keyframes animated-stage-slot/);
  assert.doesNotMatch(exporter, /<animate\b|<set\b|animateTransform|animateMotion|begin=/, "a SMIL variant would be a second renderer");
});

test("the real Animated SVG export contains no SMIL in the browser either", { skip }, async () => {
  const diagram = await openDiagram(join(FIXTURES, "checkout-flow.json"));
  try {
    const svg = await diagram.page.evaluate(() => window.serializeAnimatedSvg());
    assert.doesNotMatch(svg, /<animate\b|<set\b|animateTransform|animateMotion/);
    assert.match(svg, /@keyframes animated-stage-slot/);
  } finally { await diagram.close(); }
});
