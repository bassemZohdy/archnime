/* FEAT-002.1: batch snapshot export.
 *
 * Every requested architecture state (migration stage, scenario variant, flow step, bundle
 * view) is written exactly once, under a stable name, as the SVG the toolbar would export.
 */
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportSnapshots } from "../scripts/export_snapshots.mjs";
import { EXAMPLES, FIXTURES, browserSkip, chromium } from "./doc_export_harness.mjs";

const skip = browserSkip();
const nodeIds = svg => [...svg.matchAll(/<g\b[^>]*\bclass="node[^"]*"[^>]*>/g)].map(match => /data-id="([^"]+)"/.exec(match[0])?.[1]).filter(Boolean).sort();
const activeWires = svg => [...svg.matchAll(/<g\b[^>]*\bclass="wire[^"]*flow-active[^"]*"[^>]*>/g)].map(match => /data-wire-key="([^"]+)"/.exec(match[0])?.[1]).filter(Boolean).sort();

async function exportTo(modelPath, options = {}) {
  const outDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
  try {
    const { files } = await exportSnapshots({ modelPath, outDir, chromium, ...options });
    const onDisk = readdirSync(outDir).filter(name => name.endsWith(".svg")).sort();
    return { files, onDisk, read: name => readFileSync(join(outDir, name), "utf8"), cleanup: () => rmSync(outDir, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(outDir, { recursive: true, force: true });
    throw error;
  }
}

test("migration stages: one named snapshot per stage, each exactly once", { skip }, async () => {
  const result = await exportTo(join(EXAMPLES, "portable-transition-model.json"));
  try {
    assert.deepEqual(result.files.map(entry => entry.file), ["orders-extraction--01-current.svg", "orders-extraction--02-target.svg"]);
    assert.deepEqual(result.onDisk, result.files.map(entry => entry.file).sort(), "the output directory holds files the export did not report");
    assert.equal(new Set(result.onDisk).size, result.onDisk.length);
    const [current, target] = result.files.map(entry => nodeIds(result.read(entry.file)));
    assert.ok(current.length >= 2 && target.length > current.length, `the target stage should show more nodes than the current one (${current.length} vs ${target.length})`);
    result.files.forEach(entry => assert.match(result.read(entry.file), /^<svg\b/, `${entry.file} is not an SVG document`));
  } finally { result.cleanup(); }
});

test("scenario variants: every variant is exported", { skip }, async () => {
  const result = await exportTo(join(FIXTURES, "orders-failover-scenarios.json"));
  try {
    assert.deepEqual(result.files.map(entry => `${String(entry.index).padStart(2, "0")}-${entry.id}`), ["01-base", "02-primary-down", "03-region-down"]);
    assert.equal(new Set(result.files.map(entry => result.read(entry.file))).size, 3, "the variants should export different drawings");
  } finally { result.cleanup(); }
});

test("flow steps: every step is exported with the full topology and its own active wires", { skip }, async () => {
  const model = JSON.parse(readFileSync(join(FIXTURES, "checkout-flow.json"), "utf8"));
  const result = await exportTo(join(FIXTURES, "checkout-flow.json"));
  try {
    assert.equal(result.files.length, model.flow.steps.length);
    const topology = new Set(result.files.map(entry => nodeIds(result.read(entry.file)).join("|")));
    assert.equal(topology.size, 1, "the flow topology should be identical in every step");
    assert.equal(topology.values().next().value.split("|").length, model.flow.nodes.length);
    const active = new Set(result.files.map(entry => activeWires(result.read(entry.file)).join("|")));
    assert.ok(active.size > 1, "every step exported the same active wires");
    assert.match(result.files[0].file, /^checkout-request-walkthrough--01-/);
  } finally { result.cleanup(); }
});

test("bundle views: each view is exported under its own name and selection is honoured", { skip }, async () => {
  const all = await exportTo(join(FIXTURES, "commerce-views.json"));
  try {
    // The checkout view is a two-step flow, so it contributes two snapshots; the others one each.
    assert.deepEqual(all.files.map(entry => `${entry.view}:${entry.index}`), ["context:1", "production:1", "checkout:1", "checkout:2"]);
    assert.ok(all.files.every(entry => entry.file.includes(`--${entry.view}--`)), "view names should appear in the file names");
    const firstOfEachView = ["context", "production", "checkout"].map(view => all.files.find(entry => entry.view === view));
    assert.equal(new Set(firstOfEachView.map(entry => nodeIds(all.read(entry.file)).join("|"))).size, 3, "each view should show its own nodes");
  } finally { all.cleanup(); }

  const subset = await exportTo(join(FIXTURES, "commerce-views.json"), { views: ["production"] });
  try { assert.deepEqual(subset.files.map(entry => entry.view), ["production"]); } finally { subset.cleanup(); }

  const picked = await exportTo(join(EXAMPLES, "portable-transition-model.json"), { states: ["2"] });
  try { assert.deepEqual(picked.files.map(entry => entry.id), ["target"]); assert.equal(picked.onDisk.length, 1); } finally { picked.cleanup(); }

  const byId = await exportTo(join(EXAMPLES, "portable-transition-model.json"), { states: ["current"] });
  try { assert.deepEqual(byId.files.map(entry => entry.index), [1]); } finally { byId.cleanup(); }
});

test("the same model exports byte-identical snapshots every time", { skip }, async () => {
  const first = await exportTo(join(FIXTURES, "orders-failover-scenarios.json"));
  const second = await exportTo(join(FIXTURES, "orders-failover-scenarios.json"));
  try {
    assert.deepEqual(first.onDisk, second.onDisk);
    for (const name of first.onDisk) assert.equal(first.read(name), second.read(name), `${name} differs between two exports`);
  } finally { first.cleanup(); second.cleanup(); }
});

test("a bad request fails before writing anything", { skip }, async () => {
  const model = join(FIXTURES, "commerce-views.json");
  await assert.rejects(exportTo(model, { views: ["nope"] }), /no view "nope" \(available: context, production, checkout\)/);
  await assert.rejects(exportTo(join(EXAMPLES, "portable-transition-model.json"), { states: ["9"] }), /no state "9" \(available: 1=current, 2=target\)/);
  const outDir = mkdtempSync(join(tmpdir(), "snapshot-test-"));
  try {
    await assert.rejects(exportSnapshots({ modelPath: model, outDir: join(outDir, "never"), chromium, views: ["nope"] }), /no view/);
    assert.deepEqual(readdirSync(outDir), [], "a rejected request must not create the output directory or a manifest");
  } finally { rmSync(outDir, { recursive: true, force: true }); }
});
