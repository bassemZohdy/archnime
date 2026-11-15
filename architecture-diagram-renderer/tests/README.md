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
`node architecture-diagram-renderer/tests/route_fallback_check.mjs --write-budgets`.
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
| `checkout-flow.json` | generated from `architecture-diagram-dsl/assets/examples/checkout-flow.yaml` | fixed-topology flow steps with a return edge, grouped work, parallel async delivery, and a retry loop |
| `commerce-views.json` | generated from `architecture-diagram-dsl/assets/examples/commerce-views.yaml` | DSL 2.0 context/deployment/flow bundle, infrastructure nesting, representative replica routing, and navigation |
| `orders-failover-scenarios.json` | generated from `architecture-diagram-dsl/assets/examples/orders-failover-scenarios.yaml` | independent named variants over one shared base, with keyed node identity |
| `checkout-flow-all-steps.json` | hand-authored | static all-steps flow presentation, including a non-geometric intro |
| `collapse-boundary-chip.json` | hand-authored | collapse folds two disjoint boundary scopes onto one block → the smaller renders as a dashed chip, not a false-nested rectangle |
| `collapse-boundary-venn.json` | hand-authored | two disjoint zones share a collapsed block but keep exclusive members → Venn overlap, neither swallowed |
| `deep-nested-crosscut.json` | hand-authored | nested packages, long captions, three cross-cutting boundaries |
| `flow-single.json` | hand-authored | single-step flow presentation, including an intro offset |
| `force-mesh-packages.json` | hand-authored | `force` layout with two expanded packages and disjoint boundaries |
| `stage-scoped-collapse.json` | hand-authored | per-stage expansion defaults and interactive-override isolation across a 3-state transition |
| `wire-routing-style.json` | hand-authored | explicit parallel-wire lanes, bundled secondary routes, all routing styles, node-over-wire paint order, and Tune layout |

The `assets/examples/boundary-label-collision-model.json` model is a
cross-cutting-boundary acceptance fixture. Decision: shared membership across
boundaries is valid semantics, so the fixture remains unchanged. Its scopes
share a member, making rectangle overlap valid; the renderer must keep the
titles readable and must not report false containment for the shared scope.
