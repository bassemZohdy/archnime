/* FEAT-018.5: the one-command install copies the five skills, without tests or caches, and never
 * overwrites a folder it did not write. Run: node --test scripts/install.test.mjs */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { destination, install, parseArgs, skillNames } from "./install.mjs";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SCRIPT = join(REPO, "scripts", "install.mjs");
const EXPECTED = ["archnime", "archnime-dsl", "archnime-interview", "archnime-renderer", "archnime-validation"];
const quiet = () => {};

function scratch(t) {
  const folder = mkdtempSync(join(tmpdir(), "archnime-install-"));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  return folder;
}

function walk(folder) {
  return readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? walk(join(folder, entry.name)).map(path => `${entry.name}/${path}`) : [entry.name]);
}

test("it finds exactly the five skills", () => {
  assert.deepEqual(skillNames(), EXPECTED);
});

test("targets resolve to the agent's skills folder", () => {
  const where = { cwd: "/work/project", home: "/home/me" };
  assert.equal(destination(parseArgs([]), where), join("/home/me", ".claude", "skills"));
  assert.equal(destination(parseArgs(["--project"]), where), join("/work/project", ".claude", "skills"));
  assert.equal(destination(parseArgs(["install", "--target", "agents"]), where), join("/home/me", ".agents", "skills"));
  assert.equal(destination(parseArgs(["--dest", "vendor/skills"]), where), resolve("/work/project", "vendor/skills"));
  assert.throws(() => parseArgs(["--target", "nope"]), /unknown target/);
  assert.throws(() => parseArgs(["--dest"]), /needs a value/);
});

test("a dry run copies nothing", t => {
  const dest = join(scratch(t), "skills");
  const lines = [];
  install(parseArgs(["--dest", dest, "--dry-run"]), line => lines.push(line));
  assert.equal(existsSync(dest), false);
  assert.match(lines[0], /^Would install 5 skills/);
});

test("an install copies every skill without tests or caches, and can be repeated", t => {
  const dest = join(scratch(t), "skills");
  install(parseArgs(["--dest", dest]), quiet);
  assert.deepEqual(readdirSync(dest).sort(), EXPECTED);
  for (const name of EXPECTED) {
    const files = walk(join(dest, name));
    assert.ok(files.includes("SKILL.md"), `${name} has its SKILL.md`);
    assert.ok(!files.some(path => path.startsWith("tests/") || path.includes("__pycache__/") || path.endsWith(".pyc")), `${name} carries no tests or caches`);
    assert.equal(readFileSync(join(dest, name, "SKILL.md"), "utf8"), readFileSync(join(REPO, "skills", name, "SKILL.md"), "utf8"));
  }
  assert.ok(existsSync(join(dest, "archnime-dsl", "scripts", "check_sources.py")));
  assert.ok(existsSync(join(dest, "archnime-renderer", "assets", "template.html")));
  install(parseArgs(["--dest", dest]), quiet); // replacing its own earlier install is allowed
  assert.deepEqual(readdirSync(dest).sort(), EXPECTED);
});

test("a folder it did not write is left alone unless forced", t => {
  const dest = join(scratch(t), "skills");
  mkdirSync(join(dest, "archnime-dsl"), { recursive: true });
  writeFileSync(join(dest, "archnime-dsl", "mine.txt"), "keep me");
  assert.throws(() => install(parseArgs(["--dest", dest]), quiet), /was not written by this installer/);
  assert.equal(readFileSync(join(dest, "archnime-dsl", "mine.txt"), "utf8"), "keep me");
  install(parseArgs(["--dest", dest, "--force"]), quiet);
  assert.equal(existsSync(join(dest, "archnime-dsl", "mine.txt")), false);
});

test("the command line installs and an installed validator runs", t => {
  const dest = join(scratch(t), "skills");
  const output = execFileSync(process.execPath, [SCRIPT, "install", "--dest", dest], { encoding: "utf8" });
  assert.match(output, /Installing 5 skills/);
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const run = spawnSync(python, [join(dest, "archnime-dsl", "scripts", "validate_transition_diagram.py"), join(dest, "archnime-dsl", "assets", "examples", "checkout-flow.yaml")], { encoding: "utf8" });
  if (run.error) t.skip(`python not available: ${run.error.message}`);
  else assert.equal(run.status, 0, run.stdout + run.stderr);
  const failed = spawnSync(process.execPath, [SCRIPT, "--target", "nope"], { encoding: "utf8" });
  assert.equal(failed.status, 2);
});
