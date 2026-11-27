# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes
- build-time-layout: layout computed at build time and stored in the page (done in 3.0.0; see docs/build-time-layout.md)

## 🌳 Task Tree

### build-time-layout

Build-time layout is done and released as 3.0.0 (TASK-032 to TASK-039, see CHANGELOG.md and docs/build-time-layout.md). One optional spike is left.

- [ ] **TASK-040** (spike, optional): After 3.0.0, try a GSAP animation layer on the stored geometry and compare with the Web Animations runtime on the TASK-037 gate. Read the GSAP licence first; it forbids use in a visual animation builder that competes with Webflow.
