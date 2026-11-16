---
name: archnime-dsl
description: Author and validate renderer-independent architecture-diagram YAML for a system snapshot or multi-stage migration. Use when the semantic source must be machine-readable, with components, packages, boundaries, and typed wires; pair with archnime-renderer for interactive HTML/SVG output.
license: Apache-2.0
---

# Architecture Diagram DSL

Author one YAML document — `dsl: transition-diagram/1.0` for a single root mode,
or `dsl: transition-diagram/2.0` for a multi-view bundle — that describes
either a single system snapshot (`system:`), an ordered transition
(`transition:`), a delta-authored transition (`steps:`), named variants
(`scenarios:`), a fixed-topology walkthrough (`flow:`), or a set of these plus
deployment views under `views:`. The YAML is the semantic source of truth and
is independent of any renderer.

## Workflow

1. **Gather the architecture.** Identify every catalog component, semantic type, lifecycle kind (`existing`, `new`, `mixed`, or `retired`), useful packages, and ownership/trust/compliance boundaries.
2. **Choose the mode.** Use `system:` for one state, `transition:` with two or more full states for a current-to-target sequence or migration, `steps:` when that sequence is clearer as cumulative deltas, `scenarios:` for named non-sequential variants of one base, or `flow:` when one topology should be followed through ordered calls, returns, groups, and parallel work. Use v2 `views:` when several perspectives share the same catalog, and `mode: deployment` for physical placement across infrastructure.
3. **Write the wires.** Use shorthand from `references/wire-shorthand.md` when possible; use full mappings when a wire needs `layer`, `bundle`, `offset`, or `priority`.
4. **Write the YAML.** Start from `assets/templates/diagram-skeleton.yaml` and keep semantic identity in `catalog`, packages, boundaries, states, and wires.
5. **Validate.** Run the bundled schema and referential validator and fix every finding:
   ```bash
   cd /path/to/archnime-dsl && python3 scripts/validate_transition_diagram.py path/to/diagram.yaml
   ```
   Read `references/validation-and-review.md` for the rule list and exit codes.
6. **Deliver.** Hand over the validated YAML plus a short narrative of what it describes and any assumptions or placeholders.

## Pairing with archnime-renderer

When HTML/SVG output is requested, keep this YAML as the semantic source and
create a checked renderer derivative:

1. Validate the YAML.
2. Run `scripts/translate_transition_diagram.py` to normalize the DSL into renderer JSON. Translation is blocked when validation fails.
3. Preserve catalog, package, boundary, state, and normalized wire identities. Keep coordinates and other layout-only choices in the renderer derivative.
4. Build the HTML with `archnime-renderer/scripts/build_bundle.py`, then run the renderer's bounded visual and interaction audit.

The command examples in this file assume the archnime-dsl skill
directory. For installed
skills, resolve each script from its installed skill directory rather than
assuming the current working directory.

## Pairs with archnime-interview

Use `archnime-interview` when the architecture facts or mode are
not yet pinned down. It produces the confirmed fact ledger and hands the
semantic source here for validation; this skill owns the schema and
referential rules. For deeper tradeoff reasoning, an available
`engineering:system-design` or `engineering:architecture` skill is an
optional companion, not a replacement for validation.

For a non-destructive preview, generate YAML, the translated model, and the
HTML bundle in a dedicated temporary directory. Verify generated files and
review the validation report before copying any artifact into the project.

## Conventions

- **Identity is fixed in `catalog`.** The same ID across states means the same component. Use `changed` for meaningful architectural changes, not every new caller.
- **`shape` does not exist in this DSL.** The renderer derives the icon from the stable semantic `type`.
- **Wire types** are `data`, `security`, `control`, `compat`, and `neutral`; the default is `data`. Optional `ops: true` tags catalog nodes, overrides, wires, packages, boundaries, or deployment infrastructure for the renderer's Operations perspective.
- **Perspectives** are controlled by optional `meta.perspectives`; the default user-facing set is `all`, `data`, `security`, `migration`, and `devops`. Advanced IDs `control`, `compat`, `neutral`, and `zones` remain available for explicit expert views. When present, the list is authoritative; the renderer adds only the `All` option to the perspective dropdown.
- **Packages** express hierarchy as one acyclic tree. Keep grouping shallow and do not package a single node.
- **Layout hints** stay renderer-neutral: use `meta.layout: auto` by default;
  the renderer selects ELK for deeply nested compound packages, dagre for
  acyclic fan-out/reconvergence backbones, and force for genuinely peer-like
  meshes with irreducible cycles. Use an
  explicit layout only when the presentation constraint is part of the
  diagram's intent; never put renderer coordinates in the DSL.
- **Boundaries** express ownership, trust, or compliance via `contains`; they are not structural packages and have no renderer coordinates.
- **Flows** keep one fixed topology and express the narrative separately in ordered `steps`; use `return` only for a reverse of an earlier call, and use `group`/`parallel` when the viewer should see concurrency rather than inventing extra stages.
- **Steps** are cumulative deltas over a full `base` state. Use `add`, `remove`, and `set`; the translator materializes every result into ordinary full stages so renderer behavior stays identical to `transition:`.
- **Scenarios** are independent named overlays over one `base`; set `meta.composition: scenarios` so the renderer presents a variant selector rather than sequential playback.
- **Views** are ordered v2 records over one shared `catalog` and `packages`. `navigateTo` swaps the URL-selected view, `expandedPackages` makes a package's selected leaf nodes visible by default, while `contains` targets either a view or a package for double-click/Enter drill-down.
- **Deployment views** map selected catalog components to leaf infrastructure targets. Replica IDs are deterministic and selector-safe (`component-target-1`, `-2`, ...); one representative physical wire preserves each logical relationship without drawing an N×M replica fan-out. Do not model physical hosts as catalog types.
- Selecting a rendered node focuses the view to `meta.focusHops` hops (default
  `1`) without changing layout; press Escape or select it again to restore the
  full view.

## References

- `references/dsl-reference.md`: every field, required or optional, type, and default.
- `references/composition.md`: the v2 `views:` composition, deployment, and drill-down contract.
- `references/wire-shorthand.md`: the shorthand grammar.
- `references/migration-from-model.md`: mapping from the renderer model to this DSL.
- `references/validation-and-review.md`: validator usage, exit codes, and lint rules.
- `references/runtime.md`: canonical Python CLI, browser mirror, dependency policy, and parity test.
- `references/sequence-policy.md`: accepted policy for the Mermaid sequence companion.
- `assets/examples/one-shot-checkout.yaml`: a complete `system:` document.
- `assets/examples/strangler-migration.yaml`: a complete `transition:` document.
- `assets/examples/strangler-migration-steps.yaml`: the same migration authored with `steps:`; its translated MODEL is byte-identical to the transition example.
- `assets/examples/steps-refinement.yaml`: a minimal `steps:` document refining one component's `kind` and `detail` through cumulative `set` deltas.
- `assets/examples/orders-failover-scenarios.yaml`: a `scenarios:` document with two independent variants and non-sequential controls.
- `assets/examples/checkout-flow.yaml`: a complete `flow:` walkthrough with returns, grouping, parallel work, and a retry loop.
- `assets/examples/commerce-views.yaml`: a v2 multi-view bundle with context, deployment replicas, and checkout navigation.
- `assets/examples/comparison-views.yaml`: a v2 comparison bundle with weighted criteria and per-option tradeoffs.
- `scripts/`: executable validator and renderer-model translator.
- `tests/`: translator regression tests.
