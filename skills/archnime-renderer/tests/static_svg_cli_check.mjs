/* FEAT-019: the static-SVG command line. Run: node skills/archnime-renderer/tests/static_svg_cli_check.mjs
 *
 * One headless command turns a spec into a documentation SVG that
 *   - is byte-identical on a second run (documentation and sequence views),
 *   - carries the light and the dark palette, and Chromium paints dark under prefers-color-scheme: dark,
 *   - draws a refused reply with its cross, an external part dashed, and the AI types with their own icons,
 *   - and, with --sequence, draws one lifeline per flow node and one numbered message per step edge.
 * Missing Chromium is reported as SKIP, or FAIL under REQUIRE_BROWSER_TESTS=1: never as a pass.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadChromium } from "../scripts/export_snapshots.mjs";
import { exportSvg, parseArguments } from "../scripts/export_svg.mjs";

const SKILLS = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const CLI = join(SKILLS, "archnime-renderer", "scripts", "export_svg.mjs");
const AGENT = join(SKILLS, "archnime-dsl", "assets", "examples", "agent-refusal-flow.yaml");
const CHECKOUT = join(SKILLS, "archnime-dsl", "assets", "examples", "checkout-flow.yaml");
const SYSTEM = join(SKILLS, "archnime-dsl", "assets", "examples", "one-shot-checkout.yaml");
const SIGN_IN = join(SKILLS, "archnime-dsl", "assets", "examples", "sign-in-sequence.yaml");
const failures = [];
const check = (ok, message) => { console.log(`${ok ? "✓" : "✗"} ${message}`); if (!ok) failures.push(message); };

// Argument handling needs no browser.
check(parseArguments(["spec.yaml", "--out", "a.svg", "--sequence"]).sequence === true, "--sequence is a flag");
for (const [argv, pattern] of [[["spec.yaml"], /^usage:/], [["spec.yaml", "--out"], /needs a value/], [["spec.yaml", "--out", "a.svg", "--theme", "x"], /unknown option/]]) {
  let message = "";
  try { parseArguments(argv); } catch (error) { message = error.message; }
  check(pattern.test(message), `bad arguments are refused: ${argv.join(" ")}`);
}
const usage = spawnSync(process.execPath, [CLI, AGENT], { encoding: "utf8" });
check(usage.status === 2 && /usage:/.test(usage.stderr), "the command exits 2 with its usage when --out is missing");

const chromium = await loadChromium();
if (!chromium) {
  console.log(`${process.env.REQUIRE_BROWSER_TESTS === "1" ? "FAIL" : "SKIP"} static_svg_cli_check: Playwright/Chromium is not available`);
  process.exit(failures.length ? 1 : process.env.REQUIRE_BROWSER_TESTS === "1" ? 2 : 0);
}

const work = mkdtempSync(join(tmpdir(), "static-svg-"));
const browser = await chromium.launch(process.env.BROWSER_EXECUTABLE ? { executablePath: process.env.BROWSER_EXECUTABLE } : undefined);
try {
  // 019.1: byte-stable, through the command line itself.
  const run = (...args) => spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  const first = join(work, "refused-1.svg"), second = join(work, "refused-2.svg");
  const a = run(AGENT, "--state", "8", "--out", first), b = run(AGENT, "--state", "8", "--out", second);
  check(a.status === 0 && b.status === 0, `the command writes the SVG (${(a.stderr || b.stderr).trim() || "ok"})`);
  const svg = readFileSync(first, "utf8");
  check(svg === readFileSync(second, "utf8"), "two runs write identical bytes");

  // 019.2: both palettes in one file; the reader's setting picks one.
  check(/@media \(prefers-color-scheme: dark\)/.test(svg) && /class="[^"]*\bdk\d+/.test(svg), "the SVG carries a dark palette as a media rule");
  check(!/<symbol[^>]*style=/.test(svg), "icon symbols inherit their paint from <use> instead of a baked black fill");
  const painted = {};
  for (const scheme of ["light", "dark"]) {
    const page = await browser.newPage({ colorScheme: scheme });
    await page.goto(pathToFileURL(first).href);
    painted[scheme] = await page.evaluate(() => ({
      background: getComputedStyle(document.querySelector("rect.doc-background")).fill,
      node: getComputedStyle(document.querySelector("g.node .shape")).fill,
    }));
    await page.close();
  }
  check(painted.light.background === "rgb(255, 255, 255)", `light background is white (${painted.light.background})`);
  check(painted.dark.background === "rgb(23, 29, 43)", `dark background is the dark panel (${painted.dark.background})`);
  check(painted.light.node !== painted.dark.node, `node fills change with the theme (${painted.light.node} / ${painted.dark.node})`);

  // 019.3 and 019.4: refused reply, external part, AI types.
  check(/class="wire[^"]*\bflow-refused\b/.test(svg) && svg.includes('marker-end="url(#refused-cross)"') && svg.includes('id="refused-cross"'), "the refused reply is drawn with its cross");
  const external = svg.match(/<g [^>]*class="node[^"]*\bvariant-external\b[^"]*"[^>]*>\s*<path[^>]*style="([^"]*)"|<g [^>]*class="node[^"]*\bvariant-external\b[^"]*"[^>]*>\s*<rect[^>]*style="([^"]*)"/);
  check(!!external && !/stroke-dasharray:none/.test(external[1] || external[2]), "the external model has a dashed outline");
  for (const icon of ["llm", "vector-store", "tool"]) check(svg.includes(`<symbol id="icon-${icon}"`) && svg.includes(`href="#icon-${icon}"`), `the ${icon} node uses its own icon`);

  // A single-view system diagram exports too, through the module.
  const plain = await exportSvg({ source: SYSTEM, chromium });
  check(plain.startsWith("<svg") && plain.includes("prefers-color-scheme: dark"), "a system spec exports through the module API");

  // 019.5: the sequence view.
  const seqA = join(work, "seq-1.svg"), seqB = join(work, "seq-2.svg");
  const s1 = run(AGENT, "--sequence", "--out", seqA), s2 = run(AGENT, "--sequence", "--out", seqB);
  check(s1.status === 0 && s2.status === 0, `--sequence writes the SVG (${(s1.stderr || s2.stderr).trim() || "ok"})`);
  const sequence = readFileSync(seqA, "utf8");
  check(sequence === readFileSync(seqB, "utf8"), "two sequence runs write identical bytes");
  const count = (text, pattern) => (text.match(pattern) || []).length;
  check(count(sequence, /class="seq-life"/g) === 6, `one lifeline per flow node (${count(sequence, /class="seq-life"/g)} of 6)`);
  check(count(sequence, /class="seq-msg /g) === 7, `one message per step edge (${count(sequence, /class="seq-msg /g)} of 7)`);
  check(/>7 {2}over limit</.test(sequence) && /class="seq-msg seq-refused[^"]*"[^>]*marker-end="url\(#seq-refused\)"/.test(sequence), "the refusal is message 7 and ends in a cross");
  check(count(sequence, /class="seq-msg seq-return/g) === 2, "both returns are dashed replies");
  check(sequence.includes("@media (prefers-color-scheme: dark)"), "the sequence view carries the dark palette");
  const checkout = await exportSvg({ source: CHECKOUT, sequence: true, chromium });
  check(count(checkout, /class="seq-msg /g) === 8 && /seq-loop/.test(checkout) && /seq-async/.test(checkout), "grouped, parallel, async and loop steps each become messages");
  check(/class="seq-frame seq-frame-par"/.test(checkout) && /class="seq-frame seq-frame-loop"[\s\S]*?\[until delivered\]/.test(checkout), "a parallel step and a looped step are drawn as par and loop frames");

  // FEAT-024: alt, opt and loop fragments and named phases, byte-stable.
  const signA = join(work, "sign-1.svg"), signB = join(work, "sign-2.svg");
  const g1 = run(SIGN_IN, "--sequence", "--out", signA), g2 = run(SIGN_IN, "--sequence", "--out", signB);
  check(g1.status === 0 && g2.status === 0, `a flow with fragments exports (${(g1.stderr || g2.stderr).trim() || "ok"})`);
  const fragments = readFileSync(signA, "utf8");
  check(fragments === readFileSync(signB, "utf8"), "a flow with fragments writes identical bytes twice");
  check(["opt", "loop", "alt"].every(kind => count(fragments, new RegExp(`class="seq-frame seq-frame-${kind}"`, "g")) === 1), "opt, loop and alt each draw one frame");
  check(/\[account has MFA\]/.test(fragments) && /\[up to 3 tries\]/.test(fragments) && /\[password matches\]/.test(fragments) && /\[else\]/.test(fragments), "every guard is written on its frame or branch");
  check(count(fragments, /class="seq-frame-divider"/g) === 1, "the alt's else branch is set off by one divider");
  check(count(fragments, /class="seq-phase"/g) === 3 && />Check the password</.test(fragments), "each named phase is headed once");
  check(count(fragments, /class="seq-msg /g) === 8, `every message is drawn once (${count(fragments, /class="seq-msg /g)} of 8)`);
  const refusedFlowOnly = run(SYSTEM, "--sequence", "--out", join(work, "none.svg"));
  check(refusedFlowOnly.status === 1 && /needs a flow/.test(refusedFlowOnly.stderr), "--sequence on a spec without a flow is refused");
} finally {
  await browser.close();
  rmSync(work, { recursive: true, force: true });
}

if (failures.length) { console.log(`\n${failures.length} static SVG check(s) failed`); process.exit(1); }
console.log("\nall static SVG checks passed");
