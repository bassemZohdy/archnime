/* FEAT-002.2: every export carries a SHA-256 manifest, and tampering is detected.
 *
 * The manifest names the source model, the renderer files and each snapshot's view, state,
 * file, size and hash. It must be reproducible (no timestamps), and the verifier must
 * reject a snapshot that was edited, deleted or added, a model that changed, and a manifest
 * that tries to point outside its own directory.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { DEFAULT_TEMPLATE, exportSnapshots } from "../scripts/export_snapshots.mjs";
import { MANIFEST_NAME, MANIFEST_SCHEMA, sha256, verifyManifest } from "../scripts/snapshot_manifest.mjs";
import { FIXTURES, ROOT, browserSkip, chromium } from "./doc_export_harness.mjs";

const skip = browserSkip();
const MODEL = join(FIXTURES, "orders-failover-scenarios.json");
const VERIFY_CLI = join(ROOT, "archnime-renderer", "scripts", "verify_snapshots.mjs");
const temporary = [];

async function freshExport(modelPath = MODEL) {
  const outDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
  temporary.push(outDir);
  const { files } = await exportSnapshots({ modelPath, outDir, chromium });
  return { outDir, files, manifest: JSON.parse(readFileSync(join(outDir, MANIFEST_NAME), "utf8")) };
}
const copyOf = source => {
  const target = mkdtempSync(join(tmpdir(), "manifest-copy-"));
  temporary.push(target);
  for (const name of readdirSync(source)) copyFileSync(join(source, name), join(target, name));
  return target;
};
test.after(() => temporary.forEach(path => rmSync(path, { recursive: true, force: true })));

test("the export writes a manifest identifying source, renderer and every snapshot", { skip }, async () => {
  const { outDir, files, manifest } = await freshExport();
  assert.equal(manifest.schema, MANIFEST_SCHEMA);
  assert.deepEqual(manifest.source, { file: "orders-failover-scenarios.json", sha256: sha256(readFileSync(MODEL)) });
  assert.equal(manifest.renderer.template.sha256, sha256(readFileSync(DEFAULT_TEMPLATE)));
  for (const part of ["template", "engine", "library", "font"]) assert.match(manifest.renderer[part].sha256, /^[0-9a-f]{64}$/, `renderer ${part} is not identified`);
  assert.equal(manifest.snapshots.length, files.length);
  manifest.snapshots.forEach((snapshot, position) => {
    const bytes = readFileSync(join(outDir, snapshot.file));
    assert.equal(snapshot.file, files[position].file);
    assert.equal(snapshot.sha256, sha256(bytes), `${snapshot.file} hash does not match its bytes`);
    assert.equal(snapshot.bytes, bytes.length);
    assert.deepEqual(snapshot.state, { index: files[position].index, id: files[position].id, title: files[position].title });
    assert.ok("view" in snapshot && "mode" in snapshot);
  });
  assert.deepEqual(verifyManifest(outDir, { modelPath: MODEL }), { ok: true, problems: [], checked: files.length });
});

test("the manifest holds no timestamps or machine details, so a rerun reproduces it byte for byte", { skip }, async () => {
  const first = await freshExport(), second = await freshExport();
  const text = readFileSync(join(first.outDir, MANIFEST_NAME), "utf8");
  assert.equal(text, readFileSync(join(second.outDir, MANIFEST_NAME), "utf8"));
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T|\bC:\\|\/Users\/|\/tmp\//, "the manifest leaks a timestamp or a path");
});

test("a bundle manifest records the view and mode of each snapshot", { skip }, async () => {
  const { manifest } = await freshExport(join(FIXTURES, "commerce-views.json"));
  assert.deepEqual([...new Set(manifest.snapshots.map(snapshot => snapshot.view))], ["context", "production", "checkout"]);
  assert.deepEqual([...new Set(manifest.snapshots.map(snapshot => snapshot.mode))].sort(), ["deployment", "flow", "system"]);
});

test("the verifier rejects an edited, deleted, added or reordered-name snapshot and a changed model", { skip }, async () => {
  const { outDir, files } = await freshExport();
  const target = files[1].file;

  const edited = copyOf(outDir);
  writeFileSync(join(edited, target), readFileSync(join(edited, target), "utf8").replace("<svg", "<svg data-edited=\"1\""));
  const editedResult = verifyManifest(edited);
  assert.equal(editedResult.ok, false);
  assert.ok(editedResult.problems.some(problem => problem.startsWith(`${target}: sha256 mismatch`)), editedResult.problems.join("\n"));

  const deleted = copyOf(outDir);
  rmSync(join(deleted, target));
  assert.deepEqual(verifyManifest(deleted).problems, [`${target}: missing`]);

  const added = copyOf(outDir);
  writeFileSync(join(added, "extra-diagram.svg"), "<svg/>");
  assert.deepEqual(verifyManifest(added).problems, ["extra-diagram.svg: not listed in the manifest"]);

  const otherModel = join(mkdtempSync(join(tmpdir(), "manifest-model-")), "other.json");
  temporary.push(join(otherModel, ".."));
  writeFileSync(otherModel, JSON.stringify({ different: true }));
  assert.ok(verifyManifest(outDir, { modelPath: otherModel }).problems.some(problem => /differs from the one the snapshots were exported from/.test(problem)));

  assert.equal(verifyManifest(outDir).ok, true, "the untouched export must still verify");
});

test("a hostile manifest cannot make the verifier read outside its directory", { skip }, async () => {
  const { outDir } = await freshExport();
  const hostile = copyOf(outDir);
  const manifest = JSON.parse(readFileSync(join(hostile, MANIFEST_NAME), "utf8"));
  manifest.snapshots.push({ file: "../outside.svg", sha256: "0".repeat(64), bytes: 1 }, { file: "sub/dir.svg", sha256: "0".repeat(64), bytes: 1 }, { file: MANIFEST_NAME, sha256: "0".repeat(64), bytes: 1 });
  manifest.snapshots.push({ file: manifest.snapshots[0].file, sha256: manifest.snapshots[0].sha256, bytes: manifest.snapshots[0].bytes });
  writeFileSync(join(hostile, MANIFEST_NAME), JSON.stringify(manifest));
  const { problems } = verifyManifest(hostile);
  assert.equal(problems.filter(problem => /unsafe or missing file name/.test(problem)).length, 3, problems.join("\n"));
  assert.ok(problems.some(problem => /is listed twice/.test(problem)));

  const empty = mkdtempSync(join(tmpdir(), "manifest-empty-"));
  temporary.push(empty);
  assert.match(verifyManifest(empty).problems[0], /manifest\.json is missing/);
  writeFileSync(join(empty, MANIFEST_NAME), "{not json");
  assert.match(verifyManifest(empty).problems[0], /not valid JSON/);
});

test("the verify command exits 0 for a good export and 1 with one line per problem otherwise", { skip }, async () => {
  const { outDir, files } = await freshExport();
  const good = spawnSync(process.execPath, [VERIFY_CLI, "--dir", outDir, "--model", MODEL], { encoding: "utf8" });
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, new RegExp(`OK: ${files.length} snapshot\\(s\\)`));

  const broken = copyOf(outDir);
  rmSync(join(broken, files[0].file));
  writeFileSync(join(broken, files[1].file), "<svg/>");
  const bad = spawnSync(process.execPath, [VERIFY_CLI, "--dir", broken], { encoding: "utf8" });
  assert.equal(bad.status, 1);
  const lines = bad.stderr.trim().split("\n");
  assert.ok(lines.every(line => line.startsWith("FAIL: ")), `every problem is one FAIL line:\n${bad.stderr}`);
  assert.ok(lines.some(line => line.includes(`${files[0].file}: missing`)), bad.stderr);
  assert.ok(lines.some(line => line.includes(`${files[1].file}: sha256 mismatch`)), bad.stderr);

  assert.equal(spawnSync(process.execPath, [VERIFY_CLI], { encoding: "utf8" }).status, 2);
});
