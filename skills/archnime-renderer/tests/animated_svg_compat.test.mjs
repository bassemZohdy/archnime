/* TASK-006.1: the animated SVG (CSS keyframes) plays every stage in order, and degrades to a
 * readable first stage where animation is off or unsupported.
 *
 * "Supported viewers show all intended stages or an accessible first-frame fallback":
 *   - normal motion: stage k is the only stage visible during the k-th slot, in order;
 *   - prefers-reduced-motion: stage 1 only, and it stays;
 *   - a viewer that reads the stylesheet but does not run CSS animation (or a sanitizer that drops
 *     the animation declarations): stage 1 only, never a blank image;
 *   - embedded as an <img>, the file draws something in every one of those modes.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { FIXTURES, browserSkip, chromium, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const temporary = [];
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));

let cached;
async function animatedSvg() {
  if (cached) return cached;
  const diagram = await openDiagram(join(FIXTURES, "checkout-flow.json"));
  try {
    const svg = await diagram.page.evaluate(() => window.serializeAnimatedSvg());
    const directory = mkdtempSync(join(tmpdir(), "animated-svg-"));
    temporary.push(directory);
    const path = join(directory, "animated.svg");
    writeFileSync(path, svg);
    cached = { svg, path, directory };
    return cached;
  } finally { await diagram.close(); }
}

async function withPage(options, run) {
  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  try {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    return await run(page);
  } finally { await browser.close(); }
}

const visibleStages = () => [...document.querySelectorAll("g.animated-stage")].filter(group => getComputedStyle(group).visibility === "visible" && Number(getComputedStyle(group).opacity) > 0).map(group => group.id);

test("normal motion: each stage owns one slot of the cycle, in order, and only that stage shows", { skip }, async () => {
  const { path, svg } = await animatedSvg();
  const stages = (svg.match(/class="animated-stage stage-\d+"/g) || []).length;
  assert.ok(stages >= 3, "the checkout flow has several steps");
  const seen = await withPage({}, async page => {
    await page.goto(pathToFileURL(path).href);
    return page.evaluate(count => {
      const animations = document.getAnimations();
      const cycle = animations[0].effect.getTiming().duration, step = cycle / count, seen = [];
      for (let slot = 0; slot < count; slot += 1) {
        animations.forEach(animation => { animation.pause(); animation.currentTime = slot * step + step * 0.25; });
        seen.push([...document.querySelectorAll("g.animated-stage")].filter(group => getComputedStyle(group).visibility === "visible" && Number(getComputedStyle(group).opacity) > 0).map(group => group.id));
      }
      return seen;
    }, stages);
  });
  seen.forEach((ids, slot) => assert.deepEqual(ids, [`stage-${slot + 1}`], `slot ${slot + 1} of the cycle should show stage-${slot + 1} alone, showed ${JSON.stringify(ids)}`));
});

test("reduced motion: the first stage shows and nothing animates", { skip }, async () => {
  const { path } = await animatedSvg();
  const result = await withPage({ reducedMotion: "reduce" }, async page => {
    await page.goto(pathToFileURL(path).href);
    return page.evaluate(() => ({ visible: [...document.querySelectorAll("g.animated-stage")].filter(group => getComputedStyle(group).visibility === "visible" && Number(getComputedStyle(group).opacity) > 0).map(group => group.id), running: document.getAnimations().length }));
  });
  assert.deepEqual(result.visible, ["stage-1"]);
  assert.equal(result.running, 0);
});

test("a viewer that ignores CSS animation still shows the first stage, not a blank image", { skip }, async () => {
  const { svg, directory } = await animatedSvg();
  // Same file with every animation declaration dropped, as a sanitizer or a limited renderer would.
  const stripped = svg.replace(/animation(-delay)?:[^;}]*[;}]/g, match => match.endsWith("}") ? "}" : "");
  assert.notEqual(stripped, svg, "the file has animation declarations to strip");
  const path = join(directory, "no-animation.svg");
  writeFileSync(path, stripped);
  const visible = await withPage({}, async page => {
    await page.goto(pathToFileURL(path).href);
    return page.evaluate(() => [...document.querySelectorAll("g.animated-stage")].filter(group => getComputedStyle(group).visibility === "visible" && Number(getComputedStyle(group).opacity) > 0).map(group => group.id));
  });
  assert.deepEqual(visible, ["stage-1"], "without animation the file must fall back to its first stage");
});

test("embedded as an image it draws content in normal and reduced motion", { skip }, async () => {
  const { svg } = await animatedSvg();
  const source = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  for (const reducedMotion of ["no-preference", "reduce"]) {
    const inked = await withPage({ reducedMotion }, async page => {
      await page.setContent(`<body style="margin:0"><img id="d" src="${source}"></body>`);
      await page.waitForFunction(() => document.getElementById("d").complete && document.getElementById("d").naturalWidth > 0);
      return page.evaluate(() => {
        const image = document.getElementById("d"), canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data, background = [data[0], data[1], data[2]];
        let different = 0;
        for (let at = 0; at < data.length; at += 4) if (Math.abs(data[at] - background[0]) + Math.abs(data[at + 1] - background[1]) + Math.abs(data[at + 2] - background[2]) > 30) different += 1;
        return different / (canvas.width * canvas.height);
      });
    });
    assert.ok(inked > 0.005, `the image is blank (${(inked * 100).toFixed(2)}% inked) with reducedMotion=${reducedMotion}`);
  }
});
