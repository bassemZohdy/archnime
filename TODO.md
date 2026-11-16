# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

- [ ] **TASK-022** · P0 · low · Rename the plugin to archnime 2.0.0 and the skills to archnime, archnime-interview, -dsl, -renderer and -validation, keeping the `<architecture-diagram>` element
  - Done when: every manifest names archnime 2.0.0, no skill folder or SKILL.md name says architecture-diagram, and the suite passes; `npm run check-skills`; regression: `npm test`
  - State: baseline 0 failing (npm test green); branch todo/TASK-022-rename-archnime from main; next: build

- [ ] **FEAT-017** · P1 · high · Add code-backed provenance: optional source on catalog entries and wires, plus a check that reports sources whose file or quoted words are gone and refuses unsafe paths
  - Done when: check flags a missing path and vanished words and rejects absolute, parent-escaping and secret-file sources in both validators; `python -m unittest discover -s skills/archnime-dsl/tests -p test_sources.py`
  - Links: Depends: TASK-022
  - [x] **FEAT-017.1** · high · `source` on catalog entries, node overrides and wires in the schema, with a `source-path-unsafe` lint in the Python and browser validators
    - Done when: both validators accept a safe source and reject absolute, `..`, `.git` and secret-file paths alike; `python -m unittest discover -s skills/archnime-dsl/tests -p test_sources.py`
  - [x] **FEAT-017.2** · mid · `check_sources.py`: report a missing file, vanished quoted words, a line past the end and a link escaping the root
    - Done when: each case is a finding with its path and the exit code is 1; `python -m unittest discover -s skills/archnime-dsl/tests -p test_sources.py`
  - [x] **FEAT-017.3** · low · Carry `source` into the renderer model and document the field, the rules and the check
    - Done when: both translators keep source and the rule list stays documented; `python -m unittest discover -s skills/archnime-dsl/tests -p test_rule_docs.py`; regression: `npm run check-fixtures`

- [ ] **FEAT-018** · P1 · high · Add an agent-first extraction workflow: reader contract, evidence-only drawing from code, a spec brief printer, a density budget warning and a one-command install
  - Done when: the extraction contract, density warning and spec brief are enforced by tests and the README documents the install; `python -m unittest discover -s skills/archnime-interview/tests -p test_extraction_contract.py`
  - Links: Depends: FEAT-017
  - [x] **FEAT-018.1** · mid · `meta.reader` and `meta.evidence` with `reader-contract-incomplete` and `evidence-source-missing` lints in both validators
    - Done when: a code-evidence document without sources warns and a reader with under 3 questions warns in both; `python -m unittest discover -s skills/archnime-dsl/tests -p test_extraction_lint.py`
  - [x] **FEAT-018.2** · mid · `density-budget` warning past 12 nodes or 16 wires in one state, view or flow, in both validators
    - Done when: a 13-node state warns and every shipped example stays clean; `python -m unittest discover -s skills/archnime-dsl/tests -p test_extraction_lint.py`
  - [x] **FEAT-018.3** · low · `spec_brief.py` prints one complete small spec and one line per other section, or one section by name
    - Done when: the brief validates clean and each listed section prints; `python -m unittest discover -s skills/archnime-dsl/tests -p test_spec_brief.py`
  - [x] **FEAT-018.4** · mid · Extraction reference and SKILL.md steps: reader contract, evidence-only facts, brief, check, critique, report
    - Done when: the contract test finds every step and rule; `python -m unittest discover -s skills/archnime-interview/tests -p test_extraction_contract.py`
  - [x] **FEAT-018.5** · mid · One-command install script for Claude, Codex, Gemini and plain skill folders, documented in the README
    - Done when: a dry run and a real install into a temp folder copy the five skills without tests; `node --test scripts/install.test.mjs`

- [ ] **FEAT-019** · P1 · high · Reach static-SVG parity: headless CLI export, one SVG for light and dark, byte-stable output, refused flows, node variants and AI kinds, and a native sequence view
  - Done when: a headless command writes identical SVG bytes twice, carries both themes and draws a refused flow; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`
  - Links: Depends: FEAT-018
  - [x] **FEAT-019.1** · mid · `export_svg.mjs`: YAML or model in, one documentation SVG out, headless and byte-stable
    - Done when: two runs write identical bytes; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`
  - [x] **FEAT-019.2** · high · One documentation SVG carries light and dark through `prefers-color-scheme`
    - Done when: the SVG holds both palettes and Chromium paints dark under emulated dark; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`
  - [x] **FEAT-019.3** · mid · Refused flow steps (`kind: refused`) through schema, validators, translators and renderer
    - Done when: a refused step validates, translates alike and draws a marked line; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`; regression: `npm test`
  - [x] **FEAT-019.4** · mid · Node `variant: external` and the AI types `llm`, `vector-store` and `tool`
    - Done when: each type and the variant validate in both validators and draw their own icon; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`
  - [x] **FEAT-019.5** · high · Native sequence view of a flow: participants, numbered messages, returns and refusals as SVG
    - Done when: `--sequence` writes a stable SVG with a lifeline per node and a message per step; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`
