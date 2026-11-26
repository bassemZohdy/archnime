# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes
- build-time-layout: decide whether layout can be computed at build time and stored in the page (see docs/build-time-layout.md)

## 🌳 Task Tree

### build-time-layout

Decision taken 2026-11-26: build-time layout becomes the layout path, the current runtime layout is archived, and the old runtime is not kept as an option. The step that makes this safe is the parity gate (TASK-035): nothing is removed until it passes. Task shapes follow the CHANGELOG entries; confirm each executable check when the task is started.

- [ ] **TASK-033** (archive): Freeze the current renderer. Tag the last release before any change as `legacy-runtime-layout` and create a `legacy/2.x` branch for fixes only; say in the README where the archive lives and that it is not maintained for features. Check: `git tag -l legacy-runtime-layout` prints the tag and `git ls-remote --heads origin legacy/2.x` lists the branch.
- [ ] **TASK-034** (spike): Run `DiagramEngine.layoutStage` headlessly on three existing fixtures (one flat, one nested packages, one flow) and write the geometry out as JSON. Record time, geometry size and whether the result equals what the page computes. Ref: `skills/archnime-renderer/assets/diagram-engine.js`. Check: a script under `skills/archnime-renderer/tests/` that fails when headless and in-page geometry differ.
- [ ] **TASK-035** (gate): Parity matrix. List every current renderer feature (Tune layout, package expansion, wire styles and reroute, perspectives, self-check, flows, SVG and animated-SVG export, `<architecture-diagram>` element, loading a spec in the page with no build step) as kept, replaced or dropped, with the reason, in `docs/build-time-layout.md`. Any "dropped" row needs the owner's agreement. Depends on: TASK-034. Check: every row has a status and no row is empty.
- [ ] **TASK-036** (test): Add a free-form (not lane-aligned) fixture and a nested-packages fixture, so the approach is checked on more than the lane-aligned test diagram. Check: `npm run check-fixtures`.
- [ ] **TASK-037** (test): Port the measurements from the comparison harness as a regression gate: pause freezes motion, Back, Next and jump work while playing, no text under 12 px at 1280 px wide, loop length reported. Ref: tech-reports `animated-diagram-technology-choice/evidence/measure`. Check: a new script under `skills/archnime-renderer/tests/` wired into `npm run test:browser`.
- [ ] **FEAT-038** (feat): Store per-stage geometry in the generated page with a hash of the model; a missing or stale geometry fails the build with a clear message instead of falling back to runtime layout. Depends on: TASK-035, TASK-036, TASK-037. Check: `npm run test:browser` plus a fixture that renders with the layout libraries blocked.
- [ ] **TASK-039** (release): Remove the runtime layout code and the dagre, ELK and force libraries from the page, update `docs/`, `README.md` and the skills' `references/`, and release 3.0.0 with the version bumped in every manifest. Depends on: FEAT-038. Check: `npm test`.
- [ ] **TASK-040** (spike, optional): After 3.0.0, try a GSAP animation layer on the stored geometry and compare with the Web Animations runtime on the TASK-037 gate. Read the GSAP licence first; it forbids use in a visual animation builder that competes with Webflow.
