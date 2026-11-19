# Validation

Run before every delivery:

```bash
python3 scripts/validate_transition_diagram.py path/to/diagram.yaml
python3 scripts/validate_transition_diagram.py --format json --strict diagrams/*.yaml
python3 scripts/validate_transition_diagram.py --schema custom-schema.yaml diagram.yaml
```

For the animated renderer pipeline, translate only after validation succeeds:

```bash
python3 scripts/translate_transition_diagram.py diagram.yaml --output diagram.model.json
python3 ../archnime-renderer/scripts/build_bundle.py \
  --template ../archnime-renderer/assets/template.html \
  --model diagram.model.json --output diagram.html
```

For a DSL 2.0 bundle, `--sequence`, `--mermaid` and `--show-expanded` act on
one view, chosen with `--view <id>`; without it the command stops with exit
code `2` and lists the view ids. `--view` on a single-mode document, an unknown
view id and an unreadable `--schema` file are likewise one-line errors with
exit code `2`, never a traceback.

```bash
python3 scripts/translate_transition_diagram.py bundle.yaml --view checkout --sequence
python3 scripts/translate_transition_diagram.py bundle.yaml --view context --mermaid
```

The translator keeps the YAML as the semantic source of truth, derives
renderer-only shapes from catalog types, normalizes wire shorthand, and uses
the deterministic `1600×900` canvas default when `canvas` is omitted.

Dependencies: `pyyaml`, `jsonschema>=4.18`.
```bash
pip install pyyaml jsonschema
```

Exit codes: `0` clean, `1` schema or lint errors (warnings too under
`--strict`), `2` usage/tooling error (bad file path, unparsable YAML,
missing dependency).

## Two passes

1. **Schema** -- Draft 2020-12 JSON Schema
   (`assets/schema/transition-diagram.schema.yaml`). Catches unknown or
   misspelled fields, wrong types, missing required fields, and the
   `system`/`transition`/`steps`/`scenarios`/`flow` mutual exclusion and the
   DSL 2.0 `views:` version boundary. Findings have
   `rule: schema`.
2. **Lint** -- referential rules the schema can't express, always run in
   addition to the schema pass (not gated behind a clean schema result),
   so a document with multiple unrelated problems reports all of them at
   once.

## Lint rules

| Rule | Meaning | Fix |
| --- | --- | --- |
| `mode-required` | None of `system:`, `transition:`, `steps:`, `scenarios:`, `flow:` or `views:` is present | Add one (schema also rejects this; this rule names it) |
| `yaml-parse-error` | The file is not valid YAML, so nothing else can be checked | Fix the syntax at the reported line and column |
| `unknown-catalog-ref` | A wire endpoint, package child, node id, boundary `contains` member, or `expandedPackages` id isn't a real catalog/package id | Fix the id or add the missing catalog/package entry |
| `wire-endpoint-not-in-state` | A wire endpoint exists in the catalog but is not listed in the current state's `nodes` | Add the endpoint to this state's `nodes`, or remove the wire |
| `duplicate-state-node` | The same node id is listed twice in one state's (or flow's) `nodes` | List the node once; use `set` or an override for presentation changes |
| `duplicate-boundary-id` | Two boundaries in one state, step or flow share an `id` | Give each boundary a unique id |
| `duplicate-wire` | The same wire (`from`, `to`, `type`, `label`, `layer`, `bundle`, `offset`, `priority`, `ops`) is declared twice in one state or flow | Delete the copy; give genuinely parallel wires different labels or routing |
| `duplicate-id` | The same id is used in both `catalog` and `packages`, or a `transition` state id repeats | Rename one of them |
| `duplicate-yaml-key` | A YAML mapping repeats a key that would otherwise be silently overwritten by PyYAML | Keep one definition and rename the other if both are needed |
| `wire-shorthand-parse-error` | A wire string didn't match `[<type>: ]<from> (->\|=>) <to>[: <label>]` | Fix the string, or use the full mapping form |
| `wire-shorthand-needs-quoting` | A wire entry parsed as a one-key mapping whose key contains `->`/`=>` -- almost always an unquoted shorthand string YAML misread as a mapping | Quote the whole string: `"from -> to: label"` |
| `transition-too-short` | `transition.states` has fewer than 2 entries | Use `system:` instead (schema also rejects this; this rule names it) |
| `bad-changed-ref` | A `changed` id isn't present in that state's own `nodes` | Add it to `nodes`, or remove it from `changed` |
| `frozen-field-override` | A node override sets `type` (or any field outside `label`/`detail`/`kind`/`size`) | Remove it -- type lives in `catalog` only (schema also rejects this; this rule names it) |
| `expanded-package-not-package` | An `expandedPackages` entry is a catalog id rather than a package id | Move the id to `packages`, or remove it from `expandedPackages` |
| `package-cycle` | Package nesting eventually points back to an ancestor package | Break the cycle; package nesting must be acyclic |
| `package-multiple-parents` | A package is nested under more than one package | Choose one structural parent; use boundaries for cross-cutting groupings |
| `step-base-required` | `steps.base` is missing or is not a full state | Add a complete base state with `id`, `title`, `nodes`, and `wires` |
| `step-sequence-too-short` | `steps.sequence` is empty | Add at least one cumulative step, or use `system:` for a snapshot |
| `step-add-existing-node` | A delta adds a node already present in the materialized prior state | Remove the duplicate addition or use `set` for a presentation change |
| `step-remove-absent` | A delta removes a node or `(from, to, type)` wire not present in the prior state | Match the prior materialized state, or remove the stale delta |
| `step-set-unknown-node` | A delta sets a node not present in the materialized prior state | Add the node first or correct the id |
| `step-removes-connected-node` | A delta removes a node while `changed`, `set`, or an explicit added/removed wire still references it | Let node removal drop attached wires and remove the conflicting reference |
| `scenario-base-required` | `scenarios.base` is missing or is not a full state | Add a complete base snapshot |
| `scenario-variants-too-short` | `scenarios.variants` is empty | Add at least one named variant, or use `system:` for a snapshot |
| `deployment-infrastructure-empty` | A deployment view has no infrastructure entries | Add the region/cluster/host tree |
| `deployment-unknown-infrastructure` | An infrastructure child is not declared | Add the child entry or correct the id |
| `deployment-infrastructure-cycle` | Infrastructure nesting points back to an ancestor | Break the cycle; infrastructure must be a tree |
| `deployment-infrastructure-multiple-parents` | An infrastructure node has more than one parent | Choose one physical parent |
| `deployment-unknown-component` | A placement component is not selected by the view | Add it to `view.nodes` or correct the placement |
| `deployment-unknown-target` | A placement target is not declared | Correct the infrastructure target id |
| `deployment-nonleaf-target` | A placement targets a region/cluster with children | Target a leaf host/runtime/network node |
| `deployment-replica-invalid` | `replicas` is not a positive integer | Use a positive integer replica count |
| `deployment-unplaced-component` | A selected deployment component has no placement | Add at least one placement |
| `navigation-target-unknown` | `navigateTo` points outside the v2 view bundle | Use an existing view id |
| `contains-target-unknown` | `contains` points to neither a package nor a view | Correct the package/view id |
| `views-required` | `views:` is present but empty or not a list | Add at least one view, or use a single-mode document |
| `view-invalid` | An entry of `views:` is not a mapping | Replace it with a view mapping (`id`, `mode`, `title`, ...) |
| `view-mode-required` | A view's `mode` is missing or not one of `system`, `transition`, `steps`, `scenarios`, `flow`, `deployment` | Use one of the six modes |
| `flow-step-unknown-edge` | A flow step's edge is not valid wire shorthand, names a node outside `flow.nodes`, or matches no wire in `flow.wires` (a `return` or `refused` step may reverse a wire) | Fix the edge, or add the wire it follows |
| `flow-step-wire-type-mismatch` | A flow step's edge has endpoints that match a flow wire but a different wire type (a `security:` wire followed by an untyped step), so the step binds to nothing | Write the step with the wire's type prefix, e.g. `security: a -> b` |
| `flow-step-empty` | A flow step has none of `edge`, `group`, `parallel`, `alt`, `opt` or `loop` | Give the step exactly one of them |
| `flow-return-no-forward` | A `kind: return` or `kind: refused` step has no earlier forward call over the same wire; inside an `alt`, each branch starts from the calls made before the `alt`, so a reply cannot answer a call only another branch made | Add the call step first, or change the step's `kind` |
| `flow-guard-else` | `when: else` is used on an `opt`, a `loop`, or an `alt` branch that is not the last | Name the condition, or move the `else` branch last |
| `flow-phase-nested` | A step inside `parallel` or a fragment (`alt`, `opt`, `loop`) sets `phase` | Put `phase` on the top-level step that starts it |
| `deployment-duplicate-placement` | The same `(component, target)` pair is placed more than once | Combine the placements into one and use `replicas` |
| `comparison-requires-views` | `meta.comparison` is set on a document without a `views:` bundle | Use `transition-diagram/2.0` with `views:` |
| `comparison-duplicate-criterion` | Two comparison criteria share an `id` | Give each criterion a unique id |
| `comparison-recommended-unknown` | `meta.comparison.recommended` is not a view id | Name an existing view, or remove it |
| `comparison-criterion-unknown` | A view's `comparison.tradeoffs` names a criterion that `meta.comparison.criteria` does not declare | Declare the criterion, or correct the key |
| `comparison-rating-invalid` | A tradeoff `rating` is not a number from 0 to 5 | Use a rating from 0 to 5 |
| `source-path-unsafe` | A `source` is absolute, a URL, leaves the project root, enters `.git` or a credentials folder (`.ssh`, `.aws`, ...), or names a file that commonly holds secrets (`.env`, `*.pem`, `*.key`, `id_rsa`, `.npmrc`, `credentials`, `secrets.*`) | Name the code file that makes the part or line, relative to the project root; never point a diagram at a secret |
| `reader-contract-incomplete` | Warning. `meta.reader` has fewer than 3 or more than 5 questions, or no `idea` | Write the 3 to 5 questions the reader must answer from the diagram alone and the one idea it must make obvious |
| `evidence-source-missing` | Warning. `meta.evidence` is `code` or `document`, yet a catalog entry (other than an `actor` or `external`) or a wire has no `source` | Name the file (or the sentence) behind it; write the wire as a mapping to carry it. What no file backs is a gap for the report, not a box |
| `theme-contrast` | A `meta.theme` colour leaves text under 4.5:1 or a wire, node outline or boundary line under 3:1 against what it is drawn on, in that scheme (WCAG 2.1, 1.4.3 and 1.4.11) | Darken or lighten that colour, or the background it names, until the pair passes; the message gives the ratio |
| `density-budget` | Warning. One state, view or flow lists more than 12 nodes or 16 wires (or the budget in `meta.density`) | Merge parts with the same relations, use packages or disclosure, or split into views; raise `meta.density` only when the density is the point |
| `lint-internal-error` | The lint pass hit an unexpected exception on malformed input | Should not happen on a schema-valid document; report it |

## Checking sources against the code

`source` on a catalog entry, node override, wire mapping or flow step names
the file that backs it: `path`, `path:line`, `path#quoted words`,
`path:line#quoted words`, or the mapping `{ path, line, quote }`. The
validator checks only the shape and that the path is safe. Whether the code
is still there is a separate, file-reading check, run from the project root:

```bash
python3 scripts/check_sources.py diagram.yaml --root .
python3 scripts/check_sources.py --format json diagrams/*.yaml
```

It reports, each with the path of the `source` in the YAML:

- **source-path-unsafe**: as above, plus a path that leaves the root through a
  link or junction. The file is never opened.
- **source-missing**: no file at that path any more.
- **source-line-out-of-range**: the line is past the end of the file.
- **source-quote-missing**: the quoted words are no longer in the file
  (runs of whitespace match any whitespace, so re-indenting is not a change).

Only whether each file holds the words is kept; nothing from the files is
printed. Exit code `1` when anything is reported. The check cannot see what
the code gained: after it passes, walk the code again for new parts. When it
fails, find where the code went and move the source, or remove the part or
line no code backs any more; never delete the `source` to make it pass.

## Review procedure for an existing document

- Re-run the validator; fix everything it reports.
- Confirm every `catalog` entry that appears in more than one state keeps
  one stable id (never a second id for the same component).
- Confirm no node override anywhere sets `type`.
- Confirm every wire endpoint appears in the same state's `nodes`, and every
  `expandedPackages` entry names a package rather than a catalog node.
- Confirm package nesting is acyclic and each package has at most one parent;
  use boundaries for cross-cutting ownership or trust scopes.
- For a `transition:` document, confirm `changed` in each state names only
  what actually differs from the previous state -- not everything that
  happens to appear in both.
- For a v2 `views:` document, confirm view ids are stable and unique, node/step
  navigation targets exist, and `contains` is reserved for a package or view.
- For a deployment view, confirm every selected component is placed on a
  declared leaf target, infrastructure is acyclic, and replica counts are
  intentional before translating to physical instance IDs.
