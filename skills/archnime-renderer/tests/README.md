# Renderer tests

## `render_check.mjs` — headless render + interaction check

`diagramSelfCheck()` validates the geometry the layout engine *computes*. It
does not see what the page actually *paints*, nor what an interactive
collapse/expand leaves in the DOM. This harness closes that gap.

For every model in [`../assets/examples/`](../assets/examples) and
[`fixtures/`](fixtures) it builds an HTML bundle with
[`../scripts/build_bundle.py`](../scripts/build_bundle.py), loads it in
headless Chromium, and checks:

- `diagramSelfCheck()` returns no findings
- declared `meta.validation.expectedIssueTypes` are present and no unrelated
  self-check findings are reported for intentional negative fixtures
- every view/stage's declared leaf-node closure is reachable in the painted DOM
- no uncaught page errors
- no duplicate rendered nodes
- no sub-2px, swallowed, or false-nested boundary rectangles
- no package drawn as both an outline and a collapsed block
- no node straddling a boundary edge (35–85% inside, not nested)
- perspective switching does not change node/boundary geometry; `zones`
  emphasizes the boundary layer and `devops` surfaces operational nodes/wires
- fixed flow walkthroughs expose one timeline button per step and activate at
  least one wire and numbered marker for every step without changing geometry
- scenario compositions expose one keyed variant button per materialized
  variant, hide sequential playback controls, and keep node identity stable
- `all-steps` flow fixtures expose every mapped marker, hide playback/timeline
  controls, and pass the same geometry self-check
- Documentation SVG export parses, embeds the pinned Inter font, has an opaque
  background, covers the scene geometry independent of presenter zoom, retains
  the visible nodes, and loads in an SVG image context
- Animated SVG export contains every stage, an embedded font, a legend,
  keyframes, and a reduced-motion fallback
- the first collapse either no-ops with a status note, or fully round-trips:
  collapse then re-expand restores the exact node set
- the `commerce-views` v2 bundle selects deployment by URL, renders all
  infrastructure containers and physical replicas, swaps views through the
  selector/flow step, and performs package `contains` drill-down
- comparison v2 bundles expose a keyed option switcher, criteria matrix,
  recommendation badge, and per-option tradeoffs without playback controls
- compact v2 bundles resolve shared catalog/package entries in the page itself;
  the harness does not supply that merge to the renderer
- every model is rebuilt with both `dagre` and `elk`; the harness awaits
  `engine.ready`, compares self-check issue classes, and fails on a new ELK
  class or layout runtime error. Curved ELK paths are also checked for
  unrelated node, package, and boundary crossings; they may use the explicit
  orthogonal safety fallback, but must not silently retain a crossing curve
- the `wire-routing-style` fixture keeps same-pair wires in distinct lanes,
  applies every routing choice to bundled secondary wires, verifies that
  blocks remain painted above routes, and confirms Tune layout performs a
  multi-start search

## `*.test.mjs` — documentation-export tests (`npm run test:documentation`)

These are `node --test` files that share `doc_export_harness.mjs`, which builds a real
bundle with the shipped builder and drives Chromium through the same window functions the
toolbar uses. A missing browser skips them locally and fails them under
`REQUIRE_BROWSER_TESTS=1`.

- `documentation_svg.test.mjs` — real wheel zoom and drag cannot change or crop the exported
  SVG (checked on a flow, a dense mesh and nested packages, including that every node and
  boundary lies inside the exported `viewBox`); the SVG rasterises opaque with its own font
  and no external references; a missing pinned font or an empty scene makes the export fail
  with a visible status and no download.

- `documentation_embedding.test.mjs` — the export keeps every node id and label, every trust
  boundary (title and area) and every arrowhead (each referenced marker is defined in the file),
  and as an `<img>` at 880 px (README column), 640 px and 360 px it is not blank, not cropped,
  and its smallest text stays above 6 px and 4.5 px at the first two widths. Checked on a flow,
  a model with colliding trust-boundary labels and nested packages.

- `documentation_states.test.mjs` — the toolbar export writes the selected state: for each
  migration stage, scenario variant, flow step and bundle view it carries the presenter's node
  and boundary ids (and, for stages, their kinds and labels), the selected step's active
  wires, a file name with the selected number, and no id that only another state declares;
  a package the user collapsed in one stage is exported collapsed there and expanded in the
  stage where it stays expanded.

- `batch_snapshots.test.mjs` — `scripts/export_snapshots.mjs` writes one named SVG per
  stage, variant, flow step and bundle view, each exactly once with no stray files; `--views`
  and `--states` select; two runs are byte-identical; a bad request fails before writing.

- `export_manifest.test.mjs` — every export writes a `manifest.json` naming the source model,
  renderer files and each snapshot's view, state, size and SHA-256; it is reproducible (no
  timestamps or paths); `verify_snapshots.mjs` rejects an edited, deleted or added snapshot, a
  changed model and a hostile manifest (path traversal, duplicates), with exit codes 0, 1 and 2.

- `documentation_links.test.mjs` — `snapshots.md` gives every snapshot an image, a plain SVG
  link and (with a viewer URL) a presenter link whose `view` and state parameters, opened in
  Chromium, show the same nodes as the snapshot; it is reproducible, works without a viewer
  URL, escapes titles and refuses a `javascript:`, `data:`, `file:` or protocol-relative viewer.

- `documentation_disclosure.test.mjs` — for a progressive-disclosure stage the documentation
  export taken mid-reveal equals the one taken after the reveal finishes and holds every
  supporting wire, exporting leaves the presenter's wire count, button and status untouched,
  and a model without disclosure exports the same at any time.

- `offline_assets.test.mjs` — `assets/vendor/` covers exactly the pinned CDN files, each
  byte-identical to the pinned SHA-384 and version, with an allowed SPDX licence and its
  recognisable licence text, and nothing unlisted beside them.

- `offline_presenter.test.mjs` — `build_bundle.py --offline` (also `--inline`) produces a page
  with no network reference; with every non-file request blocked, Dagre and ELK layout, playback,
  zoom, search, routing and GIF export work and no request leaves the page; a missing, altered
  or unlisted vendored file fails the build clearly, and a library that goes missing later shows
  an alert instead of a blank page.

- `multilingual_font.test.mjs` — a label the pinned font cannot paint (Arabic, Hebrew, Han,
  Cyrillic, Greek, Hangul, Devanagari, emoji, or a Latin letter missing from the subset) makes the
  documentation export fail with a message naming the script and characters, in the toolbar and
  the batch exporter, while accents, typographic punctuation and the euro still export.

- `font_portability.test.mjs` — the supported-script registry (`FONT_SCRIPTS`) matches the pinned
  font file, its SHA-256 and OFL licence text; every character of the advance table exists in the
  font's own cmap (mutation proof: a Cyrillic letter appended to the table is caught); characters the
  font lacks are refused; `gen_font_assets.mjs --check` passes; and offline, the exported SVG paints
  with the widths the layout measured (a different font would be detected).

- `animation_format.test.mjs` — the same four-stage animation as CSS keyframes and as SMIL, measured in
  every installed engine (Chromium, plus Firefox and WebKit when found): CSS plays in order and stops
  under reduced motion, SMIL cannot be stopped by it; the exporter contains no SMIL.

- `animated_svg_compat.test.mjs` — the CSS-keyframe Animated SVG shows stage k alone during slot k
  (in order), only stage 1 under reduced motion, only stage 1 when animation declarations are stripped,
  and draws content when embedded with `<img>`.

- `documentation_visual.test.mjs` — visual gates for dense, nested and trust-boundary layouts in
  light and dark. No screenshots are committed (pixels differ across machines and fonts); the
  exported SVG is rendered as an `<img>` and inline in the page and the two must agree to within
  8% of the drawn pixels (healthy exports differ in at most 5.5%, a missing embedded font in
  about 12%); every wire must still end on a node or package (a shifted arrow layer misses by
  20 px or more); nothing may touch the image edge (a clipped scene does); and the app's PNG
  export must carry the same theme background as the SVG. A final test injects each defect and
  requires it to be caught.

- `pdf_conversion.test.mjs` — `scripts/document_format.mjs`: a documentation SVG converted to PDF
  keeps one page of the diagram's size and every visible label as text (checked on a
  trust-boundary, a nested and a dense layout); a PDF that only holds a picture of the diagram is
  rejected and a 2x PNG fallback is written with the reason; markdown and html get the SVG,
  word and google-docs get a PNG (or the SVG when told they accept it); bad requests fail first.

## `script_integrity_check.mjs` — pinned CDN scripts

Every external script the pages load (D3, Dagre, ELK, gif.js and js-yaml) carries a
`sha384` Subresource Integrity hash and `crossorigin="anonymous"`, and the gif worker,
which is fetched rather than loaded by a tag, passes its hash to `fetch()`.
`assets/cdn-integrity.json` is the one list of those hashes; the check is static and
offline. `VERIFY_CDN_INTEGRITY=1 npm run check-integrity` also downloads each file and
compares. When a pinned version changes, update the manifest from the new file, then both
HTML pages and `GIF_WORKER_INTEGRITY` in `template.html`, and run the verifying form.

## `link_safety_check.mjs` — stage link safety

Stage `docs` and `adr` values come from the model, so the renderer treats them as
untrusted. The check renders one stage per hostile value (`javascript:` with tab,
newline, carriage return, leading control characters or spaces, plus `data:`,
`vbscript:` and `file:`) and fails if any becomes a script-capable or non-web
link, while relative, fragment, `https:` and `mailto:` targets still render.

### Run

```bash
npm run regen-fixtures                 # intentionally rewrite YAML-derived fixtures
npm run check-fixtures                 # fail if a generated fixture has drifted
npm test                               # complete repository gate
node tests/render_check.mjs            # all models
node tests/render_check.mjs venn       # models whose name contains "venn"
node tests/translate_check.mjs         # browser YAML translation + JS rule parity
node tests/visual_audit.mjs            # responsive screen/presenter/print evidence
```

### Requirements

- Python 3.10+ on `PATH` (or set `PYTHON=/path/to/python`; npm scripts and
  browser harnesses use the same interpreter). Browser automation is the
  pinned npm `playwright` dependency in `package-lock.json`, not a Python
  package.
- Node 24 (the repository's `engines` requirement)
- Playwright's Chromium. Either a global `playwright-core` plus a downloaded
  build, or:
  ```bash
  npm i -g playwright-core
  npx playwright install chromium
  ```
  With no browser found the harness prints `SKIP` and exits 0, so a
  browserless environment does not hard-fail. CI that wants this as a gate
  must install a browser.

On hosts with a system Chrome/Chromium executable, set `BROWSER_EXECUTABLE` to
its absolute path to run the browser checks without downloading Playwright's
bundled revision.

`translate_check.mjs` serves the repository over localhost so the translator
can fetch `template.html` and its local sidecars. It converts the system,
transition, steps, scenarios, flow, and v2 views DSL examples, confirms
download is enabled only after a clean geometry check, and compares the browser
validator's rule names with the Python validator for every invalid fixture.

The DSL translator's `--sequence` companion is covered by the Python unit
suite and emits Mermaid without changing the renderer JSON output path.

`render_check.mjs` prints the current ELK parity result for each model. Nested
compound models are expected to select
ELK under `auto`; flat directional models may remain dagre and peer meshes may
remain force. The harness still compares explicit dagre and ELK runs for every
model because backend choice must not change semantic scope or introduce a new
self-check issue class, or add findings. Fewer ELK findings are recorded as an
improvement rather than treated as parity drift.

## `headless_layout_check.mjs` — layout without a page equals layout in the page

Loads the vendored D3, dagre and ELK, the library and `diagram-engine.js` into a
plain Node context with no `document`, runs `DiagramEngine.layoutStage` for every
stage of seven fixtures (flat, nested packages, flow, one laid out by ELK, one by
the force engine, a free-form mesh and three levels of packages) and writes the geometry as JSON: node, package and boundary
boxes, wire routes and label positions, canvas and engine. It then builds the
offline page for each fixture, asks the engine in that page for the same stages
with the options `template.html` uses, and fails when any value differs (numbers
are compared exactly, not rounded). The layout the page painted on load must
equal one of the headless stages. Prints the headless and in-page layout time and the geometry size per
fixture; `--out <dir>` keeps the JSON. The headless half needs no browser.
Covers TASK-034 and TASK-036, the evidence for [build-time layout](../../../docs/build-time-layout.md).

## `stored_geometry_check.mjs` and `stored_geometry.test.mjs` — layout computed at build time

`stored_geometry_check.mjs` computes the geometry of seven fixtures with
`scripts/store_geometry.mjs`, builds each page twice (the usual way, and with
`build_bundle.py --geometry`) and drives both through the same steps: every
stage, every wire style, collapsing and expanding each package, presenter mode.
After each step the layout the page holds and what it painted must be identical.
The stored page is offline with every network request refused and must have no
`window.dagre` and no `window.ELK`; it must not offer Tune, and a state with no
stored layout must fail with a message. One fixture uses the force layout, whose
runtime result after a collapse depends on the clicks before it; there only the
steps before the first collapse are compared, and the stored page must return to
the layout the stage opened with. `stored_geometry.test.mjs` holds the same
without a browser: stored equals computed for every reachable state, the stored
engine runs with no layout library, reroutes and checks, and the state limit,
multi-view bundles and a missing state fail clearly. `test_build_bundle.py`
covers the builder: a missing, unreadable or stale geometry fails the build.
Covers FEAT-038.

## `playback_gate_check.mjs` — pause, navigation, text size and run length

The measurements of the comparison harness behind
[build-time layout](../../../docs/build-time-layout.md), ported as a gate. It
builds the offline page for a staged diagram (`strangler-migration`) and a flow
walkthrough (`checkout-flow`) at 1280 x 800 and checks that Pause freezes motion
(two screenshots 2.5 s apart differ in under 0.05% of pixels, the step does not
advance, nothing visible is still animating, and Play resumes), that Next, Back
and a jump land on the right step when pressed while playing, that no visible
text is under 12 px on screen, and that a run from the first step lasts the
number of steps times the interval. A console error or a network request fails
it. A target the renderer does not meet yet is recorded in
`playback-gate-budgets.json` with its measured value; the gate fails when that
value gets worse and when the target is met, so the entry cannot go stale.
`--write-budgets` rewrites the file after review. Covers TASK-037.

## `routing_stability_check.mjs` — wire-style switches keep placement

Builds the canonical Test System DSL into HTML, then cycles the template's
wire-style selector Curved → Orthogonal → Direct → Curved. It also drives
`engine.setRouting` over routing fixtures in default and fully expanded states
and after a committed Tune. Every switch must keep node, package, and boundary
boxes and the expansion state; every visible wire must report the selected
`requestedRouting`; and returning to the starting style must reproduce its
wire geometry exactly. Immediately after each switch (no waiting), every
painted wire and flow-overlay path must already match the layout, so a
deferred transition cannot leave the previous route on screen. Each wire's
`actualRouting` must also match its painted geometry family: Béziers are
curved, diagonal polylines are direct, and axis-aligned polylines may be
either. Covers TODO CASE-21 and guards CASE-22.

## `routing_family_check.mjs` — every wire follows the Wires control

Opens every example, fixture, and DSL-example bundle and switches the Wires
control to Curved, Orthogonal, and Direct. For every view, stage, and the
default and fully expanded states, each visible wire must be laid out, and on
the painted page drawn while stepping through every stage or flow step, in
the selected family: Béziers for Curved, axis-aligned runs for Orthogonal,
straight runs that are not a Manhattan elbow for Direct. Covers FIX-023: a
blocked wire used to borrow another style's route.

## `route_fallback_check.mjs` — bounded route fallbacks

`render_check.mjs` treats `edge-route-fallback` as advisory, so on its own a
regression that turned every wire into a safe detour would pass. This harness
opens every example, fixture, and DSL-example bundle, switches each wire style,
and counts the visible wires whose route needed a fallback across every stage
in the default and fully expanded states. Counts are compared with
[`route-fallback-budgets.json`](route-fallback-budgets.json): a count may not
grow, a model needs a recorded budget, and a fallback that also crosses a node,
package, or boundary always fails. The gate logic is in
`route_fallback_budget.mjs` and self-tests an injected regression on every run.
Lower a number when a fix removes fallbacks; regenerate after review with
`node skills/archnime-renderer/tests/route_fallback_check.mjs --write-budgets`.
Test System is tracked at curved 2, orthogonal 0, direct 10.

## Font metrics

Layout measures text from a pinned table of Inter Variable advances, and the
template embeds the same font, so geometry is identical on every host.
`npm run check-fonts` (`scripts/gen_font_assets.mjs --check`) verifies the
embedded font bytes and the table; run `node scripts/gen_font_assets.mjs`
after changing either. `test_system_layout_check.mjs` agrees to the pixel on
Windows and in the Linux CI image.

## Failure evidence

Set `ARTIFACT_DIR` and a failing harness copies its built HTML there before
cleaning up (`retain_artifacts.mjs`); CI uploads that directory as
`test-failure-evidence`.

## `fixtures/`

Portable models that exercise cases the bundled examples do not — each was a
real defect at some point. Three are generated from the same-named DSL example
by `scripts/regen_fixtures.py`; the rest are hand-authored regression models.
Run `npm run check-fixtures` in CI and before rendering a changed translator.

| Fixture | Source | Exercises |
| --- | --- | --- |
| `checkout-flow.json` | generated from `skills/archnime-dsl/assets/examples/checkout-flow.yaml` | fixed-topology flow steps with a return edge, grouped work, parallel async delivery, and a retry loop |
| `commerce-views.json` | generated from `skills/archnime-dsl/assets/examples/commerce-views.yaml` | DSL 2.0 context/deployment/flow bundle, infrastructure nesting, representative replica routing, and navigation |
| `orders-failover-scenarios.json` | generated from `skills/archnime-dsl/assets/examples/orders-failover-scenarios.yaml` | independent named variants over one shared base, with keyed node identity |
| `checkout-flow-all-steps.json` | hand-authored | static all-steps flow presentation, including a non-geometric intro |
| `collapse-boundary-chip.json` | hand-authored | collapse folds two disjoint boundary scopes onto one block → the smaller renders as a dashed chip, not a false-nested rectangle |
| `collapse-boundary-venn.json` | hand-authored | two disjoint zones share a collapsed block but keep exclusive members → Venn overlap, neither swallowed |
| `deep-nested-crosscut.json` | hand-authored | nested packages, long captions, three cross-cutting boundaries |
| `flow-single.json` | hand-authored | single-step flow presentation, including an intro offset |
| `force-mesh-packages.json` | hand-authored | `force` layout with two expanded packages and disjoint boundaries |
| `stage-scoped-collapse.json` | hand-authored | per-stage expansion defaults and interactive-override isolation across a 3-state transition |
| `wire-routing-style.json` | hand-authored | explicit parallel-wire lanes, bundled secondary routes, all routing styles, node-over-wire paint order, and Tune layout |
| `free-form-mesh.json` | hand-authored (TASK-036) | a flat peer mesh with call cycles and no lane or rank order, across two stages; checks layout on a diagram that is not lane-aligned |
| `nested-three-levels.json` | hand-authored (TASK-036) | packages nested three deep under `auto` (ELK), with a second stage whose new wire leaves the innermost package |

The `assets/examples/boundary-label-collision-model.json` model is a
cross-cutting-boundary acceptance fixture. Decision: shared membership across
boundaries is valid semantics, so the fixture remains unchanged. Its scopes
share a member, making rectangle overlap valid; the renderer must keep the
titles readable and must not report false containment for the shared scope.
