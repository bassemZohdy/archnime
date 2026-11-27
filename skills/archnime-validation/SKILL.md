---
name: archnime-validation
description: Review and validate architecture-diagram sources, normalized models, and rendered outputs across semantic, structural, visual, interaction, and delivery contracts. Use when checking a diagram, renderer derivative, diagram skill, or validation workflow; do not use it as a diagram authoring skill.
license: Apache-2.0
---

# Architecture Diagram Validation

Validate the diagram as a chain of contracts rather than as a screenshot alone:

`semantic source → normalized model → rendered artifact → user interaction`

The source model is authoritative. A renderer, export, or sandbox report must
not silently redefine component identity, relationships, hierarchy, scope, or
flow meaning.

## Scope

Use this skill to review one or more of:

- a structured architecture-diagram source;
- a translated or normalized renderer model;
- an HTML/SVG or embedded diagram;
- a diagram skill, validator, fixture set, or sandbox validation workflow.

Do not invent domain facts, component identities, boundaries, perspectives,
layout directions, or acceptance criteria that are not present in the source or
requested by the user. Treat examples and regression fixtures according to their
declared intent: a fixture may be expected to fail a specific check.

## Validation workflow

1. **Identify the contract.** Determine the source format, supported modes,
   renderer/model contract, expected outputs, and whether the input is a
   positive example, a negative fixture, or a regression case.
2. **Validate the semantic source.** Run the format's canonical validator.
   Check schema shape, required fields, stable identities, references,
   lifecycle meaning, hierarchy acyclicity, boundary membership, relationship
   endpoints, and mode-specific rules.
3. **Validate translation parity.** If a derivative exists, compare source and
   model semantics: IDs, labels, types, packages, boundaries, stages/views,
   relationships, and ordered flow steps. Layout coordinates may differ, but
   semantic loss or invention is a failure.
4. **Validate geometry.** Run the renderer self-check for every stage/view and
   representative disclosure, expansion, collapse, or deployment state. Check
   node and container overlap, boundary containment, label placement, routes,
   overflow, minimum spacing, and stable identity across transitions. Shared or
   nested boundaries may overlap when their memberships make that semantically
   correct; distinguish that from unreadable labels or false containment.
   For directional graphs, verify upstream/downstream rank order after
   cleanup and verify that explicit trust boundaries exclude foreign nodes.
   For every route mode, distinguish the requested wire family from the
   actual painted geometry and record any fallback reason. Layout is computed
   when the diagram is built and stored in the page; the page loads no layout
   library, so backend comparison is a build-time check. When ELK is available
   to the build, compare the same model built under its selected automatic
   or explicit ELK layout and under dagre; a new issue class, missing
   node, or changed semantic scope is a failure. If ELK is unavailable, report
   the backend parity check as an environment limitation rather than a pass.
5. **Validate behavior.** Exercise the available controls and meaningful
   states: navigation, search/focus, hierarchy disclosure, perspective/filter
   changes, zoom/fit, keyboard access, reduced motion, responsive sizing,
   exports, and embedded/static modes. Tune layout is a build option
   (`build_bundle.py --tune` or `store_geometry.mjs --tune`), not a control in
   the page: after a tuned build, confirm node identity, package/boundary
   membership, wire endpoints, and self-check status are unchanged or improved
   compared with the untuned build. Do not claim browser validation
   when the required browser runtime is unavailable.
6. **Validate documentation fidelity.** For any documentation handoff,
   validate the static documentation SVG independently from the interactive
   presenter: fit-to-content geometry independent of zoom, the embedded font,
   opaque background, SVG image loading, accurate selected view/stage, and
   readable text after embedding at actual target width. Do not treat
   successful animation in a browser as evidence it works in GitHub, PDF,
   Word, or Google Docs. Demand stage snapshots and a viewer link when the
   architecture requires an interactive walkthrough. Refer to the renderer's
   `references/documentation-export.md`.
7. **Validate delivery.** Confirm generated files are reproducible, sidecars
   resolve, examples remain available, expected-failure fixtures fail for the
   intended rule, and no generated artifact was patched to conceal a defect.
   Use a dedicated temporary workspace for previews and report the actual
   isolation/validation guarantees before retaining artifacts.

## Command map and evidence routing

Run commands from the repository root in a checkout, or replace each path with
the corresponding installed skill directory. Use the paired skill's canonical
tool for the input contract:

| Input | Command | Evidence |
| --- | --- | --- |
| Architecture YAML | `python3 archnime-dsl/scripts/validate_transition_diagram.py <source.yaml> --format json` | schema/lint findings and exit code |
| Arbitrary YAML/JSON/HTML artifact | `python3 archnime-validation/scripts/validate_artifact.py <path> --format json` | machine-readable `PASS`, `FAIL`, `SKIP`, or `UNSUPPORTED` report |
| Validated YAML to model | `python3 archnime-dsl/scripts/translate_transition_diagram.py <source.yaml> --output <model.json>` | normalized IDs, wires, views, and stages |
| Portable model to HTML | `python3 archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model <model.json> --output <diagram.html>` | reproducible bundle with the layouts stored in it (computed at build time; needs Node.js 24+ on `PATH`), plus sidecars or explicit inline delivery mode; self-check findings are printed as warnings |
| Rendered artifact | `node archnime-renderer/tests/render_check.mjs [name]` | self-check, geometry, interaction, and backend results |
| Browser translation/parity | `node archnime-renderer/tests/translate_check.mjs` | positive examples, expected invalid findings, and model parity |
| Expected failure | run the canonical validator against the declared fixture | the named error is expected; unrelated errors are not |

Record `PASS`, `FAIL`, `SKIP`, and `UNSUPPORTED` separately. A browser or ELK
check without its runtime is an environment limitation, never a pass. For a
temporary run, place source, model, HTML, browser output, and the sandbox
`REPORT.md` below `.sandbox/<purpose>/<slug>/` and retain the report with the
commit and runtime used.

`validate_artifact.py` accepts a user-supplied `.yaml`, `.json`, or generated
`.html` path without copying it into the repository fixture set. Its JSON
report validates YAML through the canonical DSL validator, validates portable
model structure and stage references, and extracts the embedded model from
HTML. HTML geometry and interaction remain explicit limitations until the
renderer browser harness is run.

## Genericity rules for validation skills

- Keep domain vocabulary, perspective names, node IDs, and fixture names out
  of reusable validation logic unless they are supplied by the input contract.
- Prefer capability detection and the repository's canonical scripts over
  assumptions about paths, package managers, browsers, containers, or layout
  engines.
- Treat D3 as a presentation/runtime concern and ELK, dagre, or force as
  replaceable build-time layout backends. Validation should compare their semantic and
  geometry contracts, not require one backend's coordinates.
- Report unsupported checks separately from failures. A skipped browser or
  container check is an environment limitation, not a passing result.
- Treat a visual complaint as a diagnosis question: semantic overlap,
  intentional cross-cutting scope, layout collision, label collision, and
  rendering failure have different remedies.
- Fix the source, model translator, shared layout engine, or template at the
  reusable layer. Never edit generated HTML only to make one case look clean.
- Preserve user changes and keep validation artifacts isolated from the real
  workspace unless the user explicitly asks to promote them.

## Report format

Return a concise evidence-based report containing:

- inputs and versions/commit used;
- checks executed and their results;
- positive examples and expected-failure fixtures covered;
- findings grouped by semantic, translation, geometry, interaction, or
  environment cause;
- exact artifact or source locations for failures;
- limitations and unexecuted checks;
- a final verdict: **pass**, **conditional pass**, or **fail**.

An artifact is a **conditional pass** when all executed checks pass but one or
more required checks were unavailable. A negative fixture is successful only
when it fails with the declared rule and does not introduce unrelated findings.

## Pairing

- Pair with `archnime-dsl` for source validation and translation.
- Pair with `archnime-renderer` for layout, interaction, and export
  validation.
- Preview changes in a dedicated scratch workspace and review outputs before promotion.
- Use `skill-creator` when this skill itself is being created or revised, then
  run its structural validator and a realistic independent review when the
  change is substantial.
