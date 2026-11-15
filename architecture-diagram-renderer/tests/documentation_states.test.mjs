/* TASK-001.3: the documentation export captures the selected state, nothing else.
 *
 * Whatever stage, scenario variant, flow step or view the presenter is showing is what the
 * toolbar's "SVG (documentation)" must write: the same node and boundary ids the presenter
 * shows, the active flow wires of the selected step, a file name that carries the selected
 * number, and never an id that belongs only to a state that is not selected.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { join } from "node:path";
import { EXAMPLES, FIXTURES, browserSkip, openDiagram } from "./doc_export_harness.mjs";

const skip = browserSkip();
const readModel = path => JSON.parse(readFileSync(path, "utf8"));
const entryId = entry => typeof entry === "string" ? entry : entry?.id;

/** Ids a stage is entitled to show: its declared nodes plus everything inside a declared package. */
function entitled(stage, packages) {
  const ids = new Set();
  const add = id => {
    if (ids.has(id)) return;
    ids.add(id);
    (packages[id]?.children || []).forEach(add);
  };
  (stage.nodes || []).map(entryId).forEach(add);
  return ids;
}

/** Click the n-th selector button in the page and wait until the presenter says it is selected. */
async function select(page, selector, index, count) {
  await page.evaluate(([css, position]) => document.querySelectorAll(css)[position].dispatchEvent(new MouseEvent("click", { bubbles: true })), [selector, index]);
  await page.waitForFunction(([position, total]) => {
    const text = document.getElementById("stage-indicator")?.textContent || "";
    return text.includes(`${position} / ${total}`);
  }, [index + 1, count], { timeout: 15000 });
  await page.waitForTimeout(120);
}

/** What the presenter shows right now, and what the toolbar export writes for it. */
async function presenterAndExport(page) {
  const live = await page.evaluate(() => ({
    nodes: [...document.querySelectorAll("#diagram g.node")].map(node => node.getAttribute("data-id")).sort(),
    boundaries: [...document.querySelectorAll("#diagram g.boundary")].map(node => node.getAttribute("data-id")).sort(),
    activeWires: [...document.querySelectorAll("#diagram g.wire.flow-active")].map(wire => wire.getAttribute("data-wire-key")).sort(),
    signature: [...document.querySelectorAll("#diagram g.node"), ...document.querySelectorAll("#diagram g.package-outline")].map(node => `${node.getAttribute("class").split(" ")[0]}:${node.getAttribute("data-id") || ""}|${node.getAttribute("class")}|${(node.textContent || "").replace(/\s+/g, " ").trim()}`).sort(),
  }));
  const downloaded = page.waitForEvent("download", { timeout: 15000 });
  await page.evaluate(() => document.getElementById("btn-export-documentation-svg").click());
  const download = await downloaded;
  const { readFileSync: read } = await import("node:fs");
  const svg = read(await download.path(), "utf8");
  const exported = await page.evaluate(markup => {
    const host = document.createElement("div");
    host.innerHTML = markup;
    const root = host.querySelector("svg");
    return {
      nodes: [...root.querySelectorAll("g.node")].map(node => node.getAttribute("data-id")).sort(),
      boundaries: [...root.querySelectorAll("g.boundary")].map(node => node.getAttribute("data-id")).sort(),
      activeWires: [...root.querySelectorAll("g.wire.flow-active")].map(wire => wire.getAttribute("data-wire-key")).sort(),
      signature: [...root.querySelectorAll("g.node"), ...root.querySelectorAll("g.package-outline")].map(node => `${node.getAttribute("class").split(" ")[0]}:${node.getAttribute("data-id") || ""}|${node.getAttribute("class")}|${(node.textContent || "").replace(/\s+/g, " ").trim()}`).sort(),
    };
  }, svg);
  return { live, exported, filename: download.suggestedFilename() };
}

/** Migration stages and scenario variants share one shape: a list of stages chosen from the pills. */
for (const [label, modelPath] of [
  ["migration stages", join(EXAMPLES, "portable-transition-model.json")],
  ["scenario variants", join(FIXTURES, "orders-failover-scenarios.json")],
]) {
  test(`${label}: each selected stage exports exactly its own nodes`, { skip }, async () => {
    const model = readModel(modelPath), packages = model.packages || {}, stages = model.stages;
    assert.ok(stages.length >= 2, "the model should have at least two stages");
    const diagram = await openDiagram(modelPath);
    try {
      const { page } = diagram;
      for (let index = 0; index < stages.length; index += 1) {
        await select(page, "#pills button", index, stages.length);
        const { live, exported, filename } = await presenterAndExport(page);
        const where = `stage ${index + 1} (${stages[index].id})`;
        assert.match(filename, new RegExp(`-stage-${index + 1}-documentation\\.svg$`), `${where}: the file name does not carry the selected stage`);
        assert.ok(exported.nodes.length >= 2, `${where}: the export shows fewer than two nodes`);
        assert.deepEqual(exported.nodes, live.nodes, `${where}: exported nodes differ from what the presenter shows`);
        assert.deepEqual(exported.boundaries, live.boundaries, `${where}: exported boundaries differ from what the presenter shows`);
        assert.deepEqual(exported.signature, live.signature, `${where}: exported node kinds or labels differ from what the presenter shows`);

        const allowed = entitled(stages[index], packages);
        const invented = exported.nodes.filter(id => !allowed.has(id));
        assert.deepEqual(invented, [], `${where}: the export contains ids the stage does not declare`);
        const otherOnly = new Set();
        stages.forEach((other, otherIndex) => { if (otherIndex !== index) entitled(other, packages).forEach(id => { if (!allowed.has(id)) otherOnly.add(id); }); });
        assert.deepEqual(exported.nodes.filter(id => otherOnly.has(id)), [], `${where}: the export contains ids that only other stages declare`);
      }
      // At least one stage must differ from another, or the comparison above proves nothing.
      const shown = [];
      for (let index = 0; index < stages.length; index += 1) { await select(page, "#pills button", index, stages.length); const { exported } = await presenterAndExport(page); shown.push(`${exported.signature.join("\n")}\n#${exported.boundaries.join(",")}`); }
      assert.ok(new Set(shown).size > 1, "every stage exported identical nodes, kinds and labels, so selection was not exercised");
    } finally { await diagram.close(); }
  });
}

test("a package the user collapsed in one stage is exported collapsed there and expanded in the others", { skip }, async () => {
  const modelPath = join(FIXTURES, "stage-scoped-collapse.json");
  const diagram = await openDiagram(modelPath);
  try {
    const { page } = diagram;
    const stages = 3, inside = ["edge", "api", "worker"];
    await select(page, "#pills button", 1, stages);
    const expanded = await presenterAndExport(page);
    for (const id of inside) assert.ok(expanded.exported.nodes.includes(id), `${id} should be drawn while its package is expanded`);
    assert.ok(!expanded.exported.nodes.includes("runtime"), "the expanded package should not also be drawn as a block");

    // Collapse the package the way a user does: through its outline's button.
    await page.evaluate(() => [...document.querySelectorAll("#diagram g.package-hit")].find(hit => /^Collapse Application runtime/.test(hit.getAttribute("aria-label"))).dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await page.waitForTimeout(250);
    const collapsed = await presenterAndExport(page);
    assert.deepEqual(collapsed.exported.nodes, collapsed.live.nodes, "the export does not match the collapsed presenter state");
    assert.ok(collapsed.exported.nodes.includes("runtime"), "the collapsed package should be exported as one block");
    for (const id of inside) assert.ok(!collapsed.exported.nodes.includes(id), `${id} is hidden in the presenter, so it must not be exported`);
    assert.notDeepEqual(collapsed.exported.signature, expanded.exported.signature);

    // Stage-scoped: the other stage keeps its own visibility, and so does its export.
    await select(page, "#pills button", 0, stages);
    const other = await presenterAndExport(page);
    assert.deepEqual(other.exported.nodes, other.live.nodes);
    for (const id of inside) assert.ok(other.exported.nodes.includes(id), `${id} should still be exported in the stage where the package stays expanded`);
  } finally { await diagram.close(); }
});

test("flow steps: the topology is complete at every step and the selected step's wires are active", { skip }, async () => {
  const modelPath = join(FIXTURES, "checkout-flow.json");
  const model = readModel(modelPath), declared = (model.flow.nodes || []).map(entryId).sort();
  const diagram = await openDiagram(modelPath);
  try {
    const { page } = diagram;
    const count = await page.evaluate(() => document.querySelectorAll("#flow-timeline button").length);
    assert.ok(count >= 3, "the flow should expose a timeline of steps");
    const activeByStep = [];
    for (let index = 0; index < count; index += 1) {
      await select(page, "#flow-timeline button", index, count);
      const { live, exported, filename } = await presenterAndExport(page);
      const where = `step ${index + 1}`;
      assert.match(filename, new RegExp(`-stage-${index + 1}-documentation\\.svg$`), `${where}: the file name does not carry the selected step`);
      assert.deepEqual(exported.nodes, live.nodes, `${where}: exported nodes differ from what the presenter shows`);
      assert.deepEqual(exported.nodes, declared, `${where}: the flow topology is incomplete or has invented nodes`);
      assert.deepEqual(exported.activeWires, live.activeWires, `${where}: exported active wires differ from the presenter's`);
      if (!/^Flow overview/.test(await page.textContent("#stage-indicator").catch(() => "")) && index > 0) assert.ok(exported.activeWires.length >= 1, `${where}: no wire is active in the export`);
      activeByStep.push(exported.activeWires.join("|"));
    }
    assert.ok(new Set(activeByStep).size > 1, "every step exported the same active wires, so the selected step was not captured");
  } finally { await diagram.close(); }
});

test("bundle views: each selected view exports its own nodes and none that belong only to another view", { skip }, async () => {
  const modelPath = join(FIXTURES, "commerce-views.json");
  const bundle = readModel(modelPath), shared = { ...(bundle.shared?.packages || {}) };
  const declared = bundle.views.map(view => ({ id: view.viewId, entitled: entitled(view.stages[0], { ...shared, ...(view.packages || {}) }) }));
  assert.ok(declared.length >= 3, "the bundle should hold several views");
  const seen = [];
  for (const { id, entitled: allowed } of declared) {
    const diagram = await openDiagram(modelPath, { query: `?view=${id}` });
    try {
      const { page } = diagram;
      const { live, exported } = await presenterAndExport(page);
      assert.ok(exported.nodes.length >= 2, `view ${id}: the export shows fewer than two nodes`);
      assert.deepEqual(exported.nodes, live.nodes, `view ${id}: exported nodes differ from what the presenter shows`);
      assert.deepEqual(exported.nodes.filter(node => !allowed.has(node)), [], `view ${id}: the export contains ids the view does not declare`);
      const others = new Set(declared.filter(other => other.id !== id).flatMap(other => [...other.entitled]).filter(node => !allowed.has(node)));
      assert.deepEqual(exported.nodes.filter(node => others.has(node)), [], `view ${id}: the export contains ids that only other views declare`);
      seen.push(exported.nodes.join("|"));
    } finally { await diagram.close(); }
  }
  assert.ok(new Set(seen).size === declared.length, "views exported identical nodes, so view selection was not exercised");
});
