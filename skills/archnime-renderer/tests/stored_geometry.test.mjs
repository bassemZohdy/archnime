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

test("FEAT-038 the state limit fails with a message", async () => {
  await assert.rejects(computeGeometry(fixture("deep-nested-crosscut"), { maxStatesPerStage: 3 }), /more than 3 package expansion states/);
});

test("FEAT-038 a multi-view bundle stores one geometry per view, merged as the page merges it", async () => {
  const bundle = read("commerce-views"), { geometry, findings } = await computeGeometry(fixture("commerce-views"));
  assert.deepEqual(findings, []);
  assert.deepEqual(Object.keys(geometry.views), bundle.views.map(view => view.viewId));
  assert.equal(geometry.states, undefined);
  const DiagramEngine = loadHeadlessEngine();
  for (const view of bundle.views) {
    const merged = DiagramEngine.materializeView(bundle, view);
    // Shared catalog entries reach the view, and the view's own win.
    assert.ok(Object.keys(merged.catalog).length >= Object.keys(bundle.shared?.catalog || {}).length);
    const stored = DiagramEngine.create(merged, { geometry: geometry.views[view.viewId], dagre: null, elk: null }), computing = DiagramEngine.create(merged);
    await computing.ready;
    for (const stage of stored.model.stages) assert.deepEqual(DiagramEngine.packLayout(stored.layoutStage(stage)), DiagramEngine.packLayout(computing.layoutStage(stage)), `${view.viewId}/${stage.id}`);
  }
  // A view's geometry is not another view's.
  const [first, second] = bundle.views;
  const wrong = DiagramEngine.create(DiagramEngine.materializeView(bundle, first), { geometry: geometry.views[second.viewId] });
  assert.throws(() => wrong.layoutStage(wrong.model.stages[0]), /stored geometry/i);
});

test("FEAT-038 a stored layout whose nodes are not the model's is refused as stale", async () => {
  const model = read("orders-failover-scenarios"), { geometry } = await computeGeometry(fixture("orders-failover-scenarios"));
  const DiagramEngine = loadHeadlessEngine(), stage = model.stages[0];
  const changed = structuredClone(model), removed = changed.stages[0].nodes.pop(), removedId = typeof removed === "string" ? removed : removed.id;
  changed.stages[0].wires = changed.stages[0].wires.filter(wire => wire.from !== removedId && wire.to !== removedId);
  const stored = DiagramEngine.create(changed, { geometry });
  assert.throws(() => stored.layoutStage(stored.model.stages[0]), new RegExp(`Stored geometry for stage "${stage.id}" is stale`));
});

test("FEAT-038 --tune stores the result of the Tune search, reproducibly and no worse", async () => {
  const model = read("orthogonal-routing");
  const plain = await computeGeometry(fixture("orthogonal-routing")), tuned = await computeGeometry(fixture("orthogonal-routing"), { tune: true }), again = await computeGeometry(fixture("orthogonal-routing"), { tune: true });
  assert.equal(tuned.geometry.tuned, true);
  assert.equal(plain.geometry.tuned, undefined);
  assert.deepEqual(tuned.geometry, again.geometry, "two tuned runs differ");
  assert.deepEqual(Object.keys(tuned.geometry.states), Object.keys(plain.geometry.states));
  assert.ok(tuned.findings.length <= plain.findings.length);
  // Tune keeps the wire style and still yields a layout the stored engine accepts for every state.
  const DiagramEngine = loadHeadlessEngine(), stored = DiagramEngine.create(model, { geometry: tuned.geometry, dagre: null, elk: null });
  for (const stage of stored.model.stages) for (const key of Object.keys(tuned.geometry.states[stage.id])) {
    const layout = stored.layoutStage(stage, false, new Set(key ? key.split(",") : []));
    assert.equal(layout.routing, stored.routing);
    assert.ok(layout.nodes.length > 0);
  }
  // It changed something here: at least one state has a different layout from the untuned one.
  assert.ok(tuned.tuned.length > 0, "the search improved no state of this fixture, so the test proves nothing");
  assert.notDeepEqual(tuned.geometry.layouts, plain.geometry.layouts);
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
