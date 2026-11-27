#!/usr/bin/env node
/* Compute a model's layout at build time and write it as a geometry file.
 *
 *   node store_geometry.mjs model.json [--output model.geometry.json]
 *                           [--max-states 64] [--allow-findings]
 *
 * Lays out every stage in every package expansion state a click can reach, runs
 * the self-check, and writes one JSON file that `build_bundle.py --geometry`
 * embeds in the page. A page built that way loads neither dagre nor ELK and
 * computes no placement: it shows the stored layouts.
 *
 * The file records a hash of the model and a hash of the engine. The builder
 * refuses a geometry whose hashes do not match the model and engine it is given,
 * so a stored layout can never be shown for a model it was not computed from.
 * Geometry is derived: never edit it, run this again.
 *
 * Exit codes: 0 written; 1 self-check findings (pass --allow-findings to write
 * anyway); 2 the model cannot be laid out or the arguments are wrong.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { contentHash, engineHash, loadHeadlessEngine } from "./headless_engine.mjs";

export const GEOMETRY_FORMAT = "archnime-geometry/1";

export async function computeGeometry(modelPath, { maxStatesPerStage = 64 } = {}) {
  const bytes = readFileSync(modelPath), model = JSON.parse(bytes.toString("utf8"));
  if (Array.isArray(model.views)) throw new Error("stored geometry does not cover multi-view bundles yet: build this model without --geometry");
  const DiagramEngine = loadHeadlessEngine(), engine = DiagramEngine.create(model);
  const { states, layouts } = await engine.collectGeometry({ maxStatesPerStage });
  // The findings are those of the page: the same check, on the stored layouts.
  const findings = DiagramEngine.create(model, { geometry: { states, layouts } }).selfCheck();
  return { geometry: { format: GEOMETRY_FORMAT, modelSha256: contentHash(bytes), engineSha256: engineHash(), states, layouts }, findings };
}

async function main(argv) {
  const args = argv.slice(2), value = name => { const index = args.indexOf(name); return index > -1 ? args.splice(index, 2)[1] : undefined; };
  const flag = name => { const index = args.indexOf(name); if (index > -1) args.splice(index, 1); return index > -1; };
  const output = value("--output"), maxStates = value("--max-states"), allowFindings = flag("--allow-findings");
  if (args.length !== 1 || args[0].startsWith("--")) {
    console.error("usage: node store_geometry.mjs model.json [--output model.geometry.json] [--max-states 64] [--allow-findings]");
    return 2;
  }
  const modelPath = resolve(args[0]), target = resolve(output || modelPath.replace(/\.json$/i, "") + ".geometry.json");
  const started = performance.now();
  let result;
  try { result = await computeGeometry(modelPath, { maxStatesPerStage: maxStates ? Number(maxStates) : 64 }); }
  catch (error) { console.error(`geometry failed: ${error.message || error}`); return 2; }
  const { geometry, findings } = result;
  findings.forEach(issue => console.error(`self-check ${issue.type}: ${issue.detail}`));
  if (findings.length && !allowFindings) {
    console.error(`geometry not written: ${findings.length} self-check finding(s). Fix the model, or pass --allow-findings to store it as it is.`);
    return 1;
  }
  const text = `${JSON.stringify(geometry)}\n`, stateCount = Object.values(geometry.states).reduce((sum, stage) => sum + Object.keys(stage).length, 0);
  writeFileSync(target, text);
  console.log(`stored ${stateCount} state(s) as ${geometry.layouts.length} layout(s) for ${Object.keys(geometry.states).length} stage(s) in ${target} (${(Buffer.byteLength(text) / 1024).toFixed(1)} KB, ${((performance.now() - started) / 1000).toFixed(1)} s${findings.length ? `, ${findings.length} self-check finding(s) allowed` : ""})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv));
