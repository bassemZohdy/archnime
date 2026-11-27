# archnime

Five portable Agent Skills (four domain skills and one aggregator) for **interactive, animated architecture presentations** and **documentation-safe diagram exports**. A single validated YAML architecture model drives semantic validation, rendering, and export.

## Skills

| Skill | Responsibility |
| --- | --- |
| [archnime](skills/archnime/) | Single entry point: scan the workspace, then route to the skill whose turn it is and re-check. |
| [archnime-interview](skills/archnime-interview/) | Elicit architecture facts, boundaries, assumptions, and diagram type. |
| [archnime-dsl](skills/archnime-dsl/) | Author, validate, and translate the renderer-independent YAML source. |
| [archnime-renderer](skills/archnime-renderer/) | Present interactive HTML/D3, animated flows, multi-stage migrations, and SVG/raster exports. |
| [archnime-validation](skills/archnime-validation/) | Validate semantics, layout, interactions, and documentation fidelity. |

**Pipeline:** interview → canonical DSL → validate/translate → interactive HTML → documentation-safe SVG.

The canonical DSL, not any SVG geometry, is the architecture source of truth. The renderer supports D3, Dagre, ELK, and force layouts. The browser outputs include search, zoom, disclosure, perspectives, and stage/flow playback.

## Install

This repository is one plugin, `archnime`, that holds all five skills in `skills/<name>/SKILL.md`. Install it with the tool you use; every route installs the same skills.

| Tool | Install |
| --- | --- |
| Claude Code | `/plugin install archnime --marketplace bassemZohdy/archnime` (Claude Code 2.1.275 or later), or `/plugin marketplace add bassemZohdy/archnime` then `/plugin install archnime@archnime` |
| Codex | `codex plugin marketplace add bassemZohdy/archnime`, then install `archnime` from the plugin directory |
| Gemini CLI | `gemini extensions install https://github.com/bassemZohdy/archnime` |
| GitHub Copilot (CLI and VS Code) | `copilot plugin marketplace add bassemZohdy/archnime`, then `copilot plugin install archnime@archnime` |
| Cursor and other Agent Plugins hosts | Add `https://github.com/bassemZohdy/archnime` as a plugin source; the root `plugin.json` follows the [Agent Plugins](https://agent-plugins.org/) standard |
| Any Agent Skills tool | `npx skills add bassemZohdy/archnime` |

### One command, no plugin system

```bash
npx --yes github:bassemZohdy/archnime
```

This copies the five skills into `~/.claude/skills` (Claude Code, for you). Add `--project` for `./.claude/skills` (this project only), `--target agents` for `~/.agents/skills` (tools that read the shared Agent Skills folder), `--dest <folder>` for any other skills folder, and `--dry-run` to see what would be copied. It copies each skill without its tests, replaces only folders an earlier run of it wrote (`--force` to replace others), downloads nothing beyond the package itself, and then tells you whether Python with `pyyaml` and `jsonschema` is ready. From a clone, `node scripts/install.mjs` does the same. Tested: a dry run and an install into a temporary folder (`npm run test:install`) and `npx` on a local checkout; the `github:` form runs the same `bin` once the branch is pushed.

Evidence, so you know what was run: `claude plugin validate . --strict` passes for the plugin and for `.claude-plugin/marketplace.json`; `codex plugin marketplace add` accepts `.agents/plugins/marketplace.json` and lists it; `gemini extensions validate .` passes. Installing from a published copy into Cursor was not run, so that route follows the vendor documentation only.

Commands inside each `SKILL.md` and its `references/` are written relative to the folder that holds the skills (`skills/` in this repository, the skills install folder elsewhere), so `archnime-dsl/scripts/...` works in both places. Commands in this README and in `docs/` are relative to the repository root.

## Repository layout

```
skills/                      the five Agent Skills (each: SKILL.md, agents/, references/, scripts/, assets/, tests/)
.claude-plugin/              Claude Code plugin.json and marketplace.json
plugin.json                  Agent Plugins manifest (Codex, Cursor and other hosts); OpenAI presentation under extensions
.agents/plugins/             Codex marketplace.json
.github/plugin/             GitHub Copilot marketplace.json (the plugin itself is the root plugin.json)
gemini-extension.json        Gemini CLI extension manifest (skills/ is discovered automatically)
docs/                        one guide per skill
scripts/                     repository checks (check_skill_structure.py also verifies every manifest) and install.mjs, the one-command installer
```

The plugin name and version must be identical in every manifest; `npm run check-skills` fails when they differ. Claude keeps users on the `version` they installed until it changes, so bump it in all manifests when you release.

## Quick start

Requirements: Python 3.12, Node 24+, and a modern Chromium for browser regression checks.

```bash
python -m pip install -r requirements-dev.txt
npm ci
npx playwright install chromium

python skills/archnime-dsl/scripts/validate_transition_diagram.py skills/archnime-dsl/assets/examples/checkout-flow.yaml
python skills/archnime-dsl/scripts/translate_transition_diagram.py skills/archnime-dsl/assets/examples/checkout-flow.yaml --output checkout-model.json
python skills/archnime-renderer/scripts/build_bundle.py --template skills/archnime-renderer/assets/template.html --model checkout-model.json --output checkout.html
```

Open `checkout.html` in a browser. By default it loads pinned D3/ELK/Dagre/GIF runtime scripts over the network; `--inline` only inlines the renderer's local sidecars and is **not** a fully offline bundle.

## Presentation vs documentation

Use **interactive HTML** for live demonstrations and drill-down. In the HTML export menu use **SVG (documentation)** for a static, zoom-independent SVG with embedded font data, a bounded viewBox, and an opaque background, in light and dark from one file. `node skills/archnime-renderer/scripts/export_svg.mjs spec.yaml --out diagram.svg` writes the same SVG headless (add `--sequence` for a flow's sequence view). Keep the viewer link alongside README diagrams; **embedded SVG images cannot provide the HTML interaction controls**. Export each important stage/view separately for formal documents. Animated SVG is available but needs destination-specific compatibility checks.

See [documentation-export.md](skills/archnime-renderer/references/documentation-export.md) and [the renderer guide](docs/archnime-renderer.md).

How archnime compares with Mermaid and archgram, and when to use each: [docs/comparison.md](docs/comparison.md).

Publishing the plugin to the provider directories, and what only the repository owner can do: [docs/publishing.md](docs/publishing.md).

Whether layout could be computed at build time and stored in the page, with the evidence and the plan: [docs/build-time-layout.md](docs/build-time-layout.md) (decided, pending a parity gate).

The renderer that computes layout in the page (releases up to 2.1.1) is archived as the git tag `legacy-runtime-layout` and the branch `legacy/2.x`. The branch takes fixes only; it is not maintained for features.

## Work tracking

This repository follows the [todo-skills task-tree convention](https://github.com/bassemZohdy/todo-skills) for planned improvements: see [TODO.md](TODO.md). Each task has an executable acceptance check; completed work is archived in [CHANGELOG.md](CHANGELOG.md). The former roadmap is consolidated into this single backlog.

Tests: `npm test`

## Tests

```bash
npm test
npm run check-fixtures
npm run check-fonts
```

`npm test` checks skill structure, pinned fonts, translated fixture parity, Python validators and headless browser interactions. CI sets `REQUIRE_BROWSER_TESTS=1` to prevent missing browser coverage from being reported as a pass. Layout pixel verification in GitHub/Office/PDF viewers remains a separate acceptance step.

## License

This repository's original scaffold and new integration files are MIT licensed under [LICENSE](LICENSE). The architecture-diagram skills and their migrated implementation are Apache-2.0 licensed under [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0) and each `SKILL.md` declares the same. The embedded Inter font is under the SIL Open Font License (see [font license](skills/archnime-renderer/assets/fonts/LICENSE-Inter-OFL.txt)). Preserve these notices when distributing artifacts.
