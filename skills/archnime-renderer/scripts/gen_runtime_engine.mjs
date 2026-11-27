#!/usr/bin/env node
/* Generate assets/diagram-runtime.js, the engine a delivered page loads, from
 * assets/diagram-engine.js, the whole engine.
 *
 *   node gen_runtime_engine.mjs           write the runtime file
 *   node gen_runtime_engine.mjs --check   fail when the committed file is out of date
 *
 * A delivered page shows layouts that were computed when it was built. It
 * reroutes wires and checks a layout, and it places nothing, so it should carry
 * no code that does. The runtime file is the engine with that code taken out:
 *
 *   1. everything between `@placement:begin` and `@placement:end` is dropped,
 *      and a `// @runtime: code` comment becomes `code`;
 *   2. inside `create()`, every function that nothing left refers to is dropped,
 *      found by following references from the code that is not in a function;
 *   3. the result must parse, and must not mention a function that was dropped.
 *
 * Step 2 keeps a function when its name appears anywhere in kept code, so it can
 * keep one too many but never one too few. The generated file is checked in: the
 * skill has no build step for whoever installs it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS = resolve(dirname(fileURLToPath(import.meta.url)), "../assets");
export const SOURCE = join(ASSETS, "diagram-engine.js"), TARGET = join(ASSETS, "diagram-runtime.js");
const BEGIN = "/* @placement:begin */", END = "/* @placement:end */", RUNTIME = /^(\s*)\/\/ @runtime: (.*)$/;
const HEADER = `/* Architecture Diagram Engine, runtime part: stored layouts, wire rerouting, layout check.
 *
 * GENERATED from diagram-engine.js by scripts/gen_runtime_engine.mjs. Do not edit:
 * change diagram-engine.js and run \`node scripts/gen_runtime_engine.mjs\`.
 *
 * This is what a delivered page loads. It needs \`window.d3\` and nothing else: it
 * places no node, so it has no dagre, no ELK, no force layout and no Tune search.
 * \`DiagramEngine.create(model, { geometry })\` returns the layouts computed when
 * the page was built (scripts/store_geometry.mjs) and throws without them.
 */`;

export function generateRuntime(source) {
  const input = source.replace(/\r\n/g, "\n").split("\n");
  // 1. markers
  const lines = [], droppedState = [];
  let dropping = false;
  input.forEach((line, index) => {
    if (line.trim() === BEGIN) { if (dropping) throw new Error(`line ${index + 1}: ${BEGIN} inside a placement region`); dropping = true; return; }
    if (line.trim() === END) { if (!dropping) throw new Error(`line ${index + 1}: ${END} without ${BEGIN}`); dropping = false; return; }
    if (dropping) { droppedState.push(line); return; }
    const runtime = RUNTIME.exec(line);
    lines.push(runtime ? `${runtime[1]}${runtime[2]}` : line);
  });
  if (dropping) throw new Error(`${BEGIN} is never closed`);

  // 2. functions declared directly in create()
  const start = lines.findIndex(line => line.startsWith("  function create(model, options) {")), end = lines.findIndex((line, index) => index > start && line === "  }");
  if (start < 0 || end < 0) throw new Error("create() not found");
  const functions = new Map();
  for (let index = start + 1; index < end; index += 1) {
    const match = /^    (?:async )?function ([A-Za-z0-9_$]+)\(/.exec(lines[index]);
    if (!match) continue;
    let last = index;
    const balanced = (lines[index].match(/{/g) || []).length === (lines[index].match(/}/g) || []).length && lines[index].trimEnd().endsWith("}");
    if (!balanced) { last = index + 1; while (last < end && lines[last] !== "    }") last += 1; if (last >= end) throw new Error(`function ${match[1]} has no closing line`); }
    // comment lines directly above belong to the function
    let first = index;
    while (first - 1 > start && /^    (\/\/|\/\*|\*)/.test(lines[first - 1]) && !lines[first - 1].includes("=====")) first -= 1;
    functions.set(match[1], { first, index, last, body: lines.slice(index, last + 1).join("\n") });
    index = last;
  }
  const names = [...functions.keys()];
  const mentions = (text, name) => new RegExp(`(?<![A-Za-z0-9_$.])${name.replace(/\$/g, "\\$")}(?![A-Za-z0-9_$])`).test(text);
  const owned = new Set();
  functions.forEach(({ index, last }) => { for (let line = index; line <= last; line += 1) owned.add(line); });
  const outside = lines.filter((_, index) => index > start && index < end && !owned.has(index)).join("\n");
  const kept = new Set(), queue = names.filter(name => mentions(outside, name));
  while (queue.length) {
    const name = queue.pop();
    if (kept.has(name)) continue;
    kept.add(name);
    const own = functions.get(name).body.replace(new RegExp(`function ${name.replace(/\$/g, "\\$")}\\(`), "function (");
    names.filter(other => !kept.has(other) && mentions(own, other)).forEach(other => queue.push(other));
  }
  const dropped = names.filter(name => !kept.has(name)), remove = new Set();
  dropped.forEach(name => { const { first, last } = functions.get(name); for (let line = first; line <= last; line += 1) remove.add(line); });
  let body = lines.filter((_, index) => !remove.has(index)).join("\n").replace(/\n{3,}/g, "\n\n");

  // header: the first block comment of the source is replaced
  const headerEnd = body.indexOf("*/");
  if (!body.startsWith("/*") || headerEnd < 0) throw new Error("source does not start with a header comment");
  body = HEADER + body.slice(headerEnd + 2);

  // 3. checks
  try { new Function(body); } catch (error) { throw new Error(`the generated runtime does not parse: ${error.message}`); }
  const code = body.slice(HEADER.length), dangling = dropped.filter(name => mentions(code, name));
  if (dangling.length) throw new Error(`the runtime still refers to dropped function(s): ${dangling.join(", ")}`);
  // State declared at the top of create() inside a dropped region must not be used by what is left.
  const state = new Set();
  droppedState.forEach(line => {
    if (!/^    (const|let) /.test(line)) return;
    for (const match of line.matchAll(/(?:^    (?:const|let) |, )([A-Za-z_$][\w$]*) = /g)) state.add(match[1]);
  });
  const declaredInRuntime = name => new RegExp(`(?:const|let|var|function)\\s[^;\\n]*(?<![A-Za-z0-9_$.])${name}(?![A-Za-z0-9_$])`).test(code);
  const orphans = [...state].filter(name => mentions(code, name) && !declaredInRuntime(name));
  if (orphans.length) throw new Error(`the runtime uses state that was dropped with the placement code: ${orphans.join(", ")}`);
  // Names that only placement uses. Any left means a region still needs a marker.
  const PLACEMENT_ONLY = ["dagre", "elkSource", "computeLayout", "retryElk", "collectGeometry", "ELK_RETRY_VARIANTS", "TUNE_STRATEGIES", "tunedLayouts", "elkPositionCache"];
  const where = word => code.split("\n").filter(line => mentions(line, word) && !/^\s*(\/\/|\*)/.test(line)).map(line => line.trim().slice(0, 110));
  const leftovers = PLACEMENT_ONLY.flatMap(word => where(word).map(line => `${word}: ${line}`));
  if (leftovers.length) throw new Error(`the runtime still has placement code; mark it as placement:\n  ${leftovers.join("\n  ")}`);
  return { text: `${body.replace(/\n+$/, "")}\n`, kept: [...kept], dropped };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const source = readFileSync(SOURCE, "utf8");
  let result;
  try { result = generateRuntime(source); } catch (error) { console.error(`gen_runtime_engine: ${error.message}`); process.exit(2); }
  const sizes = `${(Buffer.byteLength(result.text) / 1024).toFixed(0)} KB from ${(Buffer.byteLength(source.replace(/\r\n/g, "\n")) / 1024).toFixed(0)} KB; ${result.kept.length} functions kept, ${result.dropped.length} dropped`;
  if (process.argv.includes("--check")) {
    let current = "";
    try { current = readFileSync(TARGET, "utf8").replace(/\r\n/g, "\n"); } catch {}
    if (current !== result.text) { console.error("diagram-runtime.js is out of date: run node skills/archnime-renderer/scripts/gen_runtime_engine.mjs"); process.exit(1); }
    console.log(`diagram-runtime.js is up to date (${sizes})`);
  } else {
    writeFileSync(TARGET, result.text);
    console.log(`wrote ${TARGET} (${sizes})`);
    if (process.argv.includes("--list")) console.log(`dropped: ${result.dropped.join(" ")}`);
  }
}
