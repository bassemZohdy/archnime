/* FIX-020: the documentation export of a progressive-disclosure stage is complete and timeless.
 *
 * A stage with progressive disclosure reveals supporting flows layer by layer on a timer. A
 * documentation image must show the whole stage, and must not depend on how long the page has
 * been open, while the presenter itself keeps revealing at its own pace.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { EXAMPLES, browserSkip, documentationSvg, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const MODEL = join(EXAMPLES, "dense-mesh-model.json");
const wireKeys = svg => [...svg.matchAll(/<g\b[^>]*\bclass="wire[^"]*"[^>]*>/g)].map(match => /data-wire-key="([^"]+)"/.exec(match[0])?.[1]).filter(Boolean);
const settled = page => page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 20000 });
const liveWires = page => page.evaluate(() => document.querySelectorAll("#diagram g.wire").length);

test("an export taken mid-reveal already holds every supporting wire", { skip }, async () => {
  const diagram = await openDiagram(MODEL);
  try {
    const { page } = diagram;
    assert.equal(await page.evaluate(() => { const button = document.getElementById("btn-disclosure"); return Boolean(button && !button.hidden && !button.disabled); }), true, "the model should still be revealing layers when the page is ready");
    const wiresWhenReady = await liveWires(page);
    const early = await documentationSvg(page);
    assert.ok(early.svg, early.error);
    await settled(page);
    const complete = await documentationSvg(page);
    assert.deepEqual(wireKeys(early.svg).sort(), wireKeys(complete.svg).sort(), "the early export is missing wires that the finished presenter shows");
    assert.equal(early.svg, complete.svg, "the export depends on when it was taken");
    // The mesh draws 8 wires at first and 16 once every layer is revealed.
    assert.ok(wireKeys(complete.svg).length > wiresWhenReady, `the export (${wireKeys(complete.svg).length} wires) should hold more than the ${wiresWhenReady} the presenter showed when it was ready`);
    assert.ok(wireKeys(complete.svg).length >= 16, `the dense mesh should export all 16 wires (found ${wireKeys(complete.svg).length})`);
  } finally { await diagram.close(); }
});

test("exporting does not change what the presenter shows or how far it has revealed", { skip }, async () => {
  const diagram = await openDiagram(MODEL);
  try {
    const { page } = diagram;
    const before = { wires: await liveWires(page), button: await page.textContent("#btn-disclosure"), status: await page.textContent("#status") };
    const exported = await documentationSvg(page);
    assert.ok(exported.svg, exported.error);
    const after = { wires: await liveWires(page), button: await page.textContent("#btn-disclosure"), status: await page.textContent("#status") };
    assert.deepEqual(after, before, "the export disturbed the presenter's disclosure state");
    assert.ok(before.wires < wireKeys(exported.svg).length, "the presenter should be showing fewer wires than the complete export at this point");
    await settled(page);
    assert.equal(await liveWires(page) >= before.wires, true, "the presenter must go on revealing after an export");
  } finally { await diagram.close(); }
});

test("a model without progressive disclosure is exported unchanged", { skip }, async () => {
  const diagram = await openDiagram(join(EXAMPLES, "portable-transition-model.json"));
  try {
    const first = await documentationSvg(diagram.page);
    await diagram.page.waitForTimeout(1200);
    const second = await documentationSvg(diagram.page);
    assert.ok(first.svg && second.svg);
    assert.equal(first.svg, second.svg);
  } finally { await diagram.close(); }
});
