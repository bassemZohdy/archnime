# archnime-dsl

Author, validate, and review architecture diagrams written in the
**Transition Diagram DSL** -- a versioned YAML format (`dsl:
transition-diagram/1.0` for one root mode or `transition-diagram/2.0` for a
multi-view bundle) for architecture snapshots, migrations, flows, and
deployment placement. The deliverable is one validated YAML document; this
skill does not render a diagram.

- **Skill directory:** [`skills/archnime-dsl/`](../skills/archnime-dsl/)
- **Entry file:** [`SKILL.md`](../skills/archnime-dsl/SKILL.md)
- **Pairs with:** [`archnime-renderer`](archnime-renderer.md),
  which turns the validated model into an interactive HTML/D3 derivative using
  the shared IDs and semantics. The renderer owns layout-only geometry, bounded
  retry policy, caption placement, and browser interaction validation.

---

## 1. When this skill applies

Load it when the request is to write, generate, edit, or validate an
architecture-diagram YAML file, or describes an architecture "current
state" / "target state" / "migration" / "strangler" diagram as data
rather than as rendered HTML.

## 2. Current modes

- **`system:`** -- one state, no transition. Replaces having to force a
  single-state diagram through a one-element list.
- **`transition:`** -- an ordered sequence of 2 or more full states (not
  diffed against each other -- every state is self-contained).
- **`steps:`** -- a full `base` state plus a cumulative `sequence` of `add`,
  `remove`, and `set` deltas; the translator materializes the same full stages
  as `transition:`.
- **`scenarios:`** -- one full `base` state plus independent named variants;
  each variant is materialized from the base, not from the preceding variant.
- **`flow:`** -- one fixed topology with an ordered communication walkthrough.

A 1.0 document has exactly one of these modes. A 2.0 document uses a
versioned `views:` array over shared `catalog` and `packages`; it may include
`mode: deployment` for physical placement. A comparison is represented by
the same v2 views plus `meta.comparison`, rather than a separate root mode.
See
[`references/composition.md`](../skills/archnime-dsl/references/composition.md).

## 3. Vocabulary at a glance

| Section | Purpose |
| --- | --- |
| `meta` | title, layout engine hint, minimum wire length, authoritative perspective dropdown options, C4 breadcrumb levels, focus radius, flow presentation, GIF export caps, and optional comparison criteria |
| `canvas` | optional logical SVG size |
| `catalog` | every component: `label`, `type` (semantic, drives the icon), `kind` (lifecycle), `detail`, `size`, `level`, optional `ops` signal, `variant: external` (someone else runs it) and `source` (the file behind it) |
| `packages` | optional nesting of catalog/package ids into groups |
| `system` / `transition.states[]` / `steps` / `scenarios` / `flow` | the actual state(s), cumulative or independent delta-authored states, or fixed flow: `nodes`, `wires`, `boundaries`, optional `disclosure`/`steps` |
| `views[]` | v2 ordered `system`, `transition`, `steps`, `scenarios`, `flow`, or `deployment` perspectives over shared identity; comparison options use this same structure |

There is no `shape` field -- the icon always comes from `type`. Types include `llm`, `vector-store` and `tool` for AI systems. A
per-state node override may only touch `label`, `detail`, `kind`, `size`, `ops`, `variant`, `source`, and
v2 `navigateTo` -- never `type`, which is identity and lives in `catalog`
alone. `contains` targets a package or view for drill-down; a deployment
placement targets a declared infrastructure leaf.

For a comparison bundle, put the candidate architectures in separate v2
`views[]` records and describe the decision in `meta.comparison`: criteria,
optional weights, and the recommended view. A view may add per-criterion
ratings or trade-off notes. Keep the catalog shared so common components retain
identity while options are switched.

## 4. Wires

Full mapping form (`{ from, to, type, label, flow, layer, bundle, offset,
priority }`) or a terser shorthand string:

```yaml
wires:
  - "orders -> ordersdb: SQL"              # data
  - "orders => events: publish"            # data, animated
  - "security: gateway -> idp: token check"
```

See [`references/wire-shorthand.md`](../skills/archnime-dsl/references/wire-shorthand.md) in the skill directory for the full grammar.

## 5. Validating a document

```bash
python3 skills/archnime-dsl/scripts/validate_transition_diagram.py path/to/diagram.yaml
```

Two passes -- JSON Schema (Draft 2020-12) for structure and types, then a
referential lint pass (dangling ids, duplicate ids, wire-shorthand
parsing, frozen-field overrides, and more) for what schema can't express.
Exit codes: `0` clean, `1` errors found, `2` usage/tooling error. Full
rule table in [`references/validation-and-review.md`](../skills/archnime-dsl/references/validation-and-review.md).

Dependencies: `pyyaml`, `jsonschema>=4.18` -- identical to what
`open-workflow-dsl`'s validator already requires.

To create the renderer derivative after validation:

```bash
python3 skills/archnime-dsl/scripts/translate_transition_diagram.py path/to/diagram.yaml --output path/to/diagram.model.json
python3 skills/archnime-renderer/scripts/build_bundle.py --template skills/archnime-renderer/assets/template.html --model path/to/diagram.model.json --output path/to/diagram.html
```

The translator preserves semantic identities, normalizes wire shorthand,
derives renderer shapes from DSL types, maps `size` to `w`/`h`, and supplies a
deterministic `1600×900` canvas when the optional DSL canvas is omitted.
For `flow:` documents, pass `--sequence` to emit a Mermaid
`sequenceDiagram` companion alongside the normal architecture projection.
A flow step can also hold an `alt` (one of two or more guarded branches), an
`opt` (steps that run only when a guard holds) or a `loop` (steps that
repeat), and a top-level step can open a named `phase`; the presenter, the
sequence SVG and the Mermaid companion all show the guards and phases.

## 6. Examples

- `assets/examples/one-shot-checkout.yaml` -- a complete `system:` document exercising every wire shorthand form.
- `assets/examples/strangler-migration.yaml` -- a complete `transition:` document (3 states, two sibling nested packages, a security boundary).
- `assets/examples/strangler-migration-steps.yaml` -- the same 3-state migration authored with cumulative deltas.
- `assets/examples/steps-refinement.yaml` -- a minimal `steps:` document refining one component's `kind` and `detail` through cumulative `set` deltas.
- `assets/examples/orders-failover-scenarios.yaml` -- a shared steady-state base with two independent failover variants.
- `assets/examples/checkout-flow.yaml` -- a fixed-topology request walkthrough.
- `assets/examples/sign-in-sequence.yaml` -- a sign-in flow in three phases with an `opt`, a nested `loop` and an `alt` whose `else` branch is refused.
- `assets/examples/agent-refusal-flow.yaml` -- an agent flow with a hosted model (`variant: external`), a vector store, a tool, and a `refused` reply.
- `assets/examples/commerce-views.yaml` -- a v2 context/deployment/flow bundle with replicas and navigation.
- `assets/examples/comparison-views.yaml` -- a v2 comparison bundle with weighted criteria and per-option trade-offs.

## 7. Relationship to archnime-renderer

This DSL is renderer-agnostic by design: validating it proves the document is
structurally and referentially sound, never that a rendered layout will be
collision-free. That is a layout-time question answered by
`diagramSelfCheck()` on an actual rendered diagram, not by a static validator.
The paired renderer preserves catalog, package, boundary, stage, node, and
normalized wire identities; it derives shapes from `type`, maps secondary-flow
metadata, preserves wire bundle/offset/priority metadata, and keeps layout-only
geometry in the HTML derivative. Its check
matrix exercises collapsed, configured, per-package, nested, pairwise, and
all-expanded states with bounded retries, including package/boundary caption
overflow and collision checks. Interactive package overrides are scoped to the
current stage, and a collapsed ancestor takes precedence over nested expansion.

For a temporary end-to-end preview, pair the DSL with
an optional external sandbox runner and keep the YAML and translated model
under `.sandbox/archnime/<slug>/` until the browser review passes.
