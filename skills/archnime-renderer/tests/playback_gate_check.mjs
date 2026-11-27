/* TASK-037: playback regression gate, ported from the comparison harness
 * (tech-reports, animated-diagram-technology-choice/evidence/measure: measure.py
 * and measure_loop.py). The same four measurements at 1280 x 800 in the offline
 * single-file build, on a staged diagram (the three-stage strangler-migration
 * example) and on a flow walkthrough (checkout-flow, whose wires carry animated
 * dashes, the only continuous motion the renderer has):
 *
 *   1. Pause freezes motion: two screenshots 2.5 s apart after Pause differ in
 *      under 0.05% of pixels, the step does not advance, and Play resumes. Added
 *      to the harness: no visible element may still be animating, because thin
 *      moving marks stay under the pixel threshold.
 *   2. Back, Next and jump work while playing: each lands on the right step.
 *   3. No text under 12 px: effective on-screen size of every visible text
 *      element at the last step (SVG text through its screen transform).
 *   4. Loop length: time from Play at the first step until playback wraps to it
 *      again, or, when playback does not loop, until it stops after the last step.
 *
 * It also fails on a console error or a network request, as the harness counted.
 *
 * A measurement the renderer does not meet today is listed in
 * `playback-gate-budgets.json` as a known gap with the value measured when it was
 * recorded. The gate then fails when that value gets worse, and also when the
 * target is met, so the entry is removed rather than left stale. Everything not
 * listed is a hard requirement.
 *
 *   node skills/archnime-renderer/tests/playback_gate_check.mjs [--write-budgets]
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { retainWork } from "./retain_artifacts.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const EXAMPLES = join(ROOT, "archnime-dsl", "assets", "examples");
const TEMPLATE = join(ROOT, "archnime-renderer", "assets", "template.html");
const TRANSLATOR = join(ROOT, "archnime-dsl", "scripts", "translate_transition_diagram.py");
const BUILDER = join(ROOT, "archnime-renderer", "scripts", "build_bundle.py");
const BUDGETS = join(HERE, "playback-gate-budgets.json");
// `steps` selects the numbered step buttons, `button` the n-th of them, and
// `active` is the attribute that marks the current one.
const DIAGRAMS = [
  { name: "dsl/strangler-migration", source: "strangler-migration.yaml", steps: "#pills button", button: n => `#pills button:nth-child(${n})`, active: ["aria-pressed", "true"], intervalOf: meta => meta.playIntervalMs || 3000 },
  { name: "dsl/checkout-flow", source: "checkout-flow.yaml", steps: "#flow-timeline button", button: n => `#flow-timeline > span:nth-child(${n}) button`, active: ["aria-current", "step"], intervalOf: meta => meta.flow?.autoAdvanceMs || meta.playIntervalMs || 3000 },
];
const required = process.env.REQUIRE_BROWSER_TESTS === "1";
const writeBudgets = process.argv.includes("--write-budgets");

// Thresholds of the harness: a frame pair counts as frozen under 0.05% changed
// pixels (a pixel changed when its luminance moved by more than 12 of 255), and
// text counts as small under 11.9 px effective size.
const FROZEN_FRACTION = 0.0005, PIXEL_DELTA = 12, SMALL_TEXT_PX = 11.9;

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.log(`${required ? "FAIL" : "SKIP"} playback_gate_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

// measure.py JS_TEXT: characters of visible text and their effective size.
const TEXT_SIZES = `(() => {
  let total = 0, small = 0, minPx = Infinity, elements = 0; const smallest = [];
  for (const el of document.querySelectorAll("body *")) {
    if (["SCRIPT", "STYLE", "TITLE"].includes(el.tagName)) continue;
    let text = ""; for (const child of el.childNodes) if (child.nodeType === 3) text += child.textContent;
    text = text.trim(); if (text.length < 3) continue;
    let opacity = 1, shown = true;
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.display === "none" || style.visibility === "hidden") { shown = false; break; }
      opacity *= parseFloat(style.opacity);
    }
    if (!shown || opacity < .3) continue;
    const box = el.getBoundingClientRect(); if (box.width < 1 || box.height < 1) continue;
    const size = parseFloat(getComputedStyle(el).fontSize); let effective = size;
    if (el instanceof SVGElement) { const m = el.getScreenCTM && el.getScreenCTM(); if (m) effective = size * Math.sqrt(m.a * m.a + m.b * m.b); }
    else if (el.offsetWidth > 0) effective = size * box.width / el.offsetWidth;
    total += text.length; elements += 1;
    if (effective < ${SMALL_TEXT_PX}) { small += text.length; smallest.push([Math.round(effective * 10) / 10, (el.getAttribute("class") || el.tagName).toString().slice(0, 40), text.slice(0, 30)]); }
    if (effective < minPx) minPx = effective;
  }
  smallest.sort((a, b) => a[0] - b[0]);
  return { chars: total, smallChars: small, minPx, elements, smallest: smallest.slice(0, 5) };
})()`;

// Runs in the differ page: the fraction of pixels whose luminance changed.
const CHANGED_FRACTION = async ([first, second, delta]) => {
  const load = async data => {
    const image = new Image(); image.src = "data:image/png;base64," + data; await image.decode();
    const canvas = new OffscreenCanvas(image.width, image.height), context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, image.width, image.height).data;
  };
  const x = await load(first), y = await load(second), luma = (data, i) => .299 * data[i] + .587 * data[i + 1] + .114 * data[i + 2];
  let changed = 0;
  for (let i = 0; i < x.length; i += 4) if (Math.abs(luma(x, i) - luma(y, i)) > delta) changed += 1;
  return changed / (x.length / 4);
};

const work = mkdtempSync(join(tmpdir(), "playback-gate-"));
let browser, crashed = true;
const failures = [], lines = [];
const budgets = existsSync(BUDGETS) ? JSON.parse(readFileSync(BUDGETS, "utf8")) : { knownGaps: {} };
budgets.knownGaps ||= {};

async function measure(diagram, differ) {
  const fail = message => failures.push(`${diagram.name}: ${message}`), measured = {}, notes = [];
  const base = diagram.source.replace(/\.yaml$/, ""), model = join(work, `${base}.json`), html = join(work, `${base}.html`);
  execFileSync(PYTHON, [TRANSLATOR, join(EXAMPLES, diagram.source), "--output", model], { stdio: "pipe" });
  execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", model, "--output", html, "--inline", "--offline"], { stdio: "pipe" });
  const intervalMs = diagram.intervalOf(JSON.parse(readFileSync(model, "utf8")).meta || {});

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "no-preference" });
  const errors = [], requests = [];
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", error => errors.push(`page error ${error}`));
  page.on("request", request => { if (!/^(file|data|blob):/.test(request.url())) requests.push(request.url()); });
  await page.goto(pathToFileURL(html).href, { waitUntil: "load", timeout: 120000 });
  await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
  await page.evaluate(() => window.diagramReady);
  await page.waitForTimeout(1200);

  const changedFraction = (a, b) => differ.evaluate(CHANGED_FRACTION, [a, b, PIXEL_DELTA]);
  const shot = async () => (await page.screenshot()).toString("base64");
  const where = { steps: diagram.steps, name: diagram.active[0], value: diagram.active[1] };
  const currentStep = ({ steps, name, value }) => [...document.querySelectorAll(steps)].findIndex(button => button.getAttribute(name) === value) + 1;
  const step = () => page.evaluate(currentStep, where);
  // Click and report the step the click was made on, in one tick, so playback cannot move in between.
  const clickAt = selector => page.evaluate(({ steps, name, value, selector }) => {
    const before = [...document.querySelectorAll(steps)].findIndex(button => button.getAttribute(name) === value) + 1;
    document.querySelector(selector).click();
    return before;
  }, { ...where, selector });
  const waitStep = async (wanted, timeoutMs = 3500) => {
    try { await page.waitForFunction(({ steps, name, value, wanted }) => [...document.querySelectorAll(steps)].findIndex(button => button.getAttribute(name) === value) + 1 === wanted, { ...where, wanted }, { timeout: timeoutMs }); } catch {}
    return step();
  };
  const count = await page.evaluate(selector => document.querySelectorAll(selector).length, diagram.steps);
  if (count < 3) throw new Error(`${diagram.name}: the gate needs at least three steps to move between, found ${count}`);
  const playing = () => page.evaluate(() => document.getElementById("btn-play").textContent.includes("Pause"));
  const play = async () => { if (!(await playing())) await page.click("#btn-play"); if (!(await playing())) fail("Play did not start playback"); };
  const pause = async () => { if (await playing()) await page.click("#btn-play"); };
  const jump = async target => { await clickAt(diagram.button(target)); return waitStep(target); };

  // 2. Back, Next and jump while playing. Each press is made while the page
  // plays and must land on the right step.
  const before = failures.length;
  await jump(1); await play();
  const fromNext = await clickAt("#btn-next"), afterNext = await waitStep(fromNext + 1);
  if (afterNext !== fromNext + 1) fail(`Next while playing: step ${fromNext} -> ${afterNext}, expected ${fromNext + 1}`);
  await jump(2); await play();
  const fromBack = await clickAt("#btn-prev"), afterBack = await waitStep(fromBack - 1);
  if (afterBack !== fromBack - 1) fail(`Back while playing: step ${fromBack} -> ${afterBack}, expected ${fromBack - 1}`);
  for (const target of [count, 1]) {
    await jump(2); await play();
    const landed = await jump(target);
    if (landed !== target) fail(`jump while playing: landed on step ${landed}, expected ${target}`);
  }
  measured.navigation = failures.length > before ? "failed" : "ok";

  // The instrument must see motion before "no motion" means anything: a step
  // change between two frames has to register as changed pixels.
  await jump(1); await page.waitForTimeout(900);
  const still = await shot(); await jump(2); await page.waitForTimeout(900);
  measured.stepChangeFraction = await changedFraction(still, await shot());
  if (!(measured.stepChangeFraction > FROZEN_FRACTION)) fail(`the pixel comparison saw no change across a step change (${measured.stepChangeFraction})`);

  // 1. Pause freezes motion. Motion while playing is measured first, within one
  // step, so a frozen result is known to be a change from moving.
  await jump(1); await play(); await page.mouse.move(5, 5); await page.waitForTimeout(150);
  const movingA = await shot(); await page.waitForTimeout(300);
  measured.playingFraction = await changedFraction(movingA, await shot());
  await pause(); await page.waitForTimeout(700);
  const pausedAt = await step(), frameA = await shot(); await page.waitForTimeout(2500); const frameB = await shot();
  measured.pauseChangedFraction = await changedFraction(frameA, frameB);
  // The pixel threshold tolerates a little motion, so thin moving marks can stay
  // under it. Count what is still animating as well: this has no tolerance.
  measured.movingWhenPaused = await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.target?.getClientRects().length).length);
  await page.waitForTimeout(Math.max(0, intervalMs - 2500) + 400);
  if ((await step()) !== pausedAt) fail(`Pause: the step advanced from ${pausedAt} to ${await step()} while paused`);
  await play();
  if ((await waitStep(pausedAt + 1, intervalMs + 1500)) !== pausedAt + 1) fail("Play after Pause did not resume: the next step never came");
  await pause();

  // 3. Text size at the last step, once it has drawn.
  await jump(count); await page.mouse.move(5, 5); await page.waitForTimeout(1500);
  const text = await page.evaluate(TEXT_SIZES);
  measured.minTextPx = Math.round(text.minPx * 10) / 10;
  measured.smallTextPercent = Math.round(1000 * text.smallChars / Math.max(1, text.chars)) / 10;
  if (text.smallest.length) notes.push(`smallest text: ${text.smallest.map(([px, kind, sample]) => `${px}px ${kind} "${sample}"`).join("; ")}`);

  // 4. Loop length: Play from the first step until it wraps or stops.
  await jump(1); await page.waitForTimeout(300);
  const started = Date.now(); await play();
  let seenLast = false, wrapped = false; const deadline = started + count * intervalMs * 2 + 10000;
  while (Date.now() < deadline) {
    const now = await step();
    if (now === count) seenLast = true;
    if (seenLast && now === 1) { wrapped = true; break; }
    if (seenLast && !(await playing())) break;
    await page.waitForTimeout(50);
  }
  if (!seenLast) fail("playback never reached the last step");
  measured.loops = wrapped;
  measured.runSeconds = Math.round((Date.now() - started) / 100) / 10;
  // Without a loop the last step is held for one interval before playback stops.
  const expectedSeconds = count * intervalMs / 1000;
  if (seenLast && Math.abs(measured.runSeconds - expectedSeconds) > 1.5) fail(`run length ${measured.runSeconds} s is not the ${expectedSeconds} s that ${count} steps at ${intervalMs} ms give`);
  await pause();

  errors.forEach(error => fail(`console error: ${error}`));
  requests.forEach(url => fail(`network request from the offline build: ${url}`));
  await page.close();

  // Targets, with known gaps taken from the budget file.
  const targets = {
    pauseChangedFraction: { met: measured.pauseChangedFraction < FROZEN_FRACTION, worse: (now, was) => now > was * 1.5 + FROZEN_FRACTION, text: `pause leaves ${(measured.pauseChangedFraction * 100).toFixed(3)}% of pixels moving (target under ${FROZEN_FRACTION * 100}%)` },
    movingWhenPaused: { met: measured.movingWhenPaused === 0, worse: (now, was) => now > was, text: `${measured.movingWhenPaused} element(s) keep animating after Pause (target 0)` },
    minTextPx: { met: measured.minTextPx >= SMALL_TEXT_PX, worse: (now, was) => now < was - .1, text: `smallest text is ${measured.minTextPx} px (target 12 px)` },
    smallTextPercent: { met: measured.smallTextPercent === 0, worse: (now, was) => now > was + .5, text: `${measured.smallTextPercent}% of text characters are under 12 px (target 0%)` },
  };
  if (writeBudgets) budgets.knownGaps[diagram.name] = Object.fromEntries(Object.entries(targets).filter(([, target]) => !target.met).map(([key]) => [key, measured[key]]));
  const gaps = budgets.knownGaps[diagram.name] || {};
  for (const [key, target] of Object.entries(targets)) {
    const recorded = gaps[key];
    if (recorded === undefined) { if (!target.met) fail(target.text); }
    else if (target.met) fail(`${key} now meets its target: remove it from playback-gate-budgets.json`);
    else if (target.worse(measured[key], recorded)) fail(`${target.text}; worse than the recorded ${recorded}`);
    else notes.push(`known gap: ${target.text}; recorded ${recorded}`);
  }
  lines.push(`${diagram.name}: ${count} steps at ${intervalMs} ms; navigation while playing ${measured.navigation}; pause changed ${(measured.pauseChangedFraction * 100).toFixed(3)}% of pixels with ${measured.movingWhenPaused} element(s) still animating (playing ${(measured.playingFraction * 100).toFixed(3)}%, a step change ${(measured.stepChangeFraction * 100).toFixed(2)}%); smallest text ${measured.minTextPx} px, ${measured.smallTextPercent}% of characters under 12 px; ${measured.loops ? "loop" : "one run, no loop,"} ${measured.runSeconds} s`, ...notes.map(note => `  ${note}`));
}

try {
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  const differ = await browser.newPage();
  for (const diagram of DIAGRAMS) await measure(diagram, differ);
  if (writeBudgets) {
    writeFileSync(BUDGETS, `${JSON.stringify({ note: "Measurements the renderer does not meet yet, with the value when recorded. playback_gate_check.mjs fails when one gets worse or when its target is met. Rewrite with --write-budgets after review.", knownGaps: budgets.knownGaps }, null, 2)}\n`);
    lines.push(`wrote ${BUDGETS}`);
  }
  crashed = false;
} finally {
  if (browser) await browser.close();
  retainWork(work, "playback_gate_check", crashed || failures.length > 0);
  rmSync(work, { recursive: true, force: true });
}

lines.forEach(line => console.log(line));
if (failures.length) {
  failures.forEach(failure => console.log(`FAIL ${failure}`));
  process.exit(1);
}
console.log("playback_gate_check passed");
