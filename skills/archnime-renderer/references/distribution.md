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
re-downloads each file to confirm the hash.

For use without a network, `assets/vendor/` holds exact copies of those same files (d3, dagre,
elkjs, gif.js and its worker, js-yaml) with their licence texts and a `manifest.json`; see its
README. Each copy's SHA-384 equals the hash pinned for its CDN URL, `offline_assets.test.mjs`
enforces that, and `scripts/vendor_assets.mjs` regenerates the directory (refusing any
download that does not match the pinned hash). The default template still loads the CDN copies; the offline build uses the vendored ones.

## Offline presentation

```bash
python archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model model.json --output diagram.html --offline
python archnime-renderer/scripts/build_bundle.py ... --offline --inline   # one self-contained file (about 2 MB)
```

### Layout stored at build time

```bash
node archnime-renderer/scripts/store_geometry.mjs model.json --output model.geometry.json
python archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model model.json --output diagram.html --geometry model.geometry.json --offline --inline   # about 0.8 to 1 MB
```

`store_geometry.mjs` (Node 24, no browser) lays out every stage in every package expansion state a
click can reach, runs the self-check, and writes the layouts as JSON. `--geometry` embeds them: the
page then places nothing, leaves the Dagre and ELK scripts out, and is ready in well under a second
whatever the diagram. Wire-style switching, package expansion, perspectives, presenter mode and
every export work from the stored layouts. The geometry is tied to the model and the engine by
hash: the build fails with `geometry file ... is stale` or `... is missing` instead of falling back
to layout in the page, and the page reports a state that has no stored layout instead of computing
one. Geometry is derived, never edited: run `store_geometry.mjs` again after any model change.

What differs from a page that lays out at run time: Tune layout is not offered; presenter mode
keeps the boundary chip at its normal size, so it reuses the same layouts; and each state has one
layout, where the run-time force layout could differ with the order of clicks. Not covered yet:
multi-view bundles (`views`), the `<architecture-diagram>` element, and a build option for Tune.
It is opt-in until those are done; without `--geometry` the build is unchanged.

`--offline` replaces every CDN `<script>` with the vendored copy (placed in `vendor/` beside the
output, or inlined with `--inline`), embeds the GIF worker source in the page, and removes the
CDN-only `integrity`/`crossorigin` attributes: trust comes from the build re-checking each
vendored file against `vendor/manifest.json`. The build fails with a clear `offline build
failed:` message if a vendored file or the manifest is missing, a file does not match its
pinned hash, or a script has no vendored copy. The result loads nothing from the network:
layout (Dagre and ELK), playback, zoom, search, routing and GIF export all work with every
non-file request blocked (`offline_presenter.test.mjs`). If a library is missing at run time
the page shows an alert naming it and the fix instead of staying blank. A browser refuses a file that does not
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
