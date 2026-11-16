# Workspace state machine

The scanner (`scripts/workspace_state.py`) classifies every DSL source by how far it has got along
the pipeline. States are checked in this order for one source; the workspace's next step is the most
urgent state any source is in.

```
empty -> source-invalid -> model-missing -> model-stale -> bundle-missing -> bundle-stale
      -> exports-missing -> snapshots-stale -> snapshots-tampered -> complete
```

`tooling-missing` sits before everything: with no validator dependencies no source can be judged.

| State | How the scanner decides | Owner | Moves on when |
| --- | --- | --- | --- |
| `empty` | no file with a `dsl: transition-diagram/` header | `architecture-diagram-interview` | a confirmed source is written |
| `tooling-missing` | `pyyaml`/`jsonschema` cannot be imported, or the DSL skill's scripts are absent | `architecture-diagram-dsl` | the dependencies are installed |
| `source-invalid` | the canonical validator reports any finding, or the YAML does not parse | `architecture-diagram-dsl` | the validator is clean |
| `model-missing` | no model JSON equals the translation of the source | `architecture-diagram-dsl` | a model is written |
| `model-stale` | a model with the source's name exists but differs from today's translation | `architecture-diagram-dsl` | it equals today's translation |
| `bundle-missing` | no HTML bundle embeds the current model | `architecture-diagram-renderer` | a bundle embeds it |
| `bundle-stale` | a bundle with the source's name or title embeds a different model | `architecture-diagram-renderer` | the embedded model equals the current one |
| `exports-missing` | no snapshot folder's manifest records this model's SHA-256 or file name | `architecture-diagram-renderer` | a snapshot folder is exported |
| `snapshots-stale` | a snapshot manifest names this model file but records another SHA-256 | `architecture-diagram-renderer` | it records the current SHA-256 |
| `snapshots-tampered` | the manifest matches the model but a file is edited, missing or unlisted | `architecture-diagram-validation` | verification passes (usually after re-export) |
| `complete` | source valid; model, bundle and snapshots all current and verified | `architecture-diagram-validation` | final review is reported |

## What "current" means

- **Model**: equal, as JSON, to what `translate_transition_diagram.py` produces from the source now.
- **Bundle**: the `diagram-model` JSON embedded in the HTML is equal to that model.
- **Snapshots**: `manifest.json` (schema `architecture-diagram-snapshots/1`) records the SHA-256 of the
  model file, and every listed SVG still has its recorded SHA-256 and size with no unlisted SVG beside
  it. This mirrors `scripts/verify_snapshots.mjs` in the renderer skill.

Linking is by content first and by file name second, so artifacts may live anywhere in the workspace.

## What the scanner never does

It does not write files, run the renderer, open a browser or change the workspace. It reports; the
owning skill acts, and the scan is repeated to confirm the state moved.
