# Migrating from the architecture-diagram-renderer model

`architecture-diagram-renderer` has its own JSON/YAML renderer model
(`architecture-diagram-renderer/references/data-model.md`). This table maps
every field to its equivalent here. After validation, run
`scripts/translate_transition_diagram.py` to produce the renderer model, then
run `architecture-diagram-renderer/scripts/build_bundle.py` to create the HTML
bundle. The YAML remains the semantic source of truth; coordinates and other
layout-only fields stay in the derivative.

| Old model | This DSL | Notes |
| --- | --- | --- |
| `meta.*` | `meta.*` | same fields, same meaning |
| `canvas` | `canvas` | unchanged, still optional |
| `catalog.<id>.shape` | *(removed)* | always derived from `type` now |
| `catalog.<id>.type`/`kind`/`label`/`detail`/`w`/`h`/`level` | same, except `w`/`h` become `size: [w, h]` | |
| `packages.<id>` | `packages.<id>` | unchanged shape |
| `stages: [ { ...single entry... } ]` (one-shot workaround) | `system: { ... }` | the one-element-array workaround is gone |
| `stages: [ ... ]` (2+ entries) | `transition.states: [ ... ]` | same per-state shape (`id`, `title`, `summary`, `changes`, `callout`, `boundaries`, `nodes`, `wires`, `changed`, `disclosure`, `expandedPackages`, `layout`) |
| `stages[].nodes[].{label,detail,kind,w,h}` override | `nodes[].{label,detail,kind,size}` override | `type` was never overridable in the old model either -- this DSL just enforces it structurally |
| `wires[]` full mapping | `wires[]` full mapping | identical fields; `type` default is `data` in both |
| `wires[]` (always full mapping) | `wires[]` (shorthand string *or* full mapping) | shorthand is new, see `wire-shorthand.md` |
| `boundaries[]` | `boundaries[]` | unchanged (`contains` form recommended in both) |
