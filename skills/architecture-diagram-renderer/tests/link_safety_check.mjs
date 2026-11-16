/* FIX-010: the stage docs/adr links must never become a script-capable URL.
 *
 * Browsers delete tab, CR and LF from a URL and strip leading control characters
 * and spaces before reading its scheme, so "java\tscript:..." is a javascript:
 * link to the browser even though a plain text match does not see it. The check
 * builds one stage per hostile value and inspects the anchors the page renders.
 */
import { execFileSync, execSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PYTHON } from "../../scripts/python_command.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ROOT = resolve(HERE, "../..");
const TEMPLATE = join(ROOT, "architecture-diagram-renderer", "assets", "template.html");
const BUILDER = join(ROOT, "architecture-diagram-renderer", "scripts", "build_bundle.py");
const required = process.env.REQUIRE_BROWSER_TESTS === "1";

async function loadChromium() {
  for (const root of [execSync("npm root -g").toString().trim(), execSync("npm root").toString().trim()]) {
    try { return (await import(pathToFileURL(join(root, "playwright-core", "index.mjs")).href)).chromium; } catch {}
  }
  try { return (await import("playwright")).chromium; } catch {}
  return null;
}

const chromium = await loadChromium();
if (!chromium) {
  console.log(`${required ? "FAIL" : "SKIP"} link_safety_check: Playwright/Chromium unavailable`);
  process.exit(required ? 2 : 0);
}

// [value, shouldRender]
const CASES = [
  ["javascript:alert(1)", false],
  ["JaVaScRiPt:alert(1)", false],
  ["java\tscript:alert(1)", false],
  ["java\nscript:alert(1)", false],
  ["java\rscript:alert(1)", false],
  ["\u0001javascript:alert(1)", false],
  ["  javascript:alert(1)", false],
  ["data:text/html,<script>alert(1)</script>", false],
  ["vbscript:msgbox(1)", false],
  ["file:///etc/passwd", false],
  ["docs/readme.md", true],
  ["docs/my file.md", true],
  ["../adr/0042-boundary.md#decision", true],
  ["#section", true],
  ["https://example.org/spec", true],
  ["mailto:team@example.org", true],
];

const work = mkdtempSync(join(tmpdir(), "link-safety-"));
let browser, failed = true;
try {
  const model = {
    meta: { title: "Link safety" },
    canvas: { w: 800, h: 400, minWidth: 600 },
    catalog: { a: { label: "A", type: "service", shape: "service", kind: "existing" } },
    packages: {},
    stages: CASES.map(([value], index) => ({ id: `s${index}`, title: `Stage ${index}`, nodes: ["a"], wires: [], docs: value, adr: value })),
  };
  const modelPath = join(work, "model.json"), htmlPath = join(work, "bundle.html");
  writeFileSync(modelPath, JSON.stringify(model));
  execFileSync(PYTHON, [BUILDER, "--template", TEMPLATE, "--model", modelPath, "--output", htmlPath]);
  browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
  const rendered = await page.evaluate(async count => {
    const rows = [];
    for (let index = 0; index < count; index += 1) {
      document.querySelectorAll("#pills button")[index].dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 60));
      // A browser deletes tab/CR/LF and leading control characters and spaces before reading the scheme.
      const authoredScheme = href => (/^([a-z][a-z0-9+.-]*):/i.exec((href || "").replace(/[\t\n\r]/g, "").replace(/^[\u0000-\u0020]+/, "")) || [])[1]?.toLowerCase() || null;
      rows.push([...document.querySelectorAll("#stage-links a")].map(anchor => ({ protocol: anchor.protocol, scheme: authoredScheme(anchor.getAttribute("href")), href: anchor.getAttribute("href"), target: anchor.target, rel: anchor.rel })));
    }
    return rows;
  }, CASES.length);

  const failures = [];
  const SCRIPTABLE_SCHEMES = new Set(["javascript", "data", "vbscript", "blob", "file"]), SCRIPTABLE_PROTOCOLS = new Set(["javascript:", "data:", "vbscript:", "blob:"]);
  CASES.forEach(([value, shouldRender], index) => {
    const links = rendered[index];
    const label = JSON.stringify(value);
    for (const link of links) {
      if (SCRIPTABLE_PROTOCOLS.has(link.protocol) || SCRIPTABLE_SCHEMES.has(link.scheme)) failures.push(`${label} rendered a ${link.scheme || link.protocol} link: ${JSON.stringify(link.href)}`);
      if (/^https?:/i.test(link.href || "") && (link.target !== "_blank" || !/noopener/.test(link.rel))) failures.push(`${label} external link lacks target=_blank rel=noopener`);
    }
    if (!shouldRender && links.length) failures.push(`${label} should render no link, rendered ${links.length}`);
    if (shouldRender && links.length !== 2) failures.push(`${label} should render a docs and an adr link, rendered ${links.length}`);
  });
  if (pageErrors.length) failures.push(`page errors: ${pageErrors.join("; ")}`);

  if (failures.length) { failures.forEach(item => console.error(`✗ ${item}`)); }
  else { console.log(`✓ link_safety_check: ${CASES.length} docs/adr values, none rendered a script-capable link`); failed = false; }
} finally {
  await browser?.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
