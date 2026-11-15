# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **FEAT-014** (feat): Add lint rules for duplicate node, wire and boundary ids and for flow steps whose edge type matches no flow wire. Ref: architecture-diagram-dsl/references/validation-and-review.md. Validated: `python -m unittest discover -s architecture-diagram-dsl/tests -p test_validate_transition_diagram.py`. Docs: updated architecture-diagram-dsl/references/validation-and-review.md. Includes: FEAT-014.1, FEAT-014.2, FEAT-014.3, FEAT-014.4.

### Changed

- **TASK-015** (feat): Add integrity and crossorigin attributes to the pinned CDN script tags. Ref: architecture-diagram-renderer/references/distribution.md. Validated: `node architecture-diagram-renderer/tests/script_integrity_check.mjs`. Docs: updated architecture-diagram-renderer/references/distribution.md, architecture-diagram-renderer/tests/README.md.
- **TASK-013** (test): Document every lint rule and guard the list with a contract test. Ref: architecture-diagram-dsl/references/validation-and-review.md. Validated: `python -m unittest discover -s architecture-diagram-dsl/tests -p test_rule_docs.py`. Docs: updated architecture-diagram-dsl/references/validation-and-review.md.
- **TASK-012** (test): Close test-gate gaps so example drift cannot pass npm test. Ref: architecture-diagram-renderer/tests/README.md. Validated: `npm run test:python`. Docs: updated docs/architecture-diagram-renderer.md. Includes: TASK-012.1, TASK-012.2.
- **TASK-016** (test): Poll for flow-step state instead of fixed waits in render_check so full-suite runs stop flaking. Ref: architecture-diagram-renderer/tests/README.md. Validated: `node architecture-diagram-renderer/tests/render_check.mjs checkout-flow`.

### Fixed

- **FIX-011** (fix): Print each finding and a distinct SKIP result in validate_artifact text output. Ref: architecture-diagram-validation/SKILL.md. Validated: `python -m unittest discover -s architecture-diagram-validation/tests -p test_validate_artifact.py`.
- **FIX-010** (fix): Reject docs and adr links whose scheme is javascript, data or vbscript even when obfuscated with control characters. Ref: architecture-diagram-renderer/references/validation.md. Validated: `node architecture-diagram-renderer/tests/link_safety_check.mjs`. Docs: updated architecture-diagram-renderer/tests/README.md.
- **FIX-009** (fix): Emit Mermaid companions that parse and keep authored labels, and give the translate CLI clean errors. Ref: architecture-diagram-dsl/references/sequence-policy.md. Validated: `python -m unittest discover -s architecture-diagram-dsl/tests -p test_translate_transition_diagram.py`. Docs: updated architecture-diagram-dsl/references/validation-and-review.md, architecture-diagram-dsl/references/sequence-policy.md. Includes: FIX-009.1, FIX-009.2.
- **FIX-008** (fix): Make the browser validator and translator agree with the Python reference on valid, invalid and malformed input. Ref: architecture-diagram-dsl/references/runtime.md. Validated: `node architecture-diagram-dsl/tests/browser_validator_check.mjs`. Docs: updated architecture-diagram-dsl/references/dsl-reference.md. Includes: FIX-008.1, FIX-008.2, FIX-008.3.
- **FIX-007** (fix): Measure documentation SVG bounds with the presenter viewport transform removed so pan/zoom cannot shift the rounded viewBox. Ref: architecture-diagram-renderer/references/documentation-export.md. Validated: `node architecture-diagram-renderer/tests/render_check.mjs checkout-flow`.
