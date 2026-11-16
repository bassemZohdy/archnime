/* FEAT-003.2: a portable presenter built only from local, trusted resources.
 *
 * `build_bundle.py --offline` replaces every CDN script with the vendored copy (checked against
 * its pinned hash at build time) and embeds the GIF worker, so the page needs nothing from the
 * network. These tests build such a bundle, then open it with every non-file request blocked
 * and prove that layout, playback, zoom, search, routing and GIF export still work, that no
 * request leaves the machine, and that a missing or altered asset fails clearly instead of
 * giving a blank page.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { EXAMPLES, FIXTURES, ROOT, TEMPLATE, browserSkip, chromium } from "./doc_export_harness.mjs";

const skip = browserSkip();
const BUILDER = join(ROOT, "archnime-renderer", "scripts", "build_bundle.py");
const ASSETS = join(ROOT, "archnime-renderer", "assets");
const temporary = [];
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));
const scratch = () => { const path = mkdtempSync(join(tmpdir(), "offline-test-")); temporary.push(path); return path; };

/** Copy the template and its sidecars somewhere writable so a test can damage the assets. */
function stagedTemplate() {
  const directory = scratch();
  for (const name of ["template.html", "architecture-library.js", "diagram-engine.js"]) copyFileSync(join(ASSETS, name), join(directory, name));
  mkdirSync(join(directory, "vendor"));
  for (const name of readdirSync(join(ASSETS, "vendor"))) copyFileSync(join(ASSETS, "vendor", name), join(directory, "vendor", name));
  copyFileSync(join(ASSETS, "cdn-integrity.json"), join(directory, "cdn-integrity.json"));
  mkdirSync(join(directory, "fonts"));
  for (const name of readdirSync(join(ASSETS, "fonts"))) copyFileSync(join(ASSETS, "fonts", name), join(directory, "fonts", name));
  return directory;
}

function build(modelPath, { template = TEMPLATE, flags = [], output = join(scratch(), "diagram.html") } = {}) {
  const result = spawnSync(PYTHON, [BUILDER, "--template", template, "--model", modelPath, "--output", output, "--offline", ...flags], { encoding: "utf8" });
  return { ...result, output };
}

/** Open a built page with the network cut off, recording every request that is not local. */
async function openOffline(html, { query = "" } = {}) {
  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", acceptDownloads: true });
  const external = [];
  await context.route(url => !/^(file|data|blob|about):/i.test(url.toString()), route => { external.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(pathToFileURL(html).href + query, { waitUntil: "domcontentloaded", timeout: 120000 });
  return { browser, page, external, errors };
}
const ready = page => page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 }).then(() => page.evaluate(() => window.diagramReady));

test("the offline bundle references no network resource at all", () => {
  const { status, output, stderr } = build(join(FIXTURES, "checkout-flow.json"));
  assert.equal(status, 0, stderr);
  const html = readFileSync(output, "utf8");
  assert.doesNotMatch(html, /<script[^>]*\bsrc="https?:/i, "a script still loads from the network");
  assert.doesNotMatch(html, /\bintegrity="|crossorigin=/, "local scripts must not carry CDN-only attributes");
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com/, "a CDN host is still mentioned");
  assert.match(html, /id="gif-worker-source"/);
  for (const name of ["d3.min.js", "dagre.min.js", "elk.bundled.js", "gif.js"]) assert.ok(existsSync(join(output, "..", "vendor", name)), `vendor/${name} was not placed beside the bundle`);
});

test("blocked network: layout, playback, zoom, search and routing all work", { skip }, async () => {
  const { status, output, stderr } = build(join(FIXTURES, "checkout-flow.json"));
  assert.equal(status, 0, stderr);
  const session = await openOffline(output);
  try {
    const { page } = session;
    await ready(page);
    assert.deepEqual(await page.evaluate(() => window.diagramSelfCheck({ displayed: true })), [], "the layout self-check reports problems offline");
    assert.ok(await page.evaluate(() => document.querySelectorAll("g.nodes g.node").length) >= 5);

    const stepBefore = await page.textContent("#stage-indicator");
    await page.evaluate(() => document.getElementById("btn-next").click());
    await page.waitForFunction(before => document.getElementById("stage-indicator").textContent !== before, stepBefore);

    const box = await page.locator("#diagram").boundingBox();
    await page.mouse.move(box.x + 6, box.y + 6);
    await page.mouse.wheel(0, -900);
    await page.waitForTimeout(250);
    assert.match(await page.evaluate(() => document.querySelector("g.viewport").getAttribute("transform") || ""), /scale\(/, "wheel zoom did nothing");

    await page.fill("#search", "Gateway");
    await page.evaluate(() => document.getElementById("btn-search").click());
    await page.waitForFunction(() => document.querySelector("#diagram g.node.search-hit"));

    const pathBefore = await page.evaluate(() => document.querySelector("g.wire path.main")?.getAttribute("d"));
    await page.evaluate(() => { const select = document.getElementById("routing-select"); select.value = "orthogonal"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForFunction(before => document.querySelector("g.wire path.main")?.getAttribute("d") !== before, pathBefore, { timeout: 15000 });

    assert.deepEqual(session.external, [], "the page tried to reach the network");
    assert.deepEqual(session.errors, [], "the page raised script errors offline");
  } finally { await session.browser.close(); }
});

test("blocked network: ELK and Dagre both lay out a dense model", { skip }, async () => {
  const { status, output, stderr } = build(join(EXAMPLES, "dense-mesh-model.json"));
  assert.equal(status, 0, stderr);
  const session = await openOffline(output);
  try {
    const { page } = session;
    await ready(page);
    const engines = await page.evaluate(() => ({ elk: typeof ELK, dagre: typeof dagre, d3: typeof d3, selfCheck: window.diagramSelfCheck().length }));
    assert.deepEqual({ elk: engines.elk, dagre: engines.dagre, d3: engines.d3 }, { elk: "function", dagre: "object", d3: "object" });
    assert.equal(engines.selfCheck, 0, "the dense layout has self-check findings offline");
    assert.deepEqual(session.external, []);
  } finally { await session.browser.close(); }
});

test("blocked network: GIF export works from the embedded worker", { skip }, async () => {
  // A short, low-rate GIF keeps this test quick; the worker and encoder are the same either way.
  const model = JSON.parse(readFileSync(join(EXAMPLES, "portable-transition-model.json"), "utf8"));
  model.meta.gif = { fps: 2, maxDurationMs: 2000 };
  const shortModel = join(scratch(), "short-gif.json");
  writeFileSync(shortModel, JSON.stringify(model));
  const { status, output, stderr } = build(shortModel);
  assert.equal(status, 0, stderr);
  const session = await openOffline(output);
  try {
    const { page } = session;
    await ready(page);
    const download = page.waitForEvent("download", { timeout: 90000 });
    await page.evaluate(() => document.getElementById("btn-export-gif").click());
    const file = await download;
    assert.match(file.suggestedFilename(), /\.gif$/);
    const bytes = readFileSync(await file.path());
    assert.equal(bytes.subarray(0, 4).toString("latin1"), "GIF8", "the download is not a GIF");
    assert.deepEqual(session.external, []);
  } finally { await session.browser.close(); }
});

test("a single-file offline bundle (--inline) needs no sibling files", { skip }, async () => {
  const directory = scratch(), { status, output, stderr } = build(join(FIXTURES, "checkout-flow.json"), { flags: ["--inline"], output: join(directory, "single.html") });
  assert.equal(status, 0, stderr);
  assert.deepEqual(readdirSync(directory), ["single.html"], "an inline offline build must not write sidecar files");
  const html = readFileSync(output, "utf8");
  assert.ok(html.length > 1_500_000, "the libraries should be inlined");
  const session = await openOffline(output);
  try {
    await ready(session.page);
    assert.deepEqual(session.external, []);
  } finally { await session.browser.close(); }
});

test("a missing or altered vendored file fails the build with a clear message", () => {
  const model = join(FIXTURES, "checkout-flow.json");

  const missing = stagedTemplate();
  rmSync(join(missing, "vendor", "d3.min.js"));
  const gone = build(model, { template: join(missing, "template.html") });
  assert.notEqual(gone.status, 0);
  assert.match(gone.stderr, /offline build failed: .*d3\.min\.js.* is missing/);

  const altered = stagedTemplate();
  writeFileSync(join(altered, "vendor", "dagre.min.js"), `${readFileSync(join(altered, "vendor", "dagre.min.js"), "utf8")}\n/* tampered */`);
  const changed = build(model, { template: join(altered, "template.html") });
  assert.notEqual(changed.status, 0);
  assert.match(changed.stderr, /offline build failed: .*dagre\.min\.js.* does not match its pinned hash/);

  const noManifest = stagedTemplate();
  rmSync(join(noManifest, "vendor", "manifest.json"));
  assert.match(build(model, { template: join(noManifest, "template.html") }).stderr, /offline build failed: .*manifest\.json/);
});

test("if a library goes missing after the build the page says so instead of staying blank", { skip }, async () => {
  const { status, output, stderr } = build(join(FIXTURES, "checkout-flow.json"));
  assert.equal(status, 0, stderr);
  rmSync(join(output, "..", "vendor", "d3.min.js"));
  const session = await openOffline(output);
  try {
    const { page } = session;
    await page.waitForSelector("[role=alert]", { timeout: 15000 });
    const message = await page.textContent("[role=alert]");
    assert.match(message, /cannot start/i);
    assert.match(message, /\bd3\b/);
    assert.match(message, /--offline|network/i, "the message should say how to fix it");
  } finally { await session.browser.close(); }
});
