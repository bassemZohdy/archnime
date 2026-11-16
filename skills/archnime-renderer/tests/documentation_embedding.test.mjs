/* TASK-001.2: the documentation SVG stays readable when it is embedded.
 *
 * A README or docs page shows the SVG inside an <img> at the page's width (GitHub's
 * README column is about 880 CSS px), so a wide diagram is scaled down. The exported
 * file must keep its labels, arrows, node identity and trust boundaries intact at every
 * supported width, and its text must stay above a legibility floor where it is meant to
 * be read. The text floors are the product's stated documentation widths, not tuned to
 * pass: see documentation-export.md.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { EXAMPLES, FIXTURES, browserSkip, documentationSvg, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();

// Embedding widths and the smallest effective text size (CSS px after scaling) allowed at each.
// README: GitHub's content column. Narrow: a phone or a docs sidebar, where only structure is held.
const WIDTHS = [
  { name: "README column", width: 880, minTextPx: 6 },
  { name: "narrow docs column", width: 640, minTextPx: 4.5 },
  { name: "phone", width: 360, minTextPx: 0 },
];

// minBoundaries guards against a vacuous pass: the boundary model must really draw boundaries.
const MODELS = [
  ["checkout flow", join(FIXTURES, "checkout-flow.json"), 0],
  ["trust boundaries with colliding labels", join(EXAMPLES, "boundary-label-collision-model.json"), 2],
  ["nested sibling packages", join(EXAMPLES, "nested-sibling-packages-model.json"), 0],
];

/** What the live presenter shows, and what the exported SVG contains, compared structurally. */
async function inspect(page, svg) {
  return page.evaluate(markup => {
    const text = element => (element?.textContent || "").replace(/\s+/g, " ").trim();
    const live = {
      nodes: Object.fromEntries([...document.querySelectorAll("#diagram g.node")].map(node => [node.getAttribute("data-id"), text(node)])),
      boundaries: Object.fromEntries([...document.querySelectorAll("#diagram g.boundary")].map(node => [node.getAttribute("data-id"), text(node.querySelector("text"))])),
      wires: [...document.querySelectorAll("#diagram g.wire")].filter(wire => wire.style.display !== "none").map(wire => wire.getAttribute("data-wire-key")),
    };
    const host = document.createElement("div");
    host.style.cssText = "position:absolute;left:0;top:0;visibility:hidden";
    host.innerHTML = markup;
    document.body.append(host);
    try {
      const root = host.querySelector("svg");
      const exported = {
        nodes: Object.fromEntries([...root.querySelectorAll("g.node")].map(node => [node.getAttribute("data-id"), text(node)])),
        boundaries: Object.fromEntries([...root.querySelectorAll("g.boundary")].map(node => [node.getAttribute("data-id"), { title: text(node.querySelector("text")), width: node.querySelector("rect")?.getBBox().width || 0, height: node.querySelector("rect")?.getBBox().height || 0 }])),
        wires: [...root.querySelectorAll("g.wire")].map(wire => wire.getAttribute("data-wire-key")),
        markersUsed: [...new Set([...root.querySelectorAll("[marker-end]")].map(element => /url\(#([^)]+)\)/.exec(element.getAttribute("marker-end"))?.[1]).filter(Boolean))],
        markersDefined: [...root.querySelectorAll("marker")].map(marker => marker.id),
        fontSizes: [...root.querySelectorAll("text")].filter(label => text(label)).map(label => parseFloat(getComputedStyle(label).fontSize)),
        width: Number(root.getAttribute("width")),
        height: Number(root.getAttribute("height")),
      };
      return { live, exported };
    } finally { host.remove(); }
  }, svg);
}

for (const [name, modelPath, minBoundaries] of MODELS) {
  test(`${name}: node identity, labels, arrows and boundaries survive export`, { skip }, async () => {
    const diagram = await openDiagram(modelPath);
    try {
      const { page } = diagram;
      await page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 15000 });
      const { svg, error } = await documentationSvg(page);
      assert.ok(svg, error);
      const { live, exported } = await inspect(page, svg);

      assert.ok(Object.keys(live.nodes).length >= 2, "the model should show at least two nodes");
      assert.ok(Object.keys(live.boundaries).length >= minBoundaries, `the model should show at least ${minBoundaries} trust boundaries`);
      assert.deepEqual(Object.keys(exported.nodes).sort(), Object.keys(live.nodes).sort(), "the exported node ids differ from the presenter's");
      for (const [id, label] of Object.entries(live.nodes)) {
        assert.ok(exported.nodes[id], `node ${id} lost its label in the export`);
        assert.equal(exported.nodes[id], label, `node ${id} label changed in the export`);
      }

      assert.deepEqual(Object.keys(exported.boundaries).sort(), Object.keys(live.boundaries).sort(), "the exported trust boundaries differ from the presenter's");
      for (const [id, title] of Object.entries(live.boundaries)) {
        assert.equal(exported.boundaries[id].title, title, `boundary ${id} title changed in the export`);
        assert.ok(exported.boundaries[id].width > 0 && exported.boundaries[id].height > 0, `boundary ${id} has no area in the export`);
      }

      assert.ok(exported.wires.length >= live.wires.length, `the export lost wires (${exported.wires.length} < ${live.wires.length})`);
      const undefinedMarkers = exported.markersUsed.filter(marker => !exported.markersDefined.includes(marker));
      assert.deepEqual(undefinedMarkers, [], "arrowheads reference markers the exported SVG does not define");
      if (live.wires.length) assert.ok(exported.markersUsed.length > 0, "wires are exported without any arrowhead");
    } finally { await diagram.close(); }
  });
}

for (const [name, modelPath] of MODELS) {
  test(`${name}: legible and intact when embedded as an image at README, narrow and phone widths`, { skip }, async () => {
    const diagram = await openDiagram(modelPath);
    try {
      const { page } = diagram;
      await page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 15000 });
      const { svg, error } = await documentationSvg(page);
      assert.ok(svg, error);
      const { exported } = await inspect(page, svg);
      const smallest = Math.min(...exported.fontSizes);
      assert.ok(Number.isFinite(smallest) && smallest > 0, "the exported SVG has no readable text");

      for (const { name: widthName, width, minTextPx } of WIDTHS) {
        // Embedded like <img width=...>: the image is scaled to the column, never enlarged past its own size.
        const shownWidth = Math.min(width, exported.width), scale = shownWidth / exported.width;
        assert.ok(smallest * scale >= minTextPx, `${widthName} (${width}px): smallest text is ${(smallest * scale).toFixed(2)}px, below the ${minTextPx}px floor (svg ${exported.width}px wide, ${smallest}px type)`);

        const raster = await page.evaluate(([markup, targetWidth]) => new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const ratio = image.naturalHeight / image.naturalWidth, canvasWidth = Math.round(targetWidth), canvasHeight = Math.max(1, Math.round(targetWidth * ratio));
            const canvas = document.createElement("canvas");
            canvas.width = canvasWidth; canvas.height = canvasHeight;
            const context = canvas.getContext("2d");
            context.drawImage(image, 0, 0, canvasWidth, canvasHeight);
            const data = context.getImageData(0, 0, canvasWidth, canvasHeight).data, corner = [data[0], data[1], data[2]];
            let ink = 0, edgeInk = 0;
            for (let y = 0; y < canvasHeight; y += 1) for (let x = 0; x < canvasWidth; x += 1) {
              const offset = (y * canvasWidth + x) * 4;
              if (Math.abs(data[offset] - corner[0]) + Math.abs(data[offset + 1] - corner[1]) + Math.abs(data[offset + 2] - corner[2]) > 40) {
                ink += 1;
                if (x === 0 || y === 0 || x === canvasWidth - 1 || y === canvasHeight - 1) edgeInk += 1;
              }
            }
            resolve({ canvasWidth, canvasHeight, inkShare: ink / (canvasWidth * canvasHeight), edgeInk });
          };
          image.onerror = () => reject(new Error("the SVG did not load as an image"));
          image.src = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
        }), [svg, shownWidth]);
        assert.ok(raster.inkShare > 0.005, `${widthName}: the embedded image looks blank (ink ${raster.inkShare})`);
        assert.equal(raster.edgeInk, 0, `${widthName}: content touches the image edge, so something is cropped`);
      }
    } finally { await diagram.close(); }
  });
}
