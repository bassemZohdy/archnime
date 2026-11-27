#!/usr/bin/env node
/* Compute a model's layout at build time and write it as a geometry file.
 *
 *   node store_geometry.mjs model.json [--output model.geometry.json]
 *                           [--tune [strategy]] [--max-states 64] [--allow-findings]
 *
 * Lays out every stage in every package expansion state a click can reach, runs
 * the self-check, and writes one JSON file that `build_bundle.py --geometry`
 * embeds in the page and the `<architecture-diagram>` element accepts. A page
 * built that way loads neither dagre nor ELK and computes no placement: it shows
 * the stored layouts. A multi-view bundle gets one geometry per view.
 *
 * `--tune` runs, for every state, the search the page's Tune layout button ran
 * (placement variants, seeds and strategies, keeping the wire style) and stores
 * the best layout found. It is slower; the result is as reproducible as the rest.
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

export async function computeGeometry(modelPath, { maxStatesPerStage = 64, tune = false } = {}) {
  const bytes = readFileSync(modelPath), model = JSON.parse(bytes.toString("utf8"));
  const DiagramEngine = loadHeadlessEngine(), findings = [], tuned = [];
  // One engine per view, on the view merged the way the page merges it.
  const one = async (view, label) => {
    const merged = DiagramEngine.materializeView(model, view);
    const collected = await DiagramEngine.create(merged).collectGeometry({ maxStatesPerStage, tune });
    const stored = { states: collected.states, layouts: collected.layouts };
    // The findings are those of the page: the same check, on the stored layouts.
    DiagramEngine.create(merged, { geometry: stored }).selfCheck().forEach(issue => findings.push(label ? { ...issue, detail: `view ${label}: ${issue.detail}` } : issue));
    (collected.tuned || []).forEach(key => tuned.push(label ? `${label}|${key}` : key));
    return stored;
  };
  const header = { format: GEOMETRY_FORMAT, modelSha256: contentHash(bytes), engineSha256: engineHash(), ...(tune ? { tuned: true } : {}) };
  if (Array.isArray(model.views)) {
    const views = {};
    for (const view of model.views) {
      if (typeof view.viewId !== "string" || views[view.viewId]) throw new Error(`every view needs its own viewId to store geometry; found ${JSON.stringify(view.viewId)}`);
      views[view.viewId] = await one(view, view.viewId);
    }
    return { geometry: { ...header, views }, findings, tuned };
  }
  return { geometry: { ...header, ...(await one(model, "")) }, findings, tuned };
}

// Every { states, layouts } a geometry holds: one for a plain model, one per view for a bundle.
export const geometryParts = geometry => geometry.views ? Object.values(geometry.views) : [geometry];

async function main(argv) {
  const args = argv.slice(2), value = name => { const index = args.indexOf(name); return index > -1 ? args.splice(index, 2)[1] : undefined; };
  const flag = name => { const index = args.indexOf(name); if (index > -1) args.splice(index, 1); return index > -1; };
  const output = value("--output"), maxStates = value("--max-states"), allowFindings = flag("--allow-findings");
  let tune = false;
  const tuneIndex = args.indexOf("--tune");
  if (tuneIndex > -1) { const next = args[tuneIndex + 1]; tune = next && !next.startsWith("--") && !/\.json$/i.test(next) ? args.splice(tuneIndex, 2)[1] : (args.splice(tuneIndex, 1), true); }
  if (args.length !== 1 || args[0].startsWith("--")) {
    console.error("usage: node store_geometry.mjs model.json [--output model.geometry.json] [--tune [strategy]] [--max-states 64] [--allow-findings]");
    return 2;
  }
  const modelPath = resolve(args[0]), target = resolve(output || modelPath.replace(/\.json$/i, "") + ".geometry.json");
  const started = performance.now();
  let result;
  try { result = await computeGeometry(modelPath, { maxStatesPerStage: maxStates ? Number(maxStates) : 64, tune }); }
  catch (error) { console.error(`geometry failed: ${error.message || error}`); return 2; }
  const { geometry, findings, tuned } = result;
  findings.forEach(issue => console.error(`self-check ${issue.type}: ${issue.detail}`));
  if (findings.length && !allowFindings) {
    console.error(`geometry not written: ${findings.length} self-check finding(s). Fix the model, or pass --allow-findings to store it as it is.`);
    return 1;
  }
  const text = `${JSON.stringify(geometry)}\n`, parts = geometryParts(geometry);
  const stateCount = parts.reduce((sum, part) => sum + Object.values(part.states).reduce((count, stage) => count + Object.keys(stage).length, 0), 0);
  const layoutCount = parts.reduce((sum, part) => sum + part.layouts.length, 0), stageCount = parts.reduce((sum, part) => sum + Object.keys(part.states).length, 0);
  writeFileSync(target, text);
  console.log(`stored ${stateCount} state(s) as ${layoutCount} layout(s) for ${stageCount} stage(s)${geometry.views ? ` in ${parts.length} view(s)` : ""} in ${target} (${(Buffer.byteLength(text) / 1024).toFixed(1)} KB, ${((performance.now() - started) / 1000).toFixed(1)} s${tune ? `, tune improved ${tuned.length} state(s)` : ""}${findings.length ? `, ${findings.length} self-check finding(s) allowed` : ""})`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exit(await main(process.argv));
