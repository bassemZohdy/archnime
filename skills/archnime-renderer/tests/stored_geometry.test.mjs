/* FEAT-038: stored geometry, without a browser.
 *
 * `store_geometry.mjs` computes every layout a click can reach; an engine created
 * from that geometry returns those layouts and places nothing. These tests hold:
 *
 *   - a stored layout is the computed layout, value for value, for every state;
 *   - the stored engine works with no dagre and no ELK, reroutes wires, checks a
 *     layout, and does not offer Tune;
 *   - a state that was not stored throws instead of falling back to layout;
 *   - the state limit and multi-view bundles fail with a message;
 *   - the model hash the builder checks ignores line endings and changes with content.
 *
 * The page-level comparison is tests/stored_geometry_check.mjs.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contentHash, loadHeadlessEngine } from "../scripts/headless_engine.mjs";
import { GEOMETRY_FORMAT, computeGeometry } from "../scripts/store_geometry.mjs";

const FIXTURES = resolve(fileURLToPath(new URL(".", import.meta.url)), "fixtures");
const fixture = name => join(FIXTURES, `${name}.json`);
const read = name => JSON.parse(readFileSync(fixture(name), "utf8"));

test("FEAT-038 a stored layout equals the computed layout for every reachable state", async () => {
  const model = read("deep-nested-crosscut"), { geometry, findings } = await computeGeometry(fixture("deep-nested-crosscut"));
  assert.equal(geometry.format, GEOMETRY_FORMAT);
  assert.deepEqual(findings, []);
  // transactionPlatform holds edgePolicy and durableData: collapsed, platform alone, and platform with either or both children.
  assert.deepEqual(Object.keys(geometry.states["collapse-stress"]).sort(), ["", "durableData,transactionPlatform", "edgePolicy,durableData,transactionPlatform".split(",").sort().join(","), "edgePolicy,transactionPlatform", "transactionPlatform"].sort());

  const DiagramEngine = loadHeadlessEngine(), computing = DiagramEngine.create(model);
  await computing.ready;
  // No layout library at all: the stored engine must not need one.
  const stored = DiagramEngine.create(model, { geometry, dagre: null, elk: null });
  await stored.ready;
  assert.equal(stored.stored, true);
  assert.equal(computing.stored, false);
  const stage = stored.model.stages[0];
  const fresh = await DiagramEngine.create(model).collectGeometry();
  for (const [key, index] of Object.entries(geometry.states[stage.id])) {
    const expanded = new Set(key ? key.split(",") : []);
    assert.deepEqual(DiagramEngine.packLayout(stored.layoutStage(stage, false, expanded)), fresh.layouts[fresh.states[stage.id][key]], `state "${key}"`);
    assert.deepEqual([...stored.layoutStage(stage, false, expanded).expanded].sort(), [...expanded].sort());
    assert.ok(geometry.layouts[index]);
  }
  // The state the page opens on is the one a plain layoutStage(stage) returns.
  assert.deepEqual(DiagramEngine.packLayout(stored.layoutStage(stage)), DiagramEngine.packLayout(computing.layoutStage(stage)));
});

test("FEAT-038 the stored engine reroutes, checks and does not tune", async () => {
  const model = read("orthogonal-routing"), { geometry } = await computeGeometry(fixture("orthogonal-routing"));
  const DiagramEngine = loadHeadlessEngine();
  const stored = DiagramEngine.create(model, { geometry, dagre: null, elk: null }), computing = DiagramEngine.create(model);
  await computing.ready;
  assert.equal(computing.usesElk, true, "this fixture is laid out by ELK");
  assert.equal(stored.tuneAvailable, false);
  await assert.rejects(stored.retryElk(stored.model.stages[0]), /when the diagram is built/);
  const stage = stored.model.stages[0], before = DiagramEngine.packLayout(stored.layoutStage(stage));
  for (const mode of ["orthogonal", "direct", "curved"]) {
    stored.setRouting(mode); computing.setRouting(mode);
    const layout = stored.layoutStage(stage);
    assert.deepEqual([...new Set(layout.wires.filter(wire => wire.visible !== false && wire.geom).map(wire => wire.requestedRouting))], [mode]);
    assert.deepEqual(DiagramEngine.packLayout(layout), DiagramEngine.packLayout(computing.layoutStage(stage)), `wires ${mode}`);
    assert.deepEqual(layout.nodes.map(node => [node.id, node.x, node.y]), before.nodes.map(node => [node.id, node.x, node.y]), "rerouting moved a node");
  }
  assert.deepEqual(stored.checkLayout(stage, stored.layoutStage(stage)), computing.checkLayout(stage, computing.layoutStage(stage)));
  assert.deepEqual(stored.selfCheck(), []);
});

test("FEAT-038 a state with no stored layout throws instead of laying out", async () => {
  const model = read("deep-nested-crosscut"), { geometry } = await computeGeometry(fixture("deep-nested-crosscut"));
  const DiagramEngine = loadHeadlessEngine(), stage = model.stages[0];
  const partial = { states: { [stage.id]: { "": geometry.states[stage.id][""] } }, layouts: geometry.layouts };
  const stored = DiagramEngine.create(model, { geometry: partial });
  assert.doesNotThrow(() => stored.layoutStage(stored.model.stages[0], false, new Set()));
  assert.throws(() => stored.layoutStage(stored.model.stages[0], false, new Set(["transactionPlatform"])), /No stored geometry for stage "collapse-stress" with package\(s\) transactionPlatform expanded.*store_geometry\.mjs/s);
  assert.throws(() => stored.layoutStage(stored.model.stages[0]), /No stored geometry/);
  await assert.rejects(stored.collectGeometry(), /computes layout/);
});

test("FEAT-038 the state limit and multi-view bundles fail with a message", async () => {
  await assert.rejects(computeGeometry(fixture("deep-nested-crosscut"), { maxStatesPerStage: 3 }), /more than 3 package expansion states/);
  await assert.rejects(computeGeometry(fixture("commerce-views")), /multi-view bundles/);
});

test("FEAT-038 the model hash ignores line endings and follows content", async () => {
  const text = readFileSync(fixture("checkout-flow"), "utf8").replace(/\r\n/g, "\n");
  assert.equal(contentHash(Buffer.from(text)), contentHash(Buffer.from(text.replace(/\n/g, "\r\n"))));
  assert.notEqual(contentHash(Buffer.from(text)), contentHash(Buffer.from(text.replace("Checkout", "Check-out"))));
  const work = mkdtempSync(join(tmpdir(), "stored-geometry-hash-"));
  try {
    const copy = join(work, "model.json");
    writeFileSync(copy, text.replace(/\n/g, "\r\n"));
    assert.equal((await computeGeometry(copy)).geometry.modelSha256, (await computeGeometry(fixture("checkout-flow"))).geometry.modelSha256);
  } finally { rmSync(work, { recursive: true, force: true }); }
});
