# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes
- build-time-layout: decide whether layout can be computed at build time and stored in the page (see docs/build-time-layout.md)

## 🌳 Task Tree

### build-time-layout

Proposed, in order. Do not start TASK-034 onward until TASK-033 is decided. Task shapes follow the CHANGELOG entries; each needs its executable check confirmed when it is started.

- [ ] **TASK-033** (decision): Decide whether to pursue build-time layout, after reading `docs/build-time-layout.md` and the linked report. Output: a yes, no or "spike first" recorded in that note. Check: the note's status line is no longer "proposed".
- [ ] **TASK-034** (spike): Run `DiagramEngine.layoutStage` headlessly on three existing fixtures (one flat, one nested packages, one flow) and write the geometry out as JSON. Record time, geometry size and whether the result equals what the page computes. Ref: `skills/archnime-renderer/assets/diagram-engine.js`. Check: a script under `skills/archnime-renderer/tests/` that fails when headless and in-page geometry differ.
- [ ] **FEAT-035** (feat): If TASK-034 holds, store per-stage geometry in the generated page, with a hash of the model so stale geometry is detected, and let the renderer use it when present and fall back to runtime layout when absent or stale. Depends on: TASK-034. Check: `npm run test:browser` plus a new fixture that renders with the layout libraries blocked.
- [ ] **TASK-036** (spike): Check which page features still need the engine at runtime (Tune layout, package expansion, wire-style reroute, perspectives) and which libraries could stop loading when geometry is stored. Output: a table in `docs/build-time-layout.md`. Depends on: TASK-034.
- [ ] **TASK-037** (test): Add a free-form (not lane-aligned) fixture and a nested-packages fixture for the comparison, so the approach is checked on more than the lane-aligned test diagram. Check: `npm run check-fixtures`.
- [ ] **TASK-038** (test): Port the measurements from the comparison harness as a regression gate: pause freezes motion, Back, Next and jump work while playing, no text under 12 px at 1280 px wide, loop length reported. Ref: tech-reports `animated-diagram-technology-choice/evidence/measure`. Check: a new script under `skills/archnime-renderer/tests/` wired into `npm run test:browser`.
- [ ] **TASK-039** (spike, optional): Try a GSAP animation layer on top of the stored geometry and compare with the Web Animations runtime on the harness. Depends on: FEAT-035. Read the GSAP licence first; it forbids use in a visual animation builder that competes with Webflow.
