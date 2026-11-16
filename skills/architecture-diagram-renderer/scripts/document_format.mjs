#!/usr/bin/env node
/* Choose a document-safe format for a documentation SVG, and say why.
 *
 *   node document_format.mjs --svg diagram.svg --target pdf --out dir [--name diagram] [--accepts-svg]
 *
 * documentation-export.md says: SVG where the destination takes it, a PDF where one is wanted,
 * and an explicit PNG made from the same SVG where it does not. This does that and proves it:
 *
 *   markdown, html     -> the SVG itself
 *   pdf                -> a one-page vector PDF, kept only if it passes verification:
 *                         the page is the diagram's size and every visible label is still text;
 *                         otherwise a 2x PNG is written instead and the reason is reported
 *   word, google-docs  -> a 2x PNG (these sanitise or reject SVG), or the SVG with --accepts-svg
 *
 * The result always names the format, the file, whether it is a fallback and why.
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { inspectPdf, normalizeText } from "./pdf_text.mjs";

export const TARGETS = { markdown: "svg", html: "svg", pdf: "pdf", word: "png", "google-docs": "png" };

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

export function svgSize(svg) {
  const match = /<svg\b[^>]*\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/.exec(svg);
  if (!match) throw new Error("the SVG has no width and height attributes");
  return { width: Number(match[1]), height: Number(match[2]) };
}

const dataUri = svg => `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
const sheet = (svg, { width, height }) => `<!doctype html><meta charset="utf-8"><style>@page{size:${width}px ${height}px;margin:0}html,body{margin:0;padding:0;background:#fff}img,svg{display:block}</style><img src="${dataUri(svg)}" width="${width}" height="${height}">`;

/** Every visible piece of text in the SVG, read where the browser lays it out. */
async function visibleLabels(browser, svg) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><meta charset="utf-8"><body style="margin:0">${svg}`);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => [...document.querySelectorAll("svg text")]
      .filter(label => { const box = label.getBoundingClientRect(); return box.width > 0 && box.height > 0 && getComputedStyle(label).display !== "none" && getComputedStyle(label).visibility !== "hidden"; })
      .map(label => label.textContent.replace(/\s+/g, " ").trim()).filter(Boolean));
  } finally { await page.close(); }
}

async function renderPdf(browser, svg, size) {
  const page = await browser.newPage();
  try {
    await page.setContent(sheet(svg, size));
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    return await page.pdf({ width: `${size.width}px`, height: `${size.height}px`, printBackground: true, pageRanges: "1" });
  } finally { await page.close(); }
}

async function renderPng(browser, svg, size, scale) {
  const context = await browser.newContext({ viewport: { width: Math.ceil(size.width), height: Math.ceil(size.height) }, deviceScaleFactor: scale });
  try {
    const page = await context.newPage();
    await page.setContent(sheet(svg, size));
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode())));
    return await page.screenshot({ clip: { x: 0, y: 0, width: size.width, height: size.height } });
  } finally { await context.close(); }
}

/** Is this PDF a faithful, text-preserving copy of the SVG? */
export function verifyPdf(pdf, { size, labels }) {
  const problems = [];
  const report = inspectPdf(pdf);
  if (!report.understood) return { ok: false, problems: [`the PDF could not be read (${report.notes.join("; ") || "unknown structure"})`], report };
  if (report.pages.length !== 1) problems.push(`the PDF has ${report.pages.length} pages, expected 1`);
  const [page] = report.pages;
  if (page) {
    // CSS px -> PDF points is 0.75; allow a point of rounding in each direction.
    const expected = { width: size.width * 0.75, height: size.height * 0.75 };
    if (Math.abs(page.width - expected.width) > 1.5 || Math.abs(page.height - expected.height) > 1.5) problems.push(`the PDF page is ${page.width}x${page.height} pt, the diagram needs ${expected.width.toFixed(1)}x${expected.height.toFixed(1)} pt`);
  }
  const text = normalizeText((page?.text || []).join(""));
  const missing = [...new Set(labels)].filter(label => !text.includes(normalizeText(label)));
  if (missing.length) problems.push(`${missing.length} of ${new Set(labels).size} labels are not text in the PDF (missing: ${missing.slice(0, 5).map(label => JSON.stringify(label)).join(", ")}${missing.length > 5 ? ", ..." : ""})`);
  if (!labels.length) problems.push("the SVG has no visible text to check");
  return { ok: problems.length === 0, problems, report };
}

/**
 * @param {{svg: string, target: string, outDir: string, name?: string, acceptsSvg?: boolean, scale?: number, chromium?: object, buildPdf?: Function}} options
 * @returns {Promise<{format: "svg"|"pdf"|"png", file: string, path: string, fallback: boolean, reason: string, checks?: object}>}
 */
export async function exportForDocument({ svg, target, outDir, name = "diagram", acceptsSvg = false, scale = 2, chromium, buildPdf = renderPdf }) {
  if (!(target in TARGETS)) throw new Error(`unknown target "${target}" (available: ${Object.keys(TARGETS).join(", ")})`);
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new Error(`name must be a plain file name, got ${JSON.stringify(name)}`);
  const size = svgSize(svg);
  mkdirSync(outDir, { recursive: true });
  const finish = (format, bytes, extra) => {
    const file = `${name}.${format}`, path = join(outDir, file);
    writeFileSync(path, bytes);
    return { format, file, path, ...extra };
  };

  if (target === "markdown" || target === "html" || (TARGETS[target] === "png" && acceptsSvg)) {
    return finish("svg", svg, { fallback: false, reason: acceptsSvg && TARGETS[target] === "png" ? `${target} was declared to accept SVG` : `${target} shows SVG directly` });
  }

  const browserType = chromium || await loadChromium();
  if (!browserType) throw new Error("Playwright/Chromium is required to convert the SVG (npm i playwright && npx playwright install chromium)");
  const browser = await browserType.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  try {
    if (target === "pdf") {
      const labels = await visibleLabels(browser, svg);
      const pdf = await buildPdf(browser, svg, size);
      const verdict = verifyPdf(pdf, { size, labels });
      if (verdict.ok) return finish("pdf", pdf, { fallback: false, reason: "the PDF keeps the page size and every label as text", checks: { pages: 1, labels: new Set(labels).size, fonts: verdict.report.fonts, images: verdict.report.images } });
      const png = await renderPng(browser, svg, size, scale);
      return finish("png", png, { fallback: true, reason: `PDF conversion was rejected: ${verdict.problems.join("; ")}; a ${scale}x PNG of the same SVG was written instead`, checks: { rejected: verdict.problems } });
    }
    const png = await renderPng(browser, svg, size, scale);
    return finish("png", png, { fallback: true, reason: `${target} does not reliably display SVG, so a ${scale}x PNG of the same SVG was written (pass acceptsSvg if the destination takes it)` });
  } finally { await browser.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const argv = process.argv.slice(2);
    for (let index = 0; index < argv.length; index += 1) {
      if (argv[index] === "--accepts-svg") { options.acceptsSvg = true; continue; }
      if (!argv[index].startsWith("--") || argv[index + 1] === undefined) throw new Error("usage: document_format.mjs --svg diagram.svg --target markdown|html|pdf|word|google-docs --out dir [--name diagram] [--accepts-svg]");
      options[argv[index].slice(2)] = argv[index + 1]; index += 1;
    }
    if (!options.svg || !options.target || !options.out) throw new Error("usage: document_format.mjs --svg diagram.svg --target markdown|html|pdf|word|google-docs --out dir [--name diagram] [--accepts-svg]");
    const result = await exportForDocument({ svg: readFileSync(resolve(options.svg), "utf8"), target: options.target, outDir: resolve(options.out), name: options.name || basename(options.svg).replace(/\.svg$/i, ""), acceptsSvg: options.acceptsSvg });
    console.log(`${result.format}${result.fallback ? " (fallback)" : ""}: ${result.path}\n${result.reason}`);
  } catch (error) {
    console.error(`document_format: ${error.message}`);
    process.exit(error.message.startsWith("usage:") ? 2 : 1);
  }
}
