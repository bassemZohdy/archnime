/* TASK-039: the engine a delivered page loads.
 *
 * `diagram-runtime.js` is generated from `diagram-engine.js` by dropping everything
 * that places nodes (scripts/gen_runtime_engine.mjs). These tests hold that:
 *
 *   - the committed file is what the generator produces from the current engine;
 *   - it carries no placement code and needs no layout library to load;
 *   - without stored geometry it refuses to create an engine;
 *   - from the same stored geometry it gives exactly what the whole engine gives:
 *     every state, in each wire style, the layout check and the self-check, on
 *     every fixture and shipped example.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { SOURCE, TARGET, generateRuntime } from "../scripts/gen_runtime_engine.mjs";
import { loadHeadlessEngine } from "../scripts/headless_engine.mjs";
import { computeGeometry } from "../scripts/store_geometry.mjs";

const HERE = resolve(fileURLToPath(new URL(".", import.meta.url)));
const MODELS = [...readdirSync(join(HERE, "fixtures")).map(name => join(HERE, "fixtures", name)), ...readdirSync(resolve(HERE, "../assets/examples")).map(name => resolve(HERE, "../assets/examples", name))].filter(path => path.endsWith(".json"));

test("TASK-039 the committed runtime engine is the one generated from the engine", () => {
  const generated = generateRuntime(readFileSync(SOURCE, "utf8"));
  assert.equal(readFileSync(TARGET, "utf8").replace(/\r\n/g, "\n"), generated.text, "run node skills/archnime-renderer/scripts/gen_runtime_engine.mjs");
  assert.ok(generated.dropped.length >= 40, "the generator dropped suspiciously few functions");
  for (const placement of ["dagreLayout", "elkLayout", "forceLayout", "deploymentLayout", "computeLayout", "layoutStageOnce", "scoreLayout", "retryElk", "tuneLocally", "prepareElk", "collectGeometry"]) assert.ok(generated.dropped.includes(placement), `${placement} should not be in the runtime`);
  for (const needed of ["storedLayout", "rerouteLayout", "routeWires", "finalizeRoutes", "checkLayoutIssues", "storedSelfCheck", "expandedPackages", "resolveNodes"]) assert.ok(generated.kept.includes(needed), `${needed} must stay in the runtime`);
});

test("TASK-039 the runtime engine carries no placement code and no layout library", () => {
  const text = readFileSync(TARGET, "utf8");
  for (const word of ["dagre", "elkSource", "ELK_RETRY_VARIANTS", "TUNE_STRATEGIES", "forceSimulation", "@placement", "@runtime:"]) assert.ok(!new RegExp(`(?<![A-Za-z0-9_$.])${word}`).test(text.split("*/").slice(1).join("*/")), `the runtime mentions ${word}`);
  assert.ok(text.length < readFileSync(SOURCE, "utf8").replace(/\r\n/g, "\n").length * 0.7, "the runtime should be clearly smaller than the engine");
  const Runtime = loadHeadlessEngine(undefined, { runtime: true });
  assert.throws(() => Runtime.create(JSON.parse(readFileSync(join(HERE, "fixtures", "checkout-flow.json"), "utf8"))), /no stored geometry.*build_bundle\.py/s);
});

test("TASK-039 from the same geometry the runtime engine gives what the whole engine gives", async () => {
  let states = 0;
  for (const path of MODELS) {
    const model = JSON.parse(readFileSync(path, "utf8")), { geometry } = await computeGeometry(path);
    const Full = loadHeadlessEngine(), Runtime = loadHeadlessEngine(undefined, { runtime: true });
    const views = model.views ? model.views.map(view => [view, geometry.views[view.viewId]]) : [[model, geometry]];
    for (const [view, stored] of views) {
      const merged = Runtime.materializeView(model, view);
      assert.deepEqual(merged, Full.materializeView(model, view), path);
      const full = Full.create(Full.materializeView(model, view), { geometry: stored }), runtime = Runtime.create(merged, { geometry: stored, dagre: null, elk: null });
      await runtime.ready;
      assert.equal(runtime.stored, true);
      for (const name of ["collectGeometry", "retryElk", "prepareElk", "usesElk", "tuneAvailable", "elkAvailable"]) assert.ok(!(name in runtime), `the runtime engine exposes ${name}`);
      runtime.model.stages.forEach((stage, index) => {
        const twin = full.model.stages[index];
        for (const key of Object.keys(stored.states[stage.id])) {
          const expanded = new Set(key ? key.split(",") : []);
          for (const mode of ["curved", "orthogonal", "direct", "curved"]) {
            full.setRouting(mode); runtime.setRouting(mode);
            const expected = full.layoutStage(twin, false, expanded), actual = runtime.layoutStage(stage, false, expanded);
            assert.deepEqual(Runtime.packLayout(actual), Full.packLayout(expected), `${path} ${stage.id} [${key}] ${mode}`);
            assert.deepEqual(runtime.checkLayout(stage, actual), full.checkLayout(twin, expected), `${path} ${stage.id} [${key}] ${mode} check`);
          }
          states += 1;
        }
      });
      assert.deepEqual(runtime.selfCheck(), full.selfCheck(), `${path} self-check`);
      if (runtime.model.flow) assert.deepEqual(Runtime.packLayout(runtime.layoutFlow()), Full.packLayout(full.layoutFlow()));
      runtime.setPackageOverride(runtime.model.stages[0], "none", true); runtime.invalidateLayoutCache(); runtime.layoutDiagnostics();
    }
  }
  assert.ok(states >= 60, `only ${states} states were compared`);
});
