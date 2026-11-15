# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

- [ ] **TASK-001** · P0 · high · Verify documentation-safe SVG exports retain architecture semantics and render consistently
  - Done when: static SVG is zoom-independent, complete, font-embedded, and rejects malformed output; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/documentation-export.md
  - [ ] **TASK-001.1** · mid · Add independent SVG-image regression for stage geometry and missing-font failure
    - Done when: pan/zoom cannot crop SVG and missing font fails explicitly; `node --test architecture-diagram-renderer/tests/documentation_svg.test.mjs`
  - [ ] **TASK-001.2** · mid · Validate documentation SVG rendering at narrow and full README widths
    - Done when: labels, arrows, node identity and trust boundaries remain readable at supported sizes; `node --test architecture-diagram-renderer/tests/documentation_embedding.test.mjs`
  - [ ] **TASK-001.3** · mid · Verify the export preserves the selected flow step, stage and view without losing visible nodes
    - Done when: every selected stage/view matches the presenter state and excluded IDs are never invented; `node --test architecture-diagram-renderer/tests/documentation_states.test.mjs`

- [ ] **FEAT-002** · P0 · mid · Batch-export documented views and stages with reproducible provenance
  - Done when: every requested architecture state has a stable snapshot and valid manifest; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/documentation-export.md
  - [ ] **FEAT-002.1** · mid · Add named snapshot export for flow steps, migration stages and multi-view bundles
    - Done when: exported artifacts cover each selected state exactly once; `node --test architecture-diagram-renderer/tests/batch_snapshots.test.mjs`
  - [ ] **FEAT-002.2** · mid · Generate a SHA-256 manifest identifying source model, view, stage, output and renderer
    - Done when: manifest hashes match bytes and reject missing or tampered snapshots; `node --test architecture-diagram-renderer/tests/export_manifest.test.mjs`
  - [ ] **FEAT-002.3** · low · Produce Markdown-friendly links to snapshots and the interactive presenter
    - Done when: generated links point to the correct state and preserve a static fallback; `node --test architecture-diagram-renderer/tests/documentation_links.test.mjs`

- [ ] **FEAT-003** · P1 · high · Package an offline-capable interactive presentation without CDN dependencies
  - Done when: demos retain playback, zoom, search and routing with network access disabled; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/distribution.md
  - [ ] **FEAT-003.1** · mid · Vendor and pin the D3, Dagre, ELK and optional GIF runtime assets
    - Done when: checksums and licenses are verified for every bundled dependency; `node --test architecture-diagram-renderer/tests/offline_assets.test.mjs`
  - [ ] **FEAT-003.2** · high · Build a portable HTML presenter from only local trusted resources
    - Done when: blocking external requests does not break layouts or interactions and missing assets fail clearly; `node --test architecture-diagram-renderer/tests/offline_presenter.test.mjs`

- [ ] **TASK-004** · P1 · mid · Add visual and conversion regression gates for documentation exports
  - Done when: browser-rendered image and PDF fixtures are checked at document-friendly widths; `npm test`
  - Links: Ref: architecture-diagram-renderer/references/validation.md
  - [ ] **TASK-004.1** · mid · Compare SVG-as-image and PNG output across dense, nested, light and dark layouts
    - Done when: baseline screenshots detect clipping, fallback fonts and shifted arrows; `node --test architecture-diagram-renderer/tests/documentation_visual.test.mjs`
  - [ ] **TASK-004.2** · mid · Exercise PDF conversion and document-safe fallback selection
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

- [ ] **FEAT-014** · P2 · mid · Add lint rules for duplicate node, wire and boundary ids and for flow steps whose edge type matches no flow wire
  - Done when: each new rule has a negative fixture and both validators agree; `python -m unittest discover -s architecture-diagram-dsl/tests -p test_validate_transition_diagram.py`
  - Links: Ref: architecture-diagram-dsl/references/validation-and-review.md · Lane: hardening
  - State: branch todo/FEAT-014-add-lint-rules-duplicate from main; next: build children
  - [x] **FEAT-014.1** · mid · Report a node listed twice in one state as duplicate-state-node
    - Done when: both validators reject a state that lists a node twice and the rule is documented; `python -m unittest discover -s architecture-diagram-dsl/tests -p test_validate_transition_diagram.py`
  - [x] **FEAT-014.2** · mid · Report two boundaries sharing an id in one state as duplicate-boundary-id
    - Done when: both validators reject repeated boundary ids in one state and the rule is documented; `python -m unittest discover -s architecture-diagram-dsl/tests -p test_validate_transition_diagram.py`
  - [ ] **FEAT-014.3** · mid · Report two identical wires in one state as duplicate-wire
    - Done when: both validators reject wires with the same from, to, type and label and the rule is documented; `python -m unittest discover -s architecture-diagram-dsl/tests -p test_validate_transition_diagram.py`
  - [ ] **FEAT-014.4** · mid · Report a flow step whose edge type differs from the flow wire as flow-step-wire-type-mismatch
    - Done when: both validators reject a step typed differently from the wire between the same nodes and the rule is documented; `python -m unittest discover -s architecture-diagram-dsl/tests -p test_validate_transition_diagram.py`

- [ ] **TASK-015** · P2 · mid · Add integrity and crossorigin attributes to the pinned CDN script tags
  - Done when: every external script tag in template.html and translate.html carries a sha384 hash that matches the pinned file; `node architecture-diagram-renderer/tests/script_integrity_check.mjs`
  - Links: Ref: architecture-diagram-renderer/references/distribution.md · Lane: hardening
