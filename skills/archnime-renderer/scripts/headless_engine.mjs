/* Load the layout engine in Node, with no browser and no `document`.
 *
 * The engine and its libraries are plain browser scripts that hang their globals
 * on `window`. Each is run as a function whose `window` and `globalThis` are one
 * private object, so nothing leaks into Node's globals and two engines never
 * share state. There is no `document`: text is measured from the pinned Inter
 * advance table and sizes come from the engine's static tokens, which is what
 * the page computes too (tests/headless_layout_check.mjs holds that equal).
 *
 * `self` is passed as undefined on purpose: with `self` and no `document` the
 * pinned ELK bundle takes itself for a web worker and exposes no layout.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
const SCRIPTS = ["vendor/d3.min.js", "vendor/dagre.min.js", "vendor/elk.bundled.js", "architecture-library.js", "diagram-engine.js"];
// What a stored geometry depends on besides the model: the code that computed it.
const ENGINE_SOURCES = ["diagram-engine.js", "architecture-library.js"];

export function loadHeadlessEngine(assets = ASSETS) {
  // Reads fall through to Node's globals (ELK looks up `Error` and timers on its window); writes stay private.
  const scope = Object.create(globalThis);
  for (const file of SCRIPTS) {
    const source = readFileSync(join(assets, file), "utf8");
    new Function("window", "globalThis", "self", "document", `${source}\n//# sourceURL=${file}`)(scope, scope, undefined, undefined);
  }
  for (const name of ["d3", "dagre", "ELK", "ARCHITECTURE_LIBRARY", "DiagramEngine"]) {
    if (!scope[name]) throw new Error(`headless engine: ${name} did not load from ${assets}`);
  }
  return scope.DiagramEngine;
}

// Hashes ignore line endings, so a checkout with CRLF and one with LF agree.
export function contentHash(...buffers) {
  const hash = createHash("sha256");
  for (const buffer of buffers) hash.update(buffer.toString("utf8").replace(/\r\n/g, "\n"), "utf8");
  return hash.digest("hex");
}

export function engineHash(assets = ASSETS) {
  return contentHash(...ENGINE_SOURCES.map(file => readFileSync(join(assets, file))));
}
