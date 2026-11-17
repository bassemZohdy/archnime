#!/usr/bin/env node
/* Vendor the renderer's runtime libraries into assets/vendor/ for offline use.
 *
 *   node archnime-renderer/scripts/vendor_assets.mjs
 *
 * Each file is downloaded from the exact CDN URL the pages already pin and is written only if
 * its SHA-384 equals the Subresource Integrity hash in assets/cdn-integrity.json, so a vendored
 * copy is byte-for-byte what the CDN serves. Licence texts are downloaded beside them and a
 * manifest records name, version, SPDX licence, source URL, size and hash of every file. Run it
 * again after changing a pinned version (update cdn-integrity.json first); the output is stable.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "assets");
const VENDOR = join(ASSETS, "vendor");
const integrity = JSON.parse(readFileSync(join(ASSETS, "cdn-integrity.json"), "utf8"));

export const LIBRARIES = [
  { name: "d3", version: "7.9.0", license: "ISC", homepage: "https://d3js.org/", licenseFile: "d3.LICENSE",
    licenseUrl: "https://cdn.jsdelivr.net/npm/d3@7.9.0/LICENSE",
    files: [{ file: "d3.min.js", source: "https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js" }] },
  { name: "dagre", version: "1.1.4", license: "MIT", homepage: "https://github.com/dagrejs/dagre", licenseFile: "dagre.LICENSE",
    licenseUrl: "https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/LICENSE",
    files: [{ file: "dagre.min.js", source: "https://cdn.jsdelivr.net/npm/@dagrejs/dagre@1.1.4/dist/dagre.min.js" }] },
  { name: "elkjs", version: "0.12.0", license: "EPL-2.0 OR GPL-3.0-or-later", homepage: "https://github.com/kieler/elkjs", licenseFile: "elkjs.LICENSE.md",
    licenseUrl: "https://cdn.jsdelivr.net/npm/elkjs@0.12.0/LICENSE.md",
    files: [{ file: "elk.bundled.js", source: "https://cdn.jsdelivr.net/npm/elkjs@0.12.0/lib/elk.bundled.js" }] },
  { name: "gif.js", version: "0.2.0", license: "MIT", homepage: "https://github.com/jnordberg/gif.js", licenseFile: "gif.js.LICENSE",
    licenseUrl: "https://raw.githubusercontent.com/jnordberg/gif.js/master/LICENSE",
    files: [
      { file: "gif.js", source: "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.js" },
      { file: "gif.worker.js", source: "https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js" },
    ] },
  { name: "js-yaml", version: "4.1.1", license: "MIT", homepage: "https://github.com/nodeca/js-yaml", licenseFile: "js-yaml.LICENSE",
    licenseUrl: "https://cdn.jsdelivr.net/npm/js-yaml@4.1.1/LICENSE",
    files: [{ file: "js-yaml.min.js", source: "https://cdnjs.cloudflare.com/ajax/libs/js-yaml/4.1.1/js-yaml.min.js" }] },
];

const sha384 = bytes => `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

export async function vendorAssets() {
  mkdirSync(VENDOR, { recursive: true });
  const libraries = [];
  for (const library of LIBRARIES) {
    const files = [];
    for (const file of library.files) {
      const expected = integrity[file.source];
      if (!expected) throw new Error(`${file.source} is not pinned in cdn-integrity.json`);
      const bytes = await download(file.source);
      if (sha384(bytes) !== expected) throw new Error(`${file.source} no longer matches its pinned hash; refusing to vendor it`);
      writeFileSync(join(VENDOR, file.file), bytes);
      files.push({ file: file.file, source: file.source, bytes: bytes.length, sha384: expected });
    }
    const license = await download(library.licenseUrl);
    writeFileSync(join(VENDOR, library.licenseFile), license);
    libraries.push({ name: library.name, version: library.version, license: library.license, homepage: library.homepage, licenseFile: library.licenseFile, licenseSource: library.licenseUrl, files });
  }
  writeFileSync(join(VENDOR, "manifest.json"), `${JSON.stringify({ schema: "architecture-diagram-vendor/1", libraries }, null, 2)}\n`, "utf8");
  return libraries;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const libraries = await vendorAssets();
    console.log(`vendored ${libraries.reduce((count, library) => count + library.files.length, 0)} file(s) from ${libraries.length} libraries into ${VENDOR}`);
  } catch (error) {
    console.error(`vendor_assets: ${error.message}`);
    process.exit(1);
  }
}
