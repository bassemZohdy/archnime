# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **TASK-016** (test): Poll for flow-step state instead of fixed waits in render_check so full-suite runs stop flaking. Ref: architecture-diagram-renderer/tests/README.md. Validated: `node architecture-diagram-renderer/tests/render_check.mjs checkout-flow`.

### Fixed

- **FIX-007** (fix): Measure documentation SVG bounds with the presenter viewport transform removed so pan/zoom cannot shift the rounded viewBox. Ref: architecture-diagram-renderer/references/documentation-export.md. Validated: `node architecture-diagram-renderer/tests/render_check.mjs checkout-flow`.
