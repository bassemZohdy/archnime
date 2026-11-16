/* TASK-004.1: visual gates for the documentation SVG, in light and dark, on dense and nested layouts.
 *
 * No screenshots are committed: pixel output differs between machines and fonts. Instead the
 * exported SVG is rendered twice by the same browser and the two renderings must agree:
 *   - as an <img> (isolated: only what is inside the file, so a missing embedded font falls
 *     back to a default one and unresolved styles vanish), and
 *   - inline in the live page (with the page's fonts and styles).
 * A fallback font, a lost style, a clipped scene or a missing background shows up as a pixel
 * difference. Two structural gates cover what a pixel diff cannot: wire endpoints must still
 * touch their nodes (a shifted arrow layer is not visible to a self-consistency diff), and the
 * app's PNG export must carry the same theme background as the SVG. The gates are proven by
 * mutation below: each known defect is injected into the SVG and must be caught.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { EXAMPLES, browserSkip, documentationSvg, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const VIEWPORT = { width: 2200, height: 1500 };
const LAYOUTS = [
  ["dense mesh", join(EXAMPLES, "dense-mesh-model.json")],
  ["nested sibling packages", join(EXAMPLES, "nested-sibling-packages-model.json")],
  ["trust boundaries", join(EXAMPLES, "boundary-label-collision-model.json")],
];
const SCHEMES = ["light", "dark"];

// Calibrated on the healthy exports (see the diagnostics each test prints). The renderings are
// compared relative to how much of the image is drawing, so a small diagram and a dense one are
// held to the same standard: healthy exports differ in at most 5.5% of their ink, and a missing
// embedded font in about 12%. Wires end on their nodes (gap 0) and shifted ones miss by 20px or more.
export const LIMITS = { diffOfInk: 0.08, arrowGap: 14, edgeInk: 0, themeBackground: 12, minInk: 0.004 };

const disclosureDone = page => page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 20000 });

/** Render the SVG as an <img> and inline in the page; return how far the two renderings differ. */
async function renderBoth(page, svg) {
  const size = await page.evaluate(markup => { const host = document.createElement("div"); host.innerHTML = markup; const root = host.querySelector("svg"); return { width: Number(root.getAttribute("width")), height: Number(root.getAttribute("height")) }; }, svg);
  await page.evaluate(markup => {
    const host = document.createElement("div");
    host.id = "inline-reference";
    host.style.cssText = "position:fixed;left:0;top:0;z-index:2147483647;line-height:0;background:#fff";
    host.innerHTML = markup;
    document.body.append(host);
  }, svg);
  const inline = (await page.screenshot({ clip: { x: 0, y: 0, width: size.width, height: size.height } })).toString("base64");
  await page.evaluate(() => document.getElementById("inline-reference").remove());
  return page.evaluate(async ([markup, inlinePng, width, height]) => {
    const image = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = () => reject(new Error("the SVG did not load as an image")); element.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" })); });
    const draw = source => { const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height; const context = canvas.getContext("2d"); context.drawImage(source, 0, 0, width, height); return context.getImageData(0, 0, width, height).data; };
    const asImage = draw(image);
    const bytes = Uint8Array.from(atob(inlinePng), character => character.charCodeAt(0));
    const asInline = draw(await createImageBitmap(new Blob([bytes], { type: "image/png" })));
    let different = 0, ink = 0, edgeInk = 0;
    const background = [asImage[0], asImage[1], asImage[2]];
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      if (Math.max(Math.abs(asImage[offset] - asInline[offset]), Math.abs(asImage[offset + 1] - asInline[offset + 1]), Math.abs(asImage[offset + 2] - asInline[offset + 2])) > 48) different += 1;
      if (Math.abs(asImage[offset] - background[0]) + Math.abs(asImage[offset + 1] - background[1]) + Math.abs(asImage[offset + 2] - background[2]) > 40) {
        ink += 1;
        if (x === 0 || y === 0 || x === width - 1 || y === height - 1) edgeInk += 1;
      }
    }
    return { width, height, pixelDiffShare: different / (width * height), diffOfInk: ink ? different / ink : 1, inkShare: ink / (width * height), edgeInk, background };
  }, [svg, inline, size.width, size.height]);
}

/** Largest distance, in px, from any wire's two ends to the nearest node or package box. */
function arrowGap(page, svg) {
  return page.evaluate(markup => {
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
    host.innerHTML = markup;
    document.body.append(host);
    try {
      const root = host.querySelector("svg");
      const boxes = [...root.querySelectorAll("g.node, g.package-outline")].map(element => element.getBoundingClientRect()).filter(box => box.width && box.height);
      const distance = (x, y, box) => Math.hypot(Math.max(box.left - x, 0, x - box.right), Math.max(box.top - y, 0, y - box.bottom));
      let worst = 0, wires = 0;
      for (const path of root.querySelectorAll("g.wire path.main")) {
        const length = path.getTotalLength();
        if (!length) continue;
        const matrix = path.getScreenCTM();
        for (const at of [0, length]) {
          const point = path.getPointAtLength(at), screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
          worst = Math.max(worst, Math.min(...boxes.map(box => distance(screen.x, screen.y, box))));
        }
        wires += 1;
      }
      return { worst, wires, boxes: boxes.length };
    } finally { host.remove(); }
  }, svg);
}

const stripFont = svg => svg.replace(/@font-face\s*\{[^}]*\}/g, "");
const shiftArrows = svg => svg.replace(/<g class="wires"/, '<g transform="translate(22 16)" class="wires"');
const cropScene = svg => svg.replace(/viewBox="(-?\d+) (-?\d+) (\d+) (\d+)"/, (_m, x, y, w, h) => `viewBox="${Number(x) + 90} ${Number(y) + 60} ${Number(w) - 180} ${Number(h) - 120}"`);

for (const scheme of SCHEMES) {
  for (const [name, modelPath] of LAYOUTS) {
    test(`${name}, ${scheme}: the SVG renders the same as an image and inline, with arrows on their nodes`, { skip }, async t => {
      const diagram = await openDiagram(modelPath, { viewport: VIEWPORT, colorScheme: scheme });
      try {
        const { page } = diagram;
        await disclosureDone(page);
        const { svg, error } = await documentationSvg(page);
        assert.ok(svg, error);
        const both = await renderBoth(page, svg), arrows = await arrowGap(page, svg);
        t.diagnostic(JSON.stringify({ ...both, background: undefined, arrowGap: arrows }));
        assert.ok(both.inkShare > LIMITS.minInk, `the rendering looks blank (ink ${both.inkShare})`);
        assert.ok(both.diffOfInk <= LIMITS.diffOfInk, `image and inline renderings differ in ${(both.diffOfInk * 100).toFixed(1)}% of the drawn pixels (limit ${LIMITS.diffOfInk * 100}%)`);
        assert.equal(both.edgeInk, LIMITS.edgeInk, "content touches the image edge, so the scene is clipped");
        assert.ok(arrows.wires > 0 && arrows.boxes > 1, "the geometry check found no wires or boxes");
        assert.ok(arrows.worst <= LIMITS.arrowGap, `a wire ends ${arrows.worst.toFixed(1)}px from the nearest node (limit ${LIMITS.arrowGap}px)`);
        const dark = (both.background[0] + both.background[1] + both.background[2]) / 3 < 128;
        assert.equal(dark, scheme === "dark", `the SVG background is ${dark ? "dark" : "light"} under the ${scheme} colour scheme`);
      } finally { await diagram.close(); }
    });
  }
}

for (const scheme of SCHEMES) {
  test(`${scheme}: the PNG export carries the same theme background as the documentation SVG`, { skip }, async t => {
    const diagram = await openDiagram(join(EXAMPLES, "nested-sibling-packages-model.json"), { viewport: VIEWPORT, colorScheme: scheme, acceptDownloads: true });
    try {
      const { page } = diagram;
      await disclosureDone(page);
      const { svg, error } = await documentationSvg(page);
      assert.ok(svg, error);
      const downloaded = page.waitForEvent("download", { timeout: 30000 });
      await page.evaluate(() => document.getElementById("btn-export-png").click());
      const download = await downloaded;
      assert.match(download.suggestedFilename(), /\.png$/);
      const png = readFileSync(await download.path());
      assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a", "not a PNG file");
      const result = await page.evaluate(async ([markup, base64]) => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const sample = source => { const canvas = document.createElement("canvas"); canvas.width = 4; canvas.height = 4; const context = canvas.getContext("2d"); context.drawImage(source, 0, 0, 4, 4); const data = context.getImageData(0, 0, 1, 1).data; return [data[0], data[1], data[2], data[3]]; };
        const image = await new Promise((resolve, reject) => { const element = new Image(); element.onload = () => resolve(element); element.onerror = reject; element.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" })); });
        const big = document.createElement("canvas"); big.width = bitmap.width; big.height = bitmap.height;
        const context = big.getContext("2d"); context.drawImage(bitmap, 0, 0);
        const data = context.getImageData(0, 0, big.width, big.height).data; let ink = 0;
        for (let index = 0; index < data.length; index += 4) if (Math.abs(data[index] - data[0]) + Math.abs(data[index + 1] - data[1]) + Math.abs(data[index + 2] - data[2]) > 40) ink += 1;
        return { width: bitmap.width, height: bitmap.height, png: sample(bitmap), svg: sample(image), inkShare: ink / (data.length / 4) };
      }, [svg, png.toString("base64")]);
      t.diagnostic(JSON.stringify(result));
      assert.ok(result.width > 100 && result.height > 100, "the PNG is implausibly small");
      assert.equal(result.png[3], 255, "the PNG background is transparent");
      assert.ok(result.inkShare > LIMITS.minInk, "the PNG looks blank");
      for (let channel = 0; channel < 3; channel += 1) assert.ok(Math.abs(result.png[channel] - result.svg[channel]) <= LIMITS.themeBackground, `PNG and SVG backgrounds differ in channel ${channel}: ${result.png} vs ${result.svg}`);
    } finally { await diagram.close(); }
  });
}

test("the gates catch a fallback font, shifted arrows and a clipped scene", { skip }, async t => {
  const diagram = await openDiagram(join(EXAMPLES, "nested-sibling-packages-model.json"), { viewport: VIEWPORT });
  try {
    const { page } = diagram;
    await disclosureDone(page);
    const { svg, error } = await documentationSvg(page);
    assert.ok(svg, error);
    const healthy = await renderBoth(page, svg), healthyArrows = await arrowGap(page, svg);
    assert.ok(healthy.diffOfInk <= LIMITS.diffOfInk && healthyArrows.worst <= LIMITS.arrowGap && healthy.edgeInk === 0, "the healthy export must pass first");

    const noFont = stripFont(svg);
    assert.notEqual(noFont, svg, "the mutation did not change the SVG");
    const fallback = await renderBoth(page, noFont);
    t.diagnostic(`fallback font: ${(fallback.diffOfInk * 100).toFixed(1)}% of the ink differs (healthy ${(healthy.diffOfInk * 100).toFixed(1)}%)`);
    assert.ok(fallback.diffOfInk > LIMITS.diffOfInk, "a missing embedded font went unnoticed");

    const shifted = shiftArrows(svg);
    assert.notEqual(shifted, svg, "the mutation did not change the SVG");
    const shiftedArrows = await arrowGap(page, shifted);
    t.diagnostic(`shifted arrows: worst gap ${shiftedArrows.worst.toFixed(1)}px (healthy ${healthyArrows.worst.toFixed(1)}px)`);
    assert.ok(shiftedArrows.worst > LIMITS.arrowGap, "shifted arrows went unnoticed");

    const cropped = cropScene(svg);
    assert.notEqual(cropped, svg, "the mutation did not change the SVG");
    const clipped = await renderBoth(page, cropped);
    t.diagnostic(`clipped scene: ${clipped.edgeInk} edge pixels (healthy ${healthy.edgeInk})`);
    assert.ok(clipped.edgeInk > LIMITS.edgeInk, "a clipped scene went unnoticed");
  } finally { await diagram.close(); }
});
