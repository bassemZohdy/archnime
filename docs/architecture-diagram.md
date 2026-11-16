# architecture-diagram (aggregator)

`architecture-diagram` is the single entry point for the four diagram skills. It owns no diagram
rules. Given a project folder it reads the workspace, works out which step of the pipeline is next
and hands over to the skill that owns it:

```
interview -> DSL source -> renderer model -> HTML bundle -> documentation snapshots -> review
```

## The scanner

```bash
python skills/architecture-diagram/scripts/workspace_state.py --root . --format text
python skills/architecture-diagram/scripts/workspace_state.py --root . --format json
```

It only reads. It finds DSL sources (any YAML or JSON with a `dsl: transition-diagram/` header),
runs the canonical validator and translator of the sibling skills, and links each source to its
renderer model, HTML bundle and snapshot folder **by content**: a model is current when it equals
today's translation, a bundle when the model embedded in it does, and snapshots when their
`manifest.json` records the model's SHA-256 and every file still matches. Folders such as
`node_modules`, `.git`, build output and any folder holding a `SKILL.md` are skipped.

Per source it reports one state, the owning skill and the exact command:

| State | Owner |
| --- | --- |
| `empty` | `architecture-diagram-interview` |
| `tooling-missing`, `source-invalid`, `model-missing`, `model-stale` | `architecture-diagram-dsl` |
| `bundle-missing`, `bundle-stale`, `exports-missing`, `snapshots-stale` | `architecture-diagram-renderer` |
| `snapshots-tampered`, `complete` | `architecture-diagram-validation` |

The workspace's `next` step is the most urgent state any source is in. After each step the agent
scans again; the work is done when the scan says `complete` and the validation skill has reported.
The full state machine is in `skills/architecture-diagram/references/state-machine.md`, and
`skills/architecture-diagram/tests/` keeps the scanner and the skill's routing table in step.

## Install

The aggregator resolves the four domain skills as siblings of its own folder, so install them
together (for example `npx skills add bassemZohdy/diagram-skills`).
