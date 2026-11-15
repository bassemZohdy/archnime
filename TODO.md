# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

- [ ] **TASK-004** · P1 · mid · Add visual and conversion regression gates for documentation exports
  - Done when: browser-rendered image and PDF fixtures are checked at document-friendly widths; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/validation.md
  - State: branch todo/TASK-004-add-visual-conversion-regression from main; next: build children
  - [x] **TASK-004.1** · mid · Compare SVG-as-image and PNG output across dense, nested, light and dark layouts
    - Done when: baseline screenshots detect clipping, fallback fonts and shifted arrows; `node --test architecture-diagram-renderer/tests/documentation_visual.test.mjs`
  - [x] **TASK-004.2** · mid · Exercise PDF conversion and document-safe fallback selection
    - Done when: conversion preserves text and diagram bounds or selects an explicit PNG fallback; `node --test architecture-diagram-renderer/tests/pdf_conversion.test.mjs`

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
