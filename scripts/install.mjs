#!/usr/bin/env node
/* Install the archnime skills into an agent's skills folder in one command.
 *
 *   npx --yes github:bassemZohdy/diagram-skills                    Claude Code, for this user (~/.claude/skills)
 *   npx --yes github:bassemZohdy/diagram-skills --project          Claude Code, for this project (./.claude/skills)
 *   npx --yes github:bassemZohdy/diagram-skills --target agents    any Agent Skills tool reading ~/.agents/skills
 *   npx --yes github:bassemZohdy/diagram-skills --dest <folder>    any other skills folder
 *   ... --dry-run                                                  say what would be copied, copy nothing
 *
 * Copies the five skill folders (SKILL.md, agents/, references/, scripts/, assets/) without their
 * tests or caches. A folder of the same name is replaced only when an earlier install of these
 * skills wrote it (it holds `.archnime-install`), or with --force. Nothing is downloaded and no
 * other file is touched; the Python dependencies are checked and named, not installed.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REPO = resolve(fileURLToPath(new URL("..", import.meta.url)));
const SKILLS = join(REPO, "skills");
const MARKER = ".archnime-install";
const SKIP = new Set(["tests", "__pycache__", "node_modules", ".pytest_cache"]);
const TARGETS = { claude: [".claude", "skills"], agents: [".agents", "skills"] };

export function parseArgs(argv) {
  const options = { target: "claude", project: false, dest: null, dryRun: false, force: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--project") options.project = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--force") options.force = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--target" || arg === "--dest") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${arg} needs a value`);
      if (arg === "--target" && !TARGETS[value]) throw new Error(`unknown target ${value}; use ${Object.keys(TARGETS).join(" or ")}, or --dest <folder>`);
      options[arg.slice(2)] = value; index += 1;
    } else if (arg === "install") continue; // `npx … install` reads naturally; it is the only command
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

export function destination(options, { cwd = process.cwd(), home = homedir() } = {}) {
  if (options.dest) return resolve(cwd, options.dest);
  return join(options.project ? cwd : home, ...TARGETS[options.target]);
}

export function skillNames() {
  return readdirSync(SKILLS, { withFileTypes: true }).filter(entry => entry.isDirectory() && existsSync(join(SKILLS, entry.name, "SKILL.md"))).map(entry => entry.name).sort();
}

export function install(options, log = console.log) {
  const dest = destination(options), names = skillNames();
  const blocked = names.filter(name => existsSync(join(dest, name)) && !existsSync(join(dest, name, MARKER)) && !options.force);
  if (blocked.length) throw new Error(`${blocked.map(name => join(dest, name)).join(", ")} exists and was not written by this installer; move it away or pass --force`);
  log(`${options.dryRun ? "Would install" : "Installing"} ${names.length} skills into ${dest}`);
  for (const name of names) {
    const target = join(dest, name);
    log(`  ${name}${existsSync(target) ? " (replacing an earlier install)" : ""}`);
    if (options.dryRun) continue;
    rmSync(target, { recursive: true, force: true });
    mkdirSync(dest, { recursive: true });
    cpSync(join(SKILLS, name), target, { recursive: true, filter: source => !SKIP.has(basename(source)) && !source.endsWith(".pyc") });
    writeFileSync(join(target, MARKER), "Installed by the archnime installer; safe to replace on the next install.\n");
  }
  return { dest, names };
}

function pythonHint(log) {
  const python = process.env.PYTHON || (process.platform === "win32" ? "python" : "python3");
  const probe = spawnSync(python, ["-c", "import yaml, jsonschema"], { encoding: "utf8" });
  if (probe.status === 0) log("Python with pyyaml and jsonschema found: the validator and translator are ready.");
  else log(`The validator needs Python 3 with pyyaml and jsonschema: ${python} -m pip install pyyaml jsonschema`);
  log("The browser exports also need Node 24+ and Chromium: npx playwright install chromium");
}

const invokedDirectly = (() => { try { return realpathSync(process.argv[1] || "") === realpathSync(fileURLToPath(import.meta.url)); } catch { return false; } })();
if (invokedDirectly) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { console.log("usage: install.mjs [--target claude|agents] [--project] [--dest <folder>] [--dry-run] [--force]"); process.exit(0); }
    install(options);
    if (!options.dryRun) pythonHint(console.log);
  } catch (error) {
    console.error(`archnime install: ${error.message}`);
    process.exit(2);
  }
}
