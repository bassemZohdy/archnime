/* FIX-005.2: the fonts the documentation export relies on are real, licensed and complete.
 *
 * The export refuses every character outside the supported scripts (multilingual_font.test.mjs). That
 * refusal is only honest if the supported set is true: every character the engine measures must exist in
 * the embedded font (checked against the font's own cmap, since a canvas silently measures a missing
 * character with another font), the font and its licence must be the pinned ones, and what the engine
 * measures must be what an offline viewer paints.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";
import { fontCharacters, missingFromFont } from "../scripts/font_cmap.mjs";
import { browserSkip, chromium, documentationSvg, openDiagram } from "./doc_export_harness.mjs";

const RENDERER = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENGINE_SOURCE = readFileSync(join(RENDERER, "assets", "diagram-engine.js"), "utf8");
const sandbox = {};
sandbox.globalThis = sandbox;
vm.runInNewContext(ENGINE_SOURCE, sandbox);
const engine = sandbox.DiagramEngine;
const metrics = Function(`"use strict"; return (${ENGINE_SOURCE.match(/const INTER_METRICS = (\{.*\});/)[1]});`)();
const skip = browserSkip();
const temporary = [];
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));

test("the registry names every supported script with a pinned, licensed font file", () => {
  const scripts = engine.fontScripts();
  assert.deepEqual(JSON.parse(JSON.stringify(scripts.map(entry => entry.script))), ["Latin"], "only Latin is supported; a script is added here together with its font");
  for (const entry of scripts) {
    const bytes = readFileSync(join(RENDERER, "assets", entry.file));
    assert.equal(createHash("sha256").update(bytes).digest("hex"), entry.sha256, `${entry.file} is not the pinned font`);
    assert.match(readFileSync(join(RENDERER, "assets", entry.licenseFile), "utf8"), /SIL OPEN FONT LICENSE/, `${entry.licenseFile} is not the licence text`);
    assert.equal(entry.license, "OFL-1.1");
  }
});

test("every character the advance table lists is in the embedded font, not only in the table", () => {
  const font = readFileSync(join(RENDERER, "assets", engine.fontScripts()[0].file));
  assert.equal(missingFromFont(font, metrics.chars), "", "the table lists characters the font cannot paint, so a canvas measured them with a fallback font");
  assert.ok(fontCharacters(font).size > 200, "the cmap reader found a plausible number of glyphs");
});

test("mutation proof: the cmap check fails for a character the font lacks", () => {
  const font = readFileSync(join(RENDERER, "assets", engine.fontScripts()[0].file));
  assert.equal(missingFromFont(font, `${metrics.chars}Ж`), "Ж", "a Cyrillic letter appended to the table must be caught");
  assert.equal(missingFromFont(font, "†‡‰∕"), "†‡‰∕", "characters that were once listed without being in the font");
});

test("characters the font lacks are refused, invisible ones are not", () => {
  for (const char of ["†", "‡", "‰", "∕", "Ж", "خ"]) assert.equal(engine.fontCoverage(char).supported, false, `${char} must be refused`);
  assert.equal(engine.fontCoverage("a­b​c").supported, true, "soft hyphen and zero-width characters carry no glyph");
  assert.equal(engine.fontCoverage("Café “x” – 5 €").supported, true);
});

test("gen_font_assets.mjs --check agrees with the font, the licence and the registry", { skip }, () => {
  const output = execFileSync(process.execPath, [join(RENDERER, "scripts", "gen_font_assets.mjs"), "--check"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.match(output, /font assets verified/);
});

test("offline, the exported SVG paints with the measured widths (and a wrong font would be caught)", { skip }, async () => {
  const directory = mkdtempSync(join(tmpdir(), "font-portability-"));
  temporary.push(directory);
  const model = {
    meta: { title: "Fonts", layout: "dagre", direction: "LR" },
    canvas: { w: 1200, h: 600, minWidth: 600 },
    catalog: { a: { label: "Café Münster ñ ß", type: "service", shape: "service", kind: "existing" }, b: { label: "“Billing” – 5 € …", type: "service", shape: "service", kind: "existing" } },
    packages: {},
    stages: [{ id: "only", title: "Only", nodes: ["a", "b"], wires: [{ from: "a", to: "b", type: "data", label: "résumé — ok", flow: false }], boundaries: [{ id: "zone", label: "Zone ↑ Östlich", contains: ["a", "b"] }] }],
  };
  const modelPath = join(directory, "model.json");
  writeFileSync(modelPath, JSON.stringify(model));
  const diagram = await openDiagram(modelPath);
  let svg;
  try {
    ({ svg } = await documentationSvg(diagram.page));
    assert.ok(svg);
  } finally { await diagram.close(); }
  const svgPath = join(directory, "diagram.svg");
  writeFileSync(svgPath, svg);

  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  let painted, wrong;
  const requests = [];
  try {
    const page = await browser.newPage();
    await page.route("**/*", route => { const url = route.request().url(); if (url.startsWith("file:") || url.startsWith("data:")) return route.continue(); requests.push(url); return route.abort(); });
    const widthsOf = async override => {
      await page.goto(pathToFileURL(svgPath).href);
      await page.evaluate(() => document.fonts.ready);
      return page.evaluate(font => [...document.querySelectorAll("text")].map(label => {
        if (font) label.style.fontFamily = font;
        const style = getComputedStyle(label);
        return { text: label.textContent, size: parseFloat(style.fontSize), weight: Number(style.fontWeight) || 400, spacing: parseFloat(style.letterSpacing) || 0, width: label.getComputedTextLength() };
      }).filter(item => item.text.trim().length > 2 && item.size > 0), override);
    };
    painted = await widthsOf(null);
    wrong = await widthsOf("'Courier New', monospace");
  } finally { await browser.close(); }
  assert.deepEqual(requests, [], "the export must not need the network");

  const again = await openDiagram(modelPath);
  let expected;
  try {
    // The boundary styles add letter-spacing on top of the font's advances; the layout allows for it in its padding.
    expected = await again.page.evaluate(items => items.map(item => window.__diagramEngineForTest().textWidth(item.text, item.size, item.weight) + item.spacing * [...item.text].length), painted);
  } finally { await again.close(); }
  const labels = painted.map(item => item.text);
  for (const text of ["Café Münster", "Billing", "Östlich"]) assert.ok(labels.some(label => label.includes(text)), `"${text}" is missing from the export (found ${labels.join(" | ")})`);
  painted.forEach((item, index) => assert.ok(Math.abs(item.width - expected[index]) / expected[index] < 0.03, `"${item.text}" paints ${item.width.toFixed(1)}px wide, the layout measured ${expected[index].toFixed(1)}px`));
  // Negative control: with another font the same comparison must fail, or it proves nothing.
  assert.ok(wrong.some((item, index) => Math.abs(item.width - expected[index]) / expected[index] > 0.03), "a different font must be detectable");
});
