/* TASK-015: every external script the renderer pages load is pinned by Subresource Integrity.
 *
 * The pages load D3, Dagre, ELK, gif.js and js-yaml from public CDNs at exact versions. A
 * version pin does not stop a compromised or mis-served file from running with the page's
 * privileges, so each tag carries a sha384 `integrity` hash and `crossorigin="anonymous"`
 * (required for the browser to check a cross-origin script), and the gif worker, which is
 * fetched rather than loaded by a tag, passes the same hash to fetch().
 *
 * assets/cdn-integrity.json is the single list of those hashes. This check is static and
 * offline. Set VERIFY_CDN_INTEGRITY=1 to also download every file and compare its hash.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const ASSETS = join(HERE, "..", "assets");
const PAGES = ["template.html", "translate.html"];
const failures = [];

let manifest = {};
try { manifest = JSON.parse(readFileSync(join(ASSETS, "cdn-integrity.json"), "utf8")); }
catch (error) { failures.push(`assets/cdn-integrity.json could not be read: ${error.message}`); }

const INTEGRITY = /^sha384-[A-Za-z0-9+/]{64}$/;
for (const [url, value] of Object.entries(manifest)) {
  if (!INTEGRITY.test(value)) failures.push(`manifest entry for ${url} is not a sha384 integrity value: ${value}`);
}

const used = new Set();
const html = Object.fromEntries(PAGES.map(page => [page, readFileSync(join(ASSETS, page), "utf8")]));
for (const [page, source] of Object.entries(html)) {
  const tags = [...source.matchAll(/<script\b[^>]*\bsrc="(https?:\/\/[^"]+)"[^>]*>/g)];
  if (!tags.length) failures.push(`${page}: found no external script tags, the scan is vacuous`);
  for (const [tag, url] of tags) {
    used.add(url);
    const integrity = /\bintegrity="([^"]*)"/.exec(tag)?.[1];
    const crossorigin = /\bcrossorigin="([^"]*)"/.exec(tag)?.[1];
    if (!manifest[url]) failures.push(`${page}: ${url} has no entry in cdn-integrity.json`);
    if (!integrity) failures.push(`${page}: ${url} has no integrity attribute`);
    else if (manifest[url] && integrity !== manifest[url]) failures.push(`${page}: ${url} integrity differs from cdn-integrity.json`);
    if (crossorigin !== "anonymous") failures.push(`${page}: ${url} needs crossorigin="anonymous" for the integrity check to apply`);
  }
}

// The worker script is fetched, so the integrity check has to be asked for on the fetch.
const workerUrl = /const GIF_WORKER_CDN_URL = "([^"]+)"/.exec(html["template.html"])?.[1];
if (!workerUrl) failures.push("template.html: GIF_WORKER_CDN_URL not found");
else {
  used.add(workerUrl);
  if (!manifest[workerUrl]) failures.push(`template.html: gif worker ${workerUrl} has no entry in cdn-integrity.json`);
  if (!/fetch\(GIF_WORKER_CDN_URL,\s*\{[^}]*integrity:\s*GIF_WORKER_INTEGRITY/.test(html["template.html"])) failures.push("template.html: the gif worker fetch does not pass an integrity option");
  if (!manifest[workerUrl] || !html["template.html"].includes(`const GIF_WORKER_INTEGRITY = "${manifest[workerUrl]}"`)) failures.push("template.html: GIF_WORKER_INTEGRITY does not equal the manifest hash");
}

for (const url of Object.keys(manifest)) if (!used.has(url)) failures.push(`cdn-integrity.json lists ${url}, which no page loads`);

if (process.env.VERIFY_CDN_INTEGRITY === "1") {
  for (const [url, expected] of Object.entries(manifest)) {
    try {
      const response = await fetch(url);
      if (!response.ok) { failures.push(`${url}: HTTP ${response.status}`); continue; }
      const actual = `sha384-${createHash("sha384").update(Buffer.from(await response.arrayBuffer())).digest("base64")}`;
      if (actual !== expected) failures.push(`${url}: downloaded file hashes to ${actual}, manifest says ${expected}`);
    } catch (error) { failures.push(`${url}: could not download (${error.message})`); }
  }
}

if (failures.length) {
  failures.forEach(item => console.error(`✗ ${item}`));
  process.exit(1);
}
console.log(`✓ script_integrity_check: ${used.size} CDN files pinned by sha384${process.env.VERIFY_CDN_INTEGRITY === "1" ? " and verified against the network" : ""}`);
