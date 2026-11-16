/* FIX-005.1: a documentation SVG never silently changes the script of a label.
 *
 * The pinned Inter subset paints Latin text. A label in another script (Arabic, Hebrew, Han,
 * Cyrillic ...) would be drawn with whatever fallback font each viewer happens to have, in a
 * different shape and width from what the layout measured, with nothing to say so. The export
 * must refuse such a diagram with a message naming the script and characters, while text the
 * font does cover (accents, typographic punctuation, euro) is never refused by mistake.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportSnapshots } from "../scripts/export_snapshots.mjs";
import { browserSkip, chromium, documentationSvg, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const temporary = [];
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));

/** A small model whose labels, a wire label and a boundary title are the given strings. */
function modelWith({ node = "Orders", other = "Billing", wire = "calls", boundary = "Zone" }) {
  const directory = mkdtempSync(join(tmpdir(), "multilingual-"));
  temporary.push(directory);
  const model = {
    meta: { title: "Labels", layout: "dagre", direction: "LR" },
    canvas: { w: 1200, h: 600, minWidth: 600 },
    catalog: { a: { label: node, type: "service", shape: "service", kind: "existing" }, b: { label: other, type: "service", shape: "service", kind: "existing" } },
    packages: {},
    stages: [{ id: "only", title: "Only", nodes: ["a", "b"], wires: [{ from: "a", to: "b", type: "data", label: wire, flow: false }], boundaries: [{ id: "zone", label: boundary, contains: ["a", "b"] }] }],
  };
  const path = join(directory, "model.json");
  writeFileSync(path, JSON.stringify(model));
  return path;
}

async function exportOf(labels) {
  const diagram = await openDiagram(modelWith(labels));
  try {
    const result = await documentationSvg(diagram.page);
    const nodesDrawn = await diagram.page.evaluate(() => document.querySelectorAll("#diagram g.node").length);
    return { ...result, nodesDrawn, pageErrors: diagram.pageErrors };
  } finally { await diagram.close(); }
}

test("text the pinned font covers is exported, including accents, typographic punctuation and the euro", { skip }, async () => {
  const { svg, error } = await exportOf({ node: "Café Münster ñ ß", other: "“Billing” – 5 € … ™ •", wire: "résumé — ok", boundary: "Zone ↑ A" });
  assert.ok(svg, error);
});

test("an Arabic label is refused, naming the script and the characters", { skip }, async () => {
  const { error, nodesDrawn, pageErrors } = await exportOf({ node: "خدمة الطلبات" });
  assert.match(error ?? "", /Documentation SVG export refused/);
  assert.match(error, /Arabic/);
  assert.match(error, /خ/);
  assert.match(error, /U\+062E/);
  assert.match(error, /fallback|different font/i, "the message should say why the export is unsafe");
  assert.equal(nodesDrawn, 2, "the presenter itself must still draw the diagram");
  assert.deepEqual(pageErrors, []);
});

test("a bidirectional label (Latin with Arabic) is refused for its Arabic part only", { skip }, async () => {
  const { error } = await exportOf({ node: "Orders خدمة 2" });
  assert.match(error ?? "", /Arabic/);
  assert.doesNotMatch(error, /Latin: /, "the Latin words are covered and must not be listed as missing");
  assert.doesNotMatch(error, /Orders/, "covered words must not be reported");
});

test("other scripts and emoji are refused too, each by name", { skip }, async () => {
  const cases = [["Hebrew", "שירות"], ["Han", "订单服务"], ["Cyrillic", "Заказы"], ["Devanagari", "सेवा"], ["Greek", "Υπηρεσία"], ["Hangul", "주문"], ["Emoji", "Orders 🚀"]];
  for (const [script, label] of cases) {
    const { error } = await exportOf({ node: label });
    assert.match(error ?? "", new RegExp(`Documentation SVG export refused.*${script}`), `${script} label was not refused (got ${JSON.stringify(error)})`);
  }
});

test("a Latin letter the subset lacks is a missing glyph, not a silent substitution", { skip }, async () => {
  const { error } = await exportOf({ node: "Łódź orders" });
  assert.match(error ?? "", /Documentation SVG export refused/);
  assert.match(error, /Latin: Ł/);
  assert.match(error, /U\+0141/);
});

test("wire labels and boundary titles are checked too, not only node labels", { skip }, async () => {
  assert.match((await exportOf({ wire: "يتصل" })).error ?? "", /Arabic/);
  assert.match((await exportOf({ boundary: "区域" })).error ?? "", /Han/);
});

test("the toolbar button shows the refusal and downloads nothing", { skip }, async () => {
  const diagram = await openDiagram(modelWith({ node: "خدمة" }));
  try {
    const { page } = diagram;
    let downloads = 0;
    page.on("download", () => { downloads += 1; });
    await page.evaluate(() => document.getElementById("btn-export-documentation-svg").click());
    await page.waitForTimeout(700);
    assert.equal(downloads, 0);
    assert.match(await page.textContent("#status"), /^Documentation SVG export failed: Documentation SVG export refused.*Arabic/);
  } finally { await diagram.close(); }
});

test("the batch exporter reports the refusal and writes nothing", { skip }, async () => {
  const outDir = mkdtempSync(join(tmpdir(), "multilingual-out-"));
  temporary.push(outDir);
  await assert.rejects(exportSnapshots({ modelPath: modelWith({ node: "خدمة" }), outDir, chromium }), /state 1 \(only\): Documentation SVG export refused.*Arabic/);
});
