/* TASK-001.1: the documentation SVG is an independent artifact.
 *
 * Presenter pan/zoom must not crop or move it, it must hold every node and boundary,
 * rasterise opaque with its own font, and a missing font or an empty scene must make
 * the export fail visibly instead of producing a file that looks right only here.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { EXAMPLES, FIXTURES, browserSkip, documentationSvg, openDiagram } from "./doc_export_harness.mjs";
import { join } from "node:path";

const skip = browserSkip();
// Click inside the page, like the rest of the renderer tests: Playwright's "stable element"
// wait never settles on this toolbar, while the in-page click runs the real handler.
const exportButton = page => page.evaluate(() => document.getElementById("btn-export-documentation-svg").click());
const MODELS = [
  ["checkout flow", join(FIXTURES, "checkout-flow.json")],
  ["dense mesh", join(EXAMPLES, "dense-mesh-model.json")],
  ["nested sibling packages", join(EXAMPLES, "nested-sibling-packages-model.json")],
];

/** Elements of the exported SVG (parsed into the live page) that fall outside its viewBox. */
function outsideViewBox(page, svg) {
  return page.evaluate(markup => {
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
    host.innerHTML = markup;
    document.body.append(host);
    try {
      const root = host.querySelector("svg"), box = root.getBoundingClientRect(), tolerance = 0.75;
      const outside = [];
      const measured = root.querySelectorAll("g.node, g.boundary, g.package, g.wire");
      measured.forEach(element => {
        const rect = element.getBoundingClientRect();
        if (!rect.width && !rect.height) return;
        if (rect.left < box.left - tolerance || rect.top < box.top - tolerance || rect.right > box.right + tolerance || rect.bottom > box.bottom + tolerance) {
          outside.push(element.getAttribute("data-id") || element.getAttribute("data-wire-key") || element.getAttribute("class"));
        }
      });
      return { outside, measured: measured.length, nodes: root.querySelectorAll("g.node").length, viewBox: root.getAttribute("viewBox") };
    } finally { host.remove(); }
  }, svg);
}

for (const [name, modelPath] of MODELS) {
  test(`${name}: real pan and zoom cannot crop or move the exported SVG`, { skip }, async () => {
    const diagram = await openDiagram(modelPath);
    try {
      const { page } = diagram;
      // Progressive disclosure reveals supporting flows on a timer; let it finish so the
      // only thing that changes between the two exports is the presenter's zoom and pan.
      await page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 15000 });
      const before = await documentationSvg(page);
      assert.ok(before.svg, before.error);
      const box = await page.locator("#diagram").boundingBox();
      // Zoom and pan from an empty corner: a click on a node would select it, which is a
      // different presenter state from the viewport transform this test is about.
      const corner = { x: box.x + 6, y: box.y + 6 };
      await page.mouse.move(corner.x, corner.y);
      await page.mouse.wheel(0, -1500);       // zoom in as a user would
      await page.waitForTimeout(250);
      await page.mouse.down();
      await page.mouse.move(corner.x + 60, corner.y + 40, { steps: 6 });
      await page.mouse.up();                  // and pan away
      await page.waitForTimeout(250);
      const transform = await page.evaluate(() => document.querySelector("g.viewport").getAttribute("transform"));
      assert.ok(transform && /scale\(/.test(transform), `the interaction should have zoomed the presenter (transform: ${transform})`);
      const after = await documentationSvg(page);
      if (after.svg !== before.svg) {
        let index = 0;
        while (index < before.svg.length && before.svg[index] === after.svg[index]) index += 1;
        assert.fail(`the exported SVG changed after the presenter was zoomed and panned, first at ${index}: ${JSON.stringify(before.svg.slice(Math.max(0, index - 80), index + 120))} vs ${JSON.stringify(after.svg.slice(Math.max(0, index - 80), index + 120))}`);
      }
      const fit = await outsideViewBox(page, after.svg);
      assert.deepEqual(fit.outside, [], `elements outside the exported viewBox ${fit.viewBox}`);
      assert.ok(fit.nodes > 0 && fit.measured >= fit.nodes, "the exported SVG should contain the diagram's nodes");
      assert.deepEqual(diagram.pageErrors, []);
    } finally { await diagram.close(); }
  });
}

test("the exported SVG loads as an image, is opaque, embeds its font and has no external references", { skip }, async () => {
  const diagram = await openDiagram(join(FIXTURES, "checkout-flow.json"));
  try {
    const { svg, error } = await documentationSvg(diagram.page);
    assert.ok(svg, error);
    assert.match(svg, /@font-face/);
    assert.match(svg, /data:font\/woff2;base64,/);
    assert.doesNotMatch(svg, /(?:href|src)=["']https?:/i, "an external href would break the SVG offline");
    assert.doesNotMatch(svg, /url\(\s*["']?https?:/i, "an external url() would break the SVG offline");
    const raster = await diagram.page.evaluate(markup => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
        const context = canvas.getContext("2d");
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
        const corner = [data[0], data[1], data[2], data[3]];
        let different = 0, transparent = 0;
        for (let index = 0; index < data.length; index += 4) {
          if (data[index + 3] < 255) transparent += 1;
          if (Math.abs(data[index] - corner[0]) + Math.abs(data[index + 1] - corner[1]) + Math.abs(data[index + 2] - corner[2]) > 40) different += 1;
        }
        resolve({ width: canvas.width, height: canvas.height, cornerAlpha: corner[3], transparent, inkShare: different / (data.length / 4) });
      };
      image.onerror = () => reject(new Error("the exported SVG did not load as an image"));
      image.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
    }), svg);
    assert.equal(raster.cornerAlpha, 255, "the SVG background must be opaque once rasterised");
    assert.equal(raster.transparent, 0, "no pixel of the rasterised SVG should be transparent");
    assert.ok(raster.inkShare > 0.01, `the rasterised SVG looks blank (ink share ${raster.inkShare})`);
  } finally { await diagram.close(); }
});

test("a missing pinned font makes the export fail explicitly and no file is downloaded", { skip }, async () => {
  const diagram = await openDiagram(join(FIXTURES, "checkout-flow.json"));
  try {
    const { page } = diagram;
    let downloads = 0;
    page.on("download", () => { downloads += 1; });

    // Control: the healthy export does download, so the counter below means something.
    const healthy = page.waitForEvent("download", { timeout: 15000 });
    await exportButton(page);
    await healthy;
    assert.equal(downloads, 1);

    await page.evaluate(() => { for (const id of ["diagram-fonts", "architecture-diagram-fonts"]) document.getElementById(id)?.remove(); });
    const failure = await documentationSvg(page);
    assert.match(failure.error ?? "", /pinned diagram font is missing/);

    await exportButton(page);
    await page.waitForTimeout(600);
    assert.equal(downloads, 1, "a download happened although the font was missing");
    assert.match(await page.textContent("#status"), /^Documentation SVG export failed: .*font/);
    assert.equal(await page.isDisabled("#btn-export-documentation-svg"), false, "the export button must be usable again after a failure");
  } finally { await diagram.close(); }
});

test("an empty scene is rejected instead of exported as a blank SVG", { skip }, async () => {
  const diagram = await openDiagram(join(FIXTURES, "checkout-flow.json"));
  try {
    const { page } = diagram;
    let downloads = 0;
    page.on("download", () => { downloads += 1; });
    await page.evaluate(() => document.querySelector("g.viewport").replaceChildren());
    const failure = await documentationSvg(page);
    assert.match(failure.error ?? "", /Cannot determine the complete visible diagram bounds/);
    await exportButton(page);
    await page.waitForTimeout(600);
    assert.equal(downloads, 0);
    assert.match(await page.textContent("#status"), /^Documentation SVG export failed: /);
  } finally { await diagram.close(); }
});
