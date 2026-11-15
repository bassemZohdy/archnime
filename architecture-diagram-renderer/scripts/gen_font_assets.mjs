#!/usr/bin/env node
/*
 * Regenerate the pinned diagram font assets.
 *
 *   node architecture-diagram-renderer/scripts/gen_font_assets.mjs          # write
 *   node architecture-diagram-renderer/scripts/gen_font_assets.mjs --check  # verify, no writes
 *
 * Layout must not depend on the host's fonts, hinting, or font-load timing, so
 * the engine measures text from a table of per-character advances (em units)
 * for Inter Variable instead of asking the host canvas, and template.html
 * embeds the same font so painted text matches what was measured.
 *
 *   assets/fonts/inter-latin-wght-normal.woff2   Inter Variable 5.3.0 (OFL-1.1, see LICENSE-Inter-OFL.txt)
 *   assets/template.html   <!-- FONT-FACE:BEGIN/END -->  embedded @font-face
 *   assets/diagram-engine.js  FONT-METRICS:BEGIN/END     advance table
 *
 * Advances are measured once in headless Chromium at font-size = unitsPerEm
 * (2048) so canvas rounding is below 0.05%. `--check` verifies the embedded
 * font bytes exactly and the table against a fresh measurement within a small
 * tolerance (hosts may differ in the last unit; layout never reads the host).
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const FONT = join(ROOT, "assets", "fonts", "inter-latin-wght-normal.woff2");
const TEMPLATE = join(ROOT, "assets", "template.html");
const ENGINE = join(ROOT, "assets", "diagram-engine.js");
const UPM = 2048, WEIGHTS = [400, 500, 600, 650, 700], FAMILY = "Inter Variable";
const check = process.argv.includes("--check");

// Printable ASCII, Latin-1 (minus controls), and the general punctuation the
// latin subset carries. Anything else is measured as one em by the engine.
const codepoints = [];
for (let c = 32; c <= 126; c += 1) codepoints.push(c);
for (let c = 160; c <= 255; c += 1) codepoints.push(c);
[0x131, 0x152, 0x153, 0x2bb, 0x2bc, 0x2c6, 0x2da, 0x2dc, 0x2013, 0x2014, 0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2020, 0x2021, 0x2022, 0x2026, 0x2030, 0x2039, 0x203a, 0x20ac, 0x2122, 0x2191, 0x2193, 0x2212, 0x2215].forEach(c => codepoints.push(c));
const chars = String.fromCodePoint(...codepoints);

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root", { cwd: ROOT }).toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  throw new Error("Playwright/Chromium is required to measure the font");
}

const fontBytes = readFileSync(FONT);
const fontBase64 = fontBytes.toString("base64");

async function measure() {
  const chromium = await loadChromium();
  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  try {
    const page = await browser.newPage();
    await page.setContent("<!doctype html><meta charset=utf-8><body></body>");
    return await page.evaluate(async ({ base64, family, weights, text, upm }) => {
      const face = new FontFace(family, `url(data:font/woff2;base64,${base64}) format("woff2")`, { weight: "100 900" });
      document.fonts.add(await face.load());
      const context = document.createElement("canvas").getContext("2d");
      const rows = [];
      for (const weight of weights) {
        await document.fonts.load(`${weight} ${upm}px "${family}"`);
        context.font = `${weight} ${upm}px "${family}"`;
        rows.push([...text].map(char => Math.round(context.measureText(char).width)));
      }
      return rows;
    }, { base64: fontBase64, family: FAMILY, weights: WEIGHTS, text: chars, upm: UPM });
  } finally { await browser.close(); }
}

const region = (source, begin, end) => {
  const start = source.indexOf(begin), stop = source.indexOf(end);
  if (start < 0 || stop < start) throw new Error(`missing ${begin} / ${end} markers`);
  return { head: source.slice(0, start + begin.length), tail: source.slice(stop) };
};

const advances = await measure();
const metrics = `{ upm: ${UPM}, family: ${JSON.stringify(FAMILY)}, weights: ${JSON.stringify(WEIGHTS)}, chars: ${JSON.stringify(chars)}, advances: ${JSON.stringify(advances)} }`;
const engineText = readFileSync(ENGINE, "utf8"), templateText = readFileSync(TEMPLATE, "utf8");
const engineParts = region(engineText, "/* FONT-METRICS:BEGIN", "/* FONT-METRICS:END */");
const templateParts = region(templateText, "<!-- FONT-FACE:BEGIN -->", "<!-- FONT-FACE:END -->");
const engineBeginLine = engineText.slice(engineText.indexOf("/* FONT-METRICS:BEGIN"), engineText.indexOf("*/", engineText.indexOf("/* FONT-METRICS:BEGIN")) + 2);
const faceCss = `<style id="diagram-fonts">\n  /* ${FAMILY} 5.3.0 latin subset, SIL OFL 1.1 (assets/fonts/LICENSE-Inter-OFL.txt). Embedded so painted text matches the measured advances on every host. */\n  @font-face { font-family: "${FAMILY}"; font-style: normal; font-weight: 100 900; font-display: block; src: url(data:font/woff2;base64,${fontBase64}) format("woff2"); }\n</style>`;
const nextEngine = `${engineParts.head.slice(0, engineParts.head.indexOf("/* FONT-METRICS:BEGIN"))}${engineBeginLine}\n  const INTER_METRICS = ${metrics};\n  ${engineParts.tail}`;
const nextTemplate = `${templateParts.head}\n${faceCss}\n${templateParts.tail}`;

if (check) {
  const embedded = templateText.match(/url\(data:font\/woff2;base64,([A-Za-z0-9+/=]+)\)/)?.[1];
  const problems = [];
  if (embedded !== fontBase64) problems.push("template.html does not embed assets/fonts/inter-latin-wght-normal.woff2");
  const stored = engineText.match(/const INTER_METRICS = (\{.*\});/)?.[1];
  if (!stored) problems.push("diagram-engine.js has no INTER_METRICS table");
  else {
    const table = Function(`"use strict"; return (${stored});`)();
    if (table.chars !== chars) problems.push("INTER_METRICS covers a different character set");
    else table.advances.forEach((row, weightIndex) => row.forEach((value, index) => {
      if (Math.abs(value - advances[weightIndex][index]) > Math.max(2, advances[weightIndex][index] * 0.005)) problems.push(`advance of U+${chars.codePointAt(index).toString(16)} at ${WEIGHTS[weightIndex]} is ${value}, measured ${advances[weightIndex][index]}`);
    }));
  }
  if (problems.length) { console.error(problems.slice(0, 12).join("\n")); process.exit(1); }
  console.log(`font assets verified: ${chars.length} characters x ${WEIGHTS.length} weights`);
} else {
  writeFileSync(ENGINE, nextEngine, "utf8");
  writeFileSync(TEMPLATE, nextTemplate, "utf8");
  console.log(`wrote font metrics (${chars.length} characters x ${WEIGHTS.length} weights) and embedded ${fontBytes.length} bytes of Inter`);
}
