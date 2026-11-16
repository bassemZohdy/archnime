# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

- [ ] **FEAT-017** · P1 · high · Add code-backed provenance: optional source on catalog entries and wires, plus a check that reports sources whose file or quoted words are gone and refuses unsafe paths
  - Done when: check flags a missing path and vanished words and rejects absolute, parent-escaping and secret-file sources in both validators; `python -m unittest discover -s skills/architecture-diagram-dsl/tests -p test_sources.py`
  - State: next: decompose

- [ ] **FEAT-018** · P1 · high · Add an agent-first extraction workflow: reader contract, evidence-only drawing from code, a spec brief printer, a density budget warning and a one-command install
  - Done when: the extraction contract, density warning and spec brief are enforced by tests and the README documents the install; `python -m unittest discover -s skills/architecture-diagram-interview/tests -p test_extraction_contract.py`
  - State: next: decompose

- [ ] **FEAT-019** · P1 · high · Reach static-SVG parity: headless CLI export, one SVG for light and dark, byte-stable output, refused flows, node variants and AI kinds, and a native sequence view
  - Done when: a headless command writes identical SVG bytes twice, carries both themes and draws a refused flow; `node skills/architecture-diagram-renderer/tests/static_svg_cli_check.mjs`
  - State: next: decompose
