# Client distribution decision

## Current decision

Keep the renderer as vendored, side-by-side JavaScript files for now:

- `architecture-library.js` owns the visual language and built-in icons.
- `diagram-engine.js` owns layout, hierarchy, and self-check.
- `architecture-diagram-element.js` is the optional browser custom element.
- `template.html` remains the canonical page renderer and source used by the
  custom element.

`build_bundle.py` keeps this multi-file form as its default and offers
`--inline` for a one-file handoff. Do not publish an npm package or CDN entry
until a second real consumer needs to import the engine independently of this
repository. `--inline` is single-file delivery, not an offline guarantee: the
canonical template still loads D3, dagre, ELK, GIF, and the GIF worker from
configured runtime URLs. A genuinely offline deployment must vendor those
dependencies and update the template's dependency policy explicitly.

Those runtime scripts are pinned twice: by exact version in the URL, and by a
`sha384` Subresource Integrity hash (with `crossorigin="anonymous"`) on every
`<script>` tag in `template.html` and `translate.html`. The GIF worker, which is
fetched instead of loaded by a tag, passes the same kind of hash to `fetch()`.
`assets/cdn-integrity.json` lists every hash, `npm run check-integrity` keeps the
pages and the list in step, and `VERIFY_CDN_INTEGRITY=1 npm run check-integrity`
re-downloads each file to confirm the hash. A browser refuses a file that does not
match, so a changed or mis-served CDN file fails closed instead of running.

## Reconsider publishing when

| Signal | Vendored files remain best when… | A package becomes worthwhile when… |
| --- | --- | --- |
| External consumers | only this repository and one-off generated diagrams use the code | at least two maintained external consumers need upgrades or reuse |
| API stability | `DiagramEngine` and the element are still changing with the DSL | a documented public API and compatibility policy can be supported |
| Release ownership | no one owns versioning, changelogs, npm provenance, and CDN publishing | an owner can commit to semver, release automation, and rollback |
| Documentation | usage is repository-local and examples travel with the files | external users need versioned API docs, migration notes, and examples |
| Dependency policy | pinned CDN scripts and zero-build delivery are the priority | package consumers need import maps, bundler exports, or integrity-pinned assets |
| Cost/benefit | copying three small files is simpler than maintaining a registry | deduplicated upgrades and shared integrations outweigh registry overhead |

The package boundary is already clean: consumers can depend on the engine,
library, or custom element without importing the Python DSL translator. If the
threshold is reached, publish the three browser artifacts together under one
version, retain a browser-global build for no-build users, and keep
`build_bundle.py --inline` as the archival/single-file path.

## Imported icon trust boundary

`meta.icons` is model data, not trusted page markup. The renderer accepts only
the small SVG geometry allowlist used by built-in icons (`path`, `rect`,
`circle`, `ellipse`, `line`, `polygon`, and `polyline`) and safe geometry/style
attributes. Event attributes, scripts, external references, CSS URLs, and
other SVG elements are removed before insertion into `<symbol>`. An icon that
has no safe content renders without a custom glyph; callers needing richer
assets must ship a trusted renderer/library integration rather than embedding
active markup in the model.
