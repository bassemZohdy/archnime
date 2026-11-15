/* FEAT-003.1: the runtime libraries are vendored, pinned and licensed.
 *
 * assets/vendor/ holds exact copies of the libraries the renderer otherwise loads from CDNs,
 * with each one's licence text and a manifest. The checks are offline and static: every file's
 * SHA-384 must equal the Subresource Integrity hash already pinned for its CDN URL (so a
 * vendored copy is byte-for-byte what the CDN serves), every licence must be present and
 * recognisable, and nothing may sit in the directory that the manifest does not list.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const ASSETS = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "assets");
const VENDOR = join(ASSETS, "vendor");
const integrity = JSON.parse(readFileSync(join(ASSETS, "cdn-integrity.json"), "utf8"));
const manifestPath = join(VENDOR, "manifest.json");
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, "utf8")) : { libraries: [] };
const sha384 = bytes => `sha384-${createHash("sha384").update(bytes).digest("base64")}`;

// What each licence text must contain so an empty or wrong file cannot pass.
const LICENSE_MARKERS = {
  "ISC": /Permission to use, copy, modify, and\/or distribute this software/,
  "MIT": /Permission is hereby granted, free of charge/,
  "EPL-2.0 OR GPL-3.0-or-later": /Eclipse Public License - v 2\.0/,
};
const ALLOWED_LICENSES = new Set(Object.keys(LICENSE_MARKERS));

test("the manifest lists a vendored copy of every CDN script the pages load", () => {
  assert.ok(existsSync(manifestPath), "assets/vendor/manifest.json is missing");
  const vendoredUrls = manifest.libraries.flatMap(library => library.files.map(file => file.source)).sort();
  assert.deepEqual(vendoredUrls, Object.keys(integrity).sort(), "the vendored files must cover exactly the CDN URLs pinned in cdn-integrity.json");
  assert.deepEqual(manifest.libraries.map(library => library.name).sort(), ["d3", "dagre", "elkjs", "gif.js", "js-yaml"]);
});

test("every vendored file is byte-identical to the pinned CDN file (SHA-384) and is the pinned version", () => {
  for (const library of manifest.libraries) {
    for (const file of library.files) {
      const path = join(VENDOR, file.file);
      assert.ok(existsSync(path), `${file.file} is missing`);
      const bytes = readFileSync(path);
      assert.equal(sha384(bytes), integrity[file.source], `${file.file} differs from the pinned ${file.source}`);
      assert.equal(file.sha384, integrity[file.source], `${file.file}: the manifest hash differs from cdn-integrity.json`);
      assert.equal(file.bytes, bytes.length, `${file.file}: the manifest size is stale`);
      assert.ok(file.source.includes(`@${library.version}/`) || file.source.includes(`/${library.version}/`), `${file.file}: ${file.source} is not version ${library.version}`);
    }
  }
});

test("every library has an allowed licence and its licence text is vendored beside it", () => {
  for (const library of manifest.libraries) {
    assert.ok(ALLOWED_LICENSES.has(library.license), `${library.name}: licence ${library.license} is not on the allowed list`);
    const path = join(VENDOR, library.licenseFile);
    assert.ok(existsSync(path), `${library.name}: licence file ${library.licenseFile} is missing`);
    const text = readFileSync(path, "utf8");
    assert.ok(text.length > 300, `${library.name}: the licence text is suspiciously short`);
    assert.match(text, LICENSE_MARKERS[library.license], `${library.name}: ${library.licenseFile} does not read as ${library.license}`);
  }
});

test("nothing sits in assets/vendor that the manifest does not list", () => {
  const listed = new Set(["manifest.json", "README.md"]);
  for (const library of manifest.libraries) { library.files.forEach(file => listed.add(file.file)); listed.add(library.licenseFile); }
  const present = readdirSync(VENDOR).filter(name => statSync(join(VENDOR, name)).isFile());
  assert.deepEqual(present.filter(name => !listed.has(name)).sort(), [], "unlisted files in assets/vendor");
  for (const name of listed) assert.ok(existsSync(join(VENDOR, name)), `${name} is listed but missing`);
});

test("file names are plain, so a manifest cannot point outside the vendor directory", () => {
  for (const library of manifest.libraries) {
    for (const name of [library.licenseFile, ...library.files.map(file => file.file)]) assert.match(name, /^[A-Za-z0-9._-]+$/, `unsafe vendored file name ${JSON.stringify(name)}`);
  }
});
