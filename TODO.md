# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes
- build-time-layout: decide whether layout can be computed at build time and stored in the page (see docs/build-time-layout.md)

## 🌳 Task Tree

### build-time-layout

Decision taken 2026-11-26: build-time layout becomes the layout path, the current runtime layout is archived, and the old runtime is not kept as an option. The step that makes this safe is the parity gate (TASK-035): nothing is removed until it passes. Task shapes follow the CHANGELOG entries; confirm each executable check when the task is started.

- [ ] **TASK-039** (release): Make stored geometry the only path (`build_bundle.py` requires `--geometry`; the tests and tools that build run-time pages switch to it), remove placement (dagre, ELK, the force layout and the Tune search) from the delivered page, keeping wire routing, `checkLayout` and `translate.html` as the parity matrix says, update `docs/`, `README.md` and the skills' `references/`, and release 3.0.0 with the version bumped in every manifest. Depends on: FEAT-038. Check: `npm test`.
- [ ] **TASK-040** (spike, optional): After 3.0.0, try a GSAP animation layer on the stored geometry and compare with the Web Animations runtime on the TASK-037 gate. Read the GSAP licence first; it forbids use in a visual animation builder that competes with Webflow.
