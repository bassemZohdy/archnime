# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

- [ ] **FEAT-021** · P0 · high · Add one aggregator skill that reads the workspace state and routes to the interview, DSL, renderer and validation skills
  - Done when: the aggregator skill exists beside the four skills, passes the structure check, and its scanner recommends the right next skill for every workspace state; `npm run check-skills`
  - Links: Ref: AGENTS.md
  - State: branch todo/FEAT-021-add-aggregator-skill-reads from main; next: build children
  - [x] **FEAT-021.1** · mid · Scan a workspace for sources, models, bundles, snapshots and tooling and recommend the next step
    - Done when: each workspace state reports its artifacts, staleness and one recommended skill and command; `python -m unittest discover -s architecture-diagram/tests -p test_workspace_state.py`
  - [x] **FEAT-021.2** · mid · Write the aggregator SKILL.md and state machine so every scanner state routes to exactly one skill
    - Done when: every state the scanner can emit appears once in the skill's routing table with its owner skill; `python -m unittest discover -s architecture-diagram/tests -p test_skill_contract.py`
  - [/] **FEAT-021.3** · low · Register the aggregator in the structure check, AGENTS.md, README, docs and the test scripts
    - Done when: the structure check requires all five skills and the aggregator's tests run under npm test; `npm run check-skills`
    - State: attempts 0/3; baseline 46 passing; branch todo/FEAT-021.3-register-aggregator-structure-check from todo/FEAT-021-add-aggregator-skill-reads; next: build

- [ ] **FIX-005** · P1 · high · Prevent silent changes to non-Latin architecture labels during SVG export
  - Done when: Arabic and other supported-script labels retain shape and placement or trigger a clear rejection; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/documentation-export.md
  - [ ] **FIX-005.1** · mid · Add Arabic, bidirectional and missing-glyph export regressions
    - Done when: exported image checks detect fallback and clipping of RTL text; `node --test architecture-diagram-renderer/tests/multilingual_font.test.mjs`
  - [ ] **FIX-005.2** · high · Add a licensed font and metrics strategy for requested non-Latin scripts
    - Done when: supported glyphs paint offline and missing glyph ranges are rejected rather than silently substituted; `node --test architecture-diagram-renderer/tests/font_portability.test.mjs`

- [ ] **FEAT-017** · P1 · high · Add code-backed provenance: optional source on catalog entries and wires, plus a check that reports sources whose file or quoted words are gone and refuses unsafe paths
  - Done when: check flags a missing path and vanished words and rejects absolute, parent-escaping and secret-file sources in both validators; `python -m unittest discover -s architecture-diagram-dsl/tests -p test_sources.py`
  - State: next: decompose

- [ ] **FEAT-018** · P1 · high · Add an agent-first extraction workflow: reader contract, evidence-only drawing from code, a spec brief printer, a density budget warning and a one-command install
  - Done when: the extraction contract, density warning and spec brief are enforced by tests and the README documents the install; `python -m unittest discover -s architecture-diagram-interview/tests -p test_extraction_contract.py`
  - State: next: decompose

- [ ] **FEAT-019** · P1 · high · Reach static-SVG parity: headless CLI export, one SVG for light and dark, byte-stable output, refused flows, node variants and AI kinds, and a native sequence view
  - Done when: a headless command writes identical SVG bytes twice, carries both themes and draws a refused flow; `node architecture-diagram-renderer/tests/static_svg_cli_check.mjs`
  - State: next: decompose

- [ ] **TASK-006** · P2 · mid · Establish an animated SVG compatibility policy for documentation targets
  - Done when: the recommended animation format has tested static fallback and reduced-motion behavior; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/documentation-export.md
  - [ ] **TASK-006.1** · mid · Check CSS-keyframe SVG playback in image embedding and reduced-motion modes
    - Done when: supported viewers show all intended stages or an accessible first-frame fallback; `node --test architecture-diagram-renderer/tests/animated_svg_compat.test.mjs`
  - [ ] **TASK-006.2** · low · Compare SMIL only for verified unsupported CSS-animation targets
    - Done when: measured compatibility differences justify a choice without dual-renderer complexity; `node --test architecture-diagram-renderer/tests/animation_format.test.mjs`
