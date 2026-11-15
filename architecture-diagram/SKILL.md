---
name: architecture-diagram
description: Single entry point for architecture diagrams. Reads the workspace to see what already exists (DSL sources, renderer models, HTML bundles, documentation snapshots) and routes to the interview, DSL, renderer or validation skill that should act next, then re-checks until the diagram set is complete. Use when the user asks for, updates, or reviews an architecture diagram and has not named a specific step.
license: Apache-2.0
---

# Architecture Diagram (aggregator)

One front door for the four architecture-diagram skills. It owns **no** diagram rules: it looks at
the workspace, decides which skill's turn it is, hands over with the exact command, and checks the
result. Every schema rule, layout rule and export rule stays in the skill that owns it.

```
interview -> DSL source -> renderer model -> HTML bundle -> documentation snapshots -> review
```

## Workflow

1. **Scan.** From the user's project folder, run the scanner. It only reads.
   ```bash
   python architecture-diagram/scripts/workspace_state.py --root . --format text
   ```
   Use `--format json` when you need the fields (`items[]`, `next`, `tooling`). Resolve the script
   from this skill's installed folder rather than assuming the current directory.
2. **Route.** Take `next.state` and look it up in the table below. Open the owning skill's
   `SKILL.md` and follow it; do not restate its rules here. When several sources exist the scanner
   already picked the most urgent one, and `items[]` lists the rest.
3. **Act with the command the scanner printed.** It names the exact script and paths for the
   state. If the user asked for something different (a new diagram, a changed relationship), the
   request wins: route by what they asked, using the scan to know what exists.
4. **Scan again.** Re-run the scanner. A step is done only when the state moved on. Repeat from 2
   until `next.state` is `complete`, the user stops you, or a step needs a decision from them.
5. **Report.** Say what changed, the artifacts now current, and what the last scan reports. Never
   call a step finished from the scanner alone: the validation skill's report is the evidence.

## Routing table

| State | Owner | What it means | Do |
| --- | --- | --- | --- |
| `empty` | `architecture-diagram-interview` | No DSL source in the workspace | Elicit facts and the diagram type, then hand the confirmed YAML to the DSL skill |
| `tooling-missing` | `architecture-diagram-dsl` | pyyaml or jsonschema (or the DSL skill) is not available | Install the dependencies named in the report, then scan again |
| `source-invalid` | `architecture-diagram-dsl` | A source has schema or lint findings | Fix the source (never the rendering), validate until clean |
| `model-missing` | `architecture-diagram-dsl` | A valid source has no renderer model | Translate it with the canonical translator |
| `model-stale` | `architecture-diagram-dsl` | The model differs from its source today | Translate again |
| `bundle-missing` | `architecture-diagram-renderer` | A current model has no HTML bundle | Build the bundle |
| `bundle-stale` | `architecture-diagram-renderer` | The bundle embeds an older model | Rebuild the bundle |
| `exports-missing` | `architecture-diagram-renderer` | A current bundle has no snapshots | Batch-export every state (needs Node and Chromium) |
| `snapshots-stale` | `architecture-diagram-renderer` | Snapshots were exported from an older model | Export again |
| `snapshots-tampered` | `architecture-diagram-validation` | A snapshot was edited, deleted or added | Verify and report the evidence, then re-export |
| `complete` | `architecture-diagram-validation` | Every artifact is current and verified | Review and report with evidence; offer documentation formats |

The same table, with the transitions, is in [references/state-machine.md](references/state-machine.md).
A test keeps this table identical to the scanner's states.

## Rules

- **Defer, don't duplicate.** If a rule is not in this file, it is in the owning skill. Read that
  skill; do not guess.
- **The YAML is the source of truth.** Never edit a model, bundle or snapshot to fix a source problem
  and never patch generated HTML to hide a defect; change the source and regenerate.
- **Preview before promoting.** When you create or overwrite files, say which ones; build new
  artifacts beside the source or in a temporary folder the user can review.
- **Missing tools are limits, not passes.** If Node or Chromium is missing the renderer exports
  cannot run: say so and stop at that step instead of reporting it done.
- **Stay in the workspace.** The scanner skips `node_modules`, `.git`, build folders and any folder
  that holds a `SKILL.md`; do not read or write outside the user's project.
- **Ask only for decisions.** Facts about the architecture come from the user or the code; layout and
  presentation defaults are yours.

## Pairs with

- `architecture-diagram-interview`: elicit facts; confirm before writing YAML.
- `architecture-diagram-dsl`: author, validate and translate the YAML source.
- `architecture-diagram-renderer`: interactive HTML, batch snapshots, documentation formats.
- `architecture-diagram-validation`: evidence-based review of sources, models and outputs.

## References

- [references/state-machine.md](references/state-machine.md): states, transitions and the exact check behind each.
- `scripts/workspace_state.py`: the read-only scanner (`--root`, `--format json|text`, `--max-files`).
- `tests/`: scanner and routing-contract tests.
