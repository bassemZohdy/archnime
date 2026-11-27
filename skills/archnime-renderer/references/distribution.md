# Client distribution decision

## Current decision

Keep the renderer as vendored, side-by-side JavaScript files for now:

- `architecture-library.js` owns the visual language and built-in icons.
- `diagram-engine.js` owns layout, hierarchy, and self-check. It is the whole
  engine and runs at build time only (`store_geometry.mjs`, `translate.html`).
- `diagram-runtime.js` is the part of the engine a page loads: stored layouts,
  wire rerouting and the layout check. It never places a node. It is generated
  from `diagram-engine.js` by `scripts/gen_runtime_engine.mjs`
  (`npm run gen-runtime`; `npm run check-runtime`, part of `npm test`, fails
  when it is out of date). Never edit it by hand.
- `architecture-diagram-element.js` is the optional browser custom element.
- `template.html` remains the canonical page renderer and source used by the
  custom element. Opened directly it shows a message that it has no stored
  geometry; it is the source the builder builds from, not a runnable demo.

`build_bundle.py` keeps this multi-file form as its default (the sidecars copied
beside the page are `architecture-library.js` and `diagram-runtime.js`) and offers
`--inline` for a one-file handoff. Do not publish an npm package or CDN entry
until a second real consumer needs to import the engine independently of this
repository. `--inline` is single-file delivery, not an offline guarantee: the
page still loads D3, GIF, and the GIF worker from
configured runtime URLs. Use `--offline` (below) for a page that needs no
network.

Those scripts, and the dagre, ELK and js-yaml scripts `translate.html` loads, are pinned twice: by exact version in the URL, and by a
`sha384` Subresource Integrity hash (with `crossorigin="anonymous"`) on every
`<script>` tag in `template.html` and `translate.html`. The GIF worker, which is
fetched instead of loaded by a tag, passes the same kind of hash to `fetch()`.
`assets/cdn-integrity.json` lists every hash, `npm run check-integrity` keeps the
pages and the list in step, and `VERIFY_CDN_INTEGRITY=1 npm run check-integrity`
re-downloads each file to confirm the hash.

For use without a network and for the build step, `assets/vendor/` holds exact copies of those same files (d3, dagre,
elkjs, gif.js and its worker, js-yaml) with their licence texts and a `manifest.json`; see its
README. Each copy's SHA-384 equals the hash pinned for its CDN URL, `offline_assets.test.mjs`
enforces that, and `scripts/vendor_assets.mjs` regenerates the directory (refusing any
download that does not match the pinned hash). The default page still loads the CDN copies of D3 and gif.js; the offline build uses the vendored ones. Dagre and ELK are vendored for the build step (`store_geometry.mjs`), not delivered with a page.

## Layout stored at build time

```bash
python archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model model.json --output diagram.html
```

Layout is computed when the diagram is built and stored in the page (the "geometry").
`build_bundle.py` always embeds it. Without `--geometry` it runs `store_geometry.mjs` itself, so the
one command above is the whole build; this needs Node.js 24 or newer on `PATH`, and the build stops
with a clear error when it is missing. The result is cached in the system temp folder, keyed by the
model and the engine: set `ARCHNIME_GEOMETRY_CACHE=0` to disable the cache, or set it to a directory
to keep the cache there.

```bash
node archnime-renderer/scripts/store_geometry.mjs model.json --output model.geometry.json
python archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model model.json --output diagram.html --geometry model.geometry.json
```

`--geometry` embeds a file `store_geometry.mjs` already wrote instead of computing the layouts
again. `store_geometry.mjs` (Node 24, no browser) loads the whole engine (`diagram-engine.js`) with
the vendored Dagre and ELK, lays out every stage in every package expansion state a click can reach
(the default plus every set in which an expanded package has its ancestors expanded, up to 64 states
per stage; `--max-states`), runs the self-check, and writes the layouts as JSON. It exits 1 on
self-check findings unless `--allow-findings` is given; `build_bundle.py` passes findings on as
warnings and still builds. `meta.layout` (`auto`, `dagre`, `elk`, `force`, `manual`) selects the
engine as before; the choice is made at this step.

The delivered page places nothing and loads no layout library: only D3 and gif.js,
`architecture-library.js` and `diagram-runtime.js`. It is ready in about 0.4 s whatever the diagram.
Expanding and collapsing packages, wire-style switching, perspectives, search, presenter mode,
playback, print and every export work from the stored layouts. The geometry is tied to the model and
the engine by hash: the build fails with `geometry file ... is stale` or `... is missing`; there is
no fall-back to layout in the page, and the page reports a state that has no stored layout instead
of computing one. Geometry is derived, never edited: build again after any model change.

Because the page only shows stored layouts: Tune layout is not a control in the page (the Tune
button, the Strategy list and the "Keep wires" checkbox are gone); presenter mode keeps the boundary
chip at its normal size, so it reuses the same layouts; print does not recompute layout; and each
state has one layout, so the result does not depend on the order of clicks.

A multi-view bundle (`views`) gets one geometry per view in the same file. `--tune` on
`build_bundle.py` or `store_geometry.mjs` runs the Tune search for every state and stores the best
placement found like any other layout; it takes longer. The `<architecture-diagram>` element requires
geometry: the same file as `geometry-src="model.geometry.json"`, or an inline
`<script type="application/json" data-geometry>` child. Its host page loads
`architecture-library.js`, D3, `diagram-runtime.js` and `architecture-diagram-element.js`, with no
Dagre, no ELK and not `diagram-engine.js`. The element cannot check the hash, so it refuses a
geometry whose nodes are not the model's; without geometry it shows an error and does not lay out.

`assets/translate.html` is an authoring tool: it loads the whole engine with Dagre and ELK, computes
the layout in the browser and embeds it in the page it produces, which is the same kind of page as
the builder's.

The previous renderer, which laid out in the page (releases up to 2.1.1), is archived as the git tag
`legacy-runtime-layout` and the branch `legacy/2.x`, for reference only.

## Offline presentation

```bash
python archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model model.json --output diagram.html --offline
python archnime-renderer/scripts/build_bundle.py ... --offline --inline   # one self-contained file (roughly 0.7 to 1 MB)
```

`--offline` replaces every CDN `<script>` with the vendored copy (placed in `vendor/` beside the
output, or inlined with `--inline`), embeds the GIF worker source in the page, and removes the
CDN-only `integrity`/`crossorigin` attributes: trust comes from the build re-checking each
vendored file against `vendor/manifest.json`. The build fails with a clear `offline build
failed:` message if a vendored file or the manifest is missing, a file does not match its
pinned hash, or a script has no vendored copy. The offline page carries D3 and gif.js only; it
contains no Dagre or ELK, because it computes no layout. The result loads nothing from the network:
the stored layout, playback, zoom, search, routing and GIF export all work with every
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
