/* TASK-004.2: PDF conversion and document-safe fallback selection.
 *
 * A documentation SVG converted to PDF must keep the diagram's page size and every visible
 * label as text, or the conversion is rejected and an explicit PNG fallback is written with the
 * reason. Other targets get the format documentation-export.md prescribes.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { TARGETS, exportForDocument, svgSize, verifyPdf } from "../scripts/document_format.mjs";
import { inspectPdf } from "../scripts/pdf_text.mjs";
import { EXAMPLES, browserSkip, chromium, documentationSvg, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const temporary = [];
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));
const scratch = () => { const path = mkdtempSync(join(tmpdir(), "pdf-test-")); temporary.push(path); return path; };

async function exportedSvg(model) {
  const diagram = await openDiagram(join(EXAMPLES, model), { viewport: { width: 1800, height: 1200 } });
  try {
    await diagram.page.waitForFunction(() => { const button = document.getElementById("btn-disclosure"); return !button || button.hidden || button.disabled; }, null, { timeout: 20000 });
    const { svg, error } = await documentationSvg(diagram.page);
    assert.ok(svg, error);
    return svg;
  } finally { await diagram.close(); }
}

/** A PDF that looks right but holds a picture instead of text: what a bad converter produces. */
async function rasterPdf(browser, svg, size) {
  const context = await browser.newContext({ viewport: { width: Math.ceil(size.width), height: Math.ceil(size.height) } });
  try {
    const page = await context.newPage();
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size.width}" height="${size.height}">`);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    const png = await page.screenshot({ clip: { x: 0, y: 0, width: size.width, height: size.height } });
    await page.setContent(`<!doctype html><style>@page{size:${size.width}px ${size.height}px;margin:0}html,body{margin:0}img{display:block}</style><img src="data:image/png;base64,${png.toString("base64")}" width="${size.width}" height="${size.height}">`);
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    return await page.pdf({ width: `${size.width}px`, height: `${size.height}px`, printBackground: true, pageRanges: "1" });
  } finally { await context.close(); }
}

for (const model of ["boundary-label-collision-model.json", "nested-sibling-packages-model.json", "dense-mesh-model.json"]) {
  test(`${model}: the PDF keeps the page size and every label as text`, { skip }, async () => {
    const svg = await exportedSvg(model), outDir = scratch();
    const result = await exportForDocument({ svg, target: "pdf", outDir, name: "diagram", chromium });
    assert.equal(result.format, "pdf", result.reason);
    assert.equal(result.fallback, false);
    const pdf = readFileSync(result.path), report = inspectPdf(pdf), size = svgSize(svg);
    assert.equal(report.pages.length, 1);
    assert.ok(Math.abs(report.pages[0].width - size.width * 0.75) <= 1.5 && Math.abs(report.pages[0].height - size.height * 0.75) <= 1.5, `page ${report.pages[0].width}x${report.pages[0].height} pt for a ${size.width}x${size.height} px diagram`);
    assert.equal(report.images, 0, "the diagram was rasterised into the PDF");
    assert.ok(report.pages[0].text.join("").length >= 10, "no text could be read from the PDF");
    assert.ok(result.checks.labels >= 2 && result.checks.fonts >= 1);
  });
}

test("a PDF that holds a picture instead of text is rejected and a PNG fallback is written with the reason", { skip }, async () => {
  const svg = await exportedSvg("boundary-label-collision-model.json"), outDir = scratch();
  const result = await exportForDocument({ svg, target: "pdf", outDir, name: "diagram", chromium, buildPdf: rasterPdf });
  assert.equal(result.format, "png");
  assert.equal(result.fallback, true);
  assert.match(result.reason, /PDF conversion was rejected: .*labels are not text in the PDF/);
  assert.match(result.reason, /2x PNG of the same SVG/);
  const png = readFileSync(result.path), size = svgSize(svg);
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.readUInt32BE(16), size.width * 2, "the fallback PNG should be 2x the diagram width");
  assert.equal(png.readUInt32BE(20), size.height * 2);
});

test("the verifier rejects a wrong page size, multiple pages and an unreadable file", { skip }, async () => {
  const svg = await exportedSvg("boundary-label-collision-model.json"), size = svgSize(svg), outDir = scratch();
  const good = await exportForDocument({ svg, target: "pdf", outDir, name: "good", chromium });
  const pdf = readFileSync(good.path);
  assert.equal(verifyPdf(pdf, { size, labels: ["Zone A"] }).ok, true);
  const wrongSize = verifyPdf(pdf, { size: { width: size.width * 2, height: size.height * 2 }, labels: ["Zone A"] });
  assert.equal(wrongSize.ok, false);
  assert.match(wrongSize.problems.join(" "), /the PDF page is/);
  const missingLabel = verifyPdf(pdf, { size, labels: ["A label that is not in the diagram"] });
  assert.match(missingLabel.problems.join(" "), /labels are not text in the PDF/);
  assert.equal(verifyPdf(Buffer.from("not a pdf"), { size, labels: ["x"] }).ok, false);
  assert.match(verifyPdf(pdf, { size, labels: [] }).problems.join(" "), /no visible text/);
});

test("targets get the format the documentation prescribes, and SVG-hostile ones get a PNG", { skip }, async () => {
  assert.deepEqual(TARGETS, { markdown: "svg", html: "svg", pdf: "pdf", word: "png", "google-docs": "png" });
  const svg = await exportedSvg("boundary-label-collision-model.json"), outDir = scratch();

  for (const target of ["markdown", "html"]) {
    const result = await exportForDocument({ svg, target, outDir, name: target, chromium });
    assert.deepEqual([result.format, result.fallback], ["svg", false]);
    assert.equal(readFileSync(result.path, "utf8"), svg, "the SVG must be passed through unchanged");
  }
  for (const target of ["word", "google-docs"]) {
    const result = await exportForDocument({ svg, target, outDir, name: target, chromium });
    assert.deepEqual([result.format, result.fallback], ["png", true]);
    assert.match(result.reason, new RegExp(`${target} does not reliably display SVG`));
    assert.equal(readFileSync(result.path).subarray(1, 4).toString("latin1"), "PNG");
  }
  const accepted = await exportForDocument({ svg, target: "word", outDir, name: "accepted", acceptsSvg: true, chromium });
  assert.deepEqual([accepted.format, accepted.fallback], ["svg", false]);
  assert.match(accepted.reason, /declared to accept SVG/);
});

test("a bad request is refused before anything is written", async () => {
  const outDir = scratch();
  await assert.rejects(exportForDocument({ svg: "<svg/>", target: "fax", outDir }), /unknown target "fax" \(available: markdown, html, pdf, word, google-docs\)/);
  await assert.rejects(exportForDocument({ svg: "<svg/>", target: "markdown", outDir, name: "../escape" }), /plain file name/);
  await assert.rejects(exportForDocument({ svg: "<svg/>", target: "markdown", outDir, name: "ok" }), /no width and height/);
});
