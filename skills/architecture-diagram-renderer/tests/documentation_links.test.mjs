/* FEAT-002.3: Markdown links to each snapshot and to the interactive presenter.
 *
 * snapshots.md gives every exported state an image (the static SVG, which keeps working where
 * a page cannot run the presenter), a plain link to that SVG as the fallback, and, when a
 * viewer URL is supplied, a link that opens the presenter on the same view and state.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { PYTHON } from "../../../scripts/python_command.mjs";
import { exportSnapshots } from "../scripts/export_snapshots.mjs";
import { buildMarkdown } from "../scripts/snapshot_links.mjs";
import { FIXTURES, ROOT, TEMPLATE, browserSkip, chromium } from "./doc_export_harness.mjs";

const skip = browserSkip();
const BUNDLE = join(FIXTURES, "commerce-views.json");
const temporary = [];
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));
const scratch = () => { const path = mkdtempSync(join(tmpdir(), "links-test-")); temporary.push(path); return path; };

async function exported(modelPath, viewerUrl) {
  const outDir = scratch();
  const result = await exportSnapshots({ modelPath, outDir, chromium, viewerUrl });
  return { outDir, ...result, markdown: readFileSync(join(outDir, "snapshots.md"), "utf8") };
}
const images = markdown => [...markdown.matchAll(/!\[([^\]]*)\]\(([^)\s]+)\)/g)].map(match => ({ alt: match[1], target: match[2] }));
const links = markdown => [...markdown.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)].map(match => ({ text: match[1], target: match[2] }));

test("every snapshot gets an image, a static fallback link and a presenter link", { skip }, async () => {
  const { files, markdown } = await exported(BUNDLE, "presenter.html");
  assert.equal(images(markdown).length, files.length, "one image per snapshot");
  for (const entry of files) {
    assert.ok(images(markdown).some(image => image.target === encodeURIComponent(entry.file)), `${entry.file} has no image`);
    assert.ok(links(markdown).some(link => link.text === "SVG" && link.target === encodeURIComponent(entry.file)), `${entry.file} has no plain SVG link (the static fallback)`);
  }
  assert.equal(links(markdown).filter(link => link.text === "Open in the interactive presenter").length, files.length);
  assert.match(markdown, /^# /m);
  assert.ok(markdown.endsWith("\n") && !markdown.includes("\r"));
});

test("the presenter links open the same view and state that the snapshot shows", { skip }, async () => {
  const outDir = scratch(), html = join(outDir, "presenter.html");
  execFileSync(PYTHON, [join(ROOT, "architecture-diagram-renderer", "scripts", "build_bundle.py"), "--template", TEMPLATE, "--model", BUNDLE, "--output", html]);
  const { files, markdown } = await exported(BUNDLE, "presenter.html");
  const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: "reduce" });
    const presenterLinks = links(markdown).filter(link => link.text === "Open in the interactive presenter");
    for (const [position, link] of presenterLinks.entries()) {
      const entry = files[position];
      const query = new URL(link.target, "http://presenter.invalid/").searchParams;
      assert.equal(query.get("view"), entry.view, `${entry.file}: wrong view in ${link.target}`);
      assert.equal(query.get(entry.parameter), String(entry.index), `${entry.file}: wrong ${entry.parameter} in ${link.target}`);
      await page.goto(`${pathToFileURL(html).href}${link.target.replace(/^presenter\.html/, "")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.waitForFunction(() => window.diagramReady && document.querySelector("g.nodes g.node"), null, { timeout: 120000 });
      const shown = await page.evaluate(() => ({ indicator: document.getElementById("stage-indicator").textContent, nodes: [...document.querySelectorAll("#diagram g.node")].map(node => node.getAttribute("data-id")).sort() }));
      assert.ok(shown.indicator.includes(`${entry.index} /`) && shown.indicator.includes(entry.title), `${entry.file}: the presenter shows "${shown.indicator}" for ${link.target}`);
      const snapshotNodes = [...readFileSync(entry.path, "utf8").matchAll(/<g\b[^>]*\bclass="node[^"]*"[^>]*>/g)].map(match => /data-id="([^"]+)"/.exec(match[0])?.[1]).filter(Boolean).sort();
      assert.deepEqual(shown.nodes, snapshotNodes, `${entry.file}: the presenter shows [${shown.nodes}] but the snapshot holds [${snapshotNodes}]`);
    }
  } finally { await browser.close(); }
});

test("without a viewer URL the page still works: images and static links only", { skip }, async () => {
  const { files, markdown } = await exported(BUNDLE);
  assert.equal(images(markdown).length, files.length);
  assert.equal(links(markdown).filter(link => link.text === "Open in the interactive presenter").length, 0);
  assert.equal(links(markdown).filter(link => link.text === "SVG").length, files.length);
  assert.match(markdown, /No interactive presenter link was given/);
});

test("the generated Markdown is reproducible and groups snapshots by view in order", { skip }, async () => {
  const first = await exported(BUNDLE, "https://example.org/architecture/presenter.html"), second = await exported(BUNDLE, "https://example.org/architecture/presenter.html");
  assert.equal(first.markdown, second.markdown);
  const headings = [...first.markdown.matchAll(/^## (.+)$/gm)].map(match => match[1]);
  assert.equal(headings.length, 3);
  assert.ok(first.markdown.indexOf(headings[0]) < first.markdown.indexOf(headings[1]));
  assert.ok(links(first.markdown).some(link => link.target === "https://example.org/architecture/presenter.html?view=checkout&step=2"));
});

test("a viewer URL that is not http, https or relative is refused, and text is escaped", () => {
  const manifest = { snapshots: [{ view: "v", mode: "system", state: { index: 1, id: "s", title: "A [tricky] `title` | with <html> & more" }, file: "a b.svg", parameter: "stage" }] };
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "file:///etc/passwd", "ja\tvascript:alert(1)", "//evil.example/x"]) {
    assert.throws(() => buildMarkdown({ manifest, title: "T", viewerUrl: bad }), /viewer URL/, bad);
  }
  const markdown = buildMarkdown({ manifest, title: "T", viewerUrl: "presenter.html" });
  assert.doesNotMatch(markdown, /\[tricky\]|`title`|<html>/, "special characters in titles must be escaped");
  assert.ok(markdown.includes("a%20b.svg"), "file names are percent-encoded");
  assert.match(markdown, /presenter\.html\?view=v&stage=1/);
});
