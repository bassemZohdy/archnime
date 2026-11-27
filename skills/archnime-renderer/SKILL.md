---
name: archnime-renderer
description: Build interactive browser-based architecture diagrams from a portable model or validated architecture DSL derivative. Use for HTML/SVG/D3 diagrams with staged animation, packages, boundaries, search, zoom, export, and self-check; not for semantic YAML validation alone.
license: Apache-2.0
---

# Architecture Diagram Renderer

Produce an interactive HTML diagram and its portable structured model. The
model is authoritative: another tool must be able to regenerate the visual
from stable nodes, packages, boundaries, relationships, and (when present) an
ordered flow step list without reading SVG geometry.

Start from `assets/template.html` and keep `assets/architecture-library.js`
(icons, visual tokens), `assets/diagram-engine.js` (the whole layout +
self-check engine, used at build time and by the DSL translator) and
`assets/diagram-runtime.js` (the part of the engine a page loads) in the skill.
Save the model as a sibling JSON/YAML file. `scripts/build_bundle.py` does
deterministic JSON-to-HTML generation: it keeps editable relative sidecar links
by default, or inlines both sidecars (`architecture-library.js` and
`diagram-runtime.js`) for a portable ship-mode file with `--inline`.

Layout is computed at build time and stored in the page. `build_bundle.py`
always embeds the layouts (the "geometry"): without `--geometry <file>` it runs
`scripts/store_geometry.mjs` itself, which needs Node.js 24 or newer on `PATH`
(the build stops with a clear error when it is missing), and caches the result
in the system temp folder keyed by the model and the engine
(`ARCHNIME_GEOMETRY_CACHE=0` disables the cache; a directory path moves it).
`--geometry <file>` embeds a file `store_geometry.mjs` already wrote; a missing
or stale file fails the build. There is no fall-back to layout in the page. The
delivered page loads only D3 and gif.js (CDN, or vendored with `--offline`),
`architecture-library.js` and `diagram-runtime.js`; it loads no layout library
and has no placement code. `diagram-runtime.js` is generated from
`diagram-engine.js` by `scripts/gen_runtime_engine.mjs` and holds stored
layouts, wire rerouting and the layout check. Never edit it by hand: change
`diagram-engine.js`, run `npm run gen-runtime`, and `npm run check-runtime`
(part of `npm test`) fails when it is out of date. Opening
`assets/template.html` directly shows a message that it has no stored geometry;
it is the source the builder builds from, not a runnable demo.

For client-side embedding, `assets/architecture-diagram-element.js` provides
the optional plain-global `<architecture-diagram>` custom element. It loads
the same renderer source into a shadow root and accepts `src` or an inline JSON
child script; keep it beside `template.html`. The host page loads
`architecture-library.js`, D3, `diagram-runtime.js` and
`architecture-diagram-element.js`. The element requires geometry:
`geometry-src="model.geometry.json"` (the file `store_geometry.mjs` writes) or
an inline `<script type="application/json" data-geometry>` child. Without
geometry it shows an error; it does not lay out. Generated HTML from
`build_bundle.py` and `translate.html` uses the same
`application/json#diagram-model` payload contract, with `<` escaped before
insertion.
Read `references/data-model.md` for the model contract, `references/layout.md`
for layout and routing, `references/visual-language.md` for shared tokens, and
`references/distribution.md` for the vendored-files/package decision,
`references/documentation-export.md` for lossless presentation-to-documents
handoff, and `references/validation.md` before delivery.
Runtime policy: Python is canonical for CLI validation, translation, and
bundle building; the browser translator is the zero-build mirror. See the
DSL skill's `references/runtime.md` for dependency and parity details.

The whole engine (`diagram-engine.js`, loaded at build time by
`store_geometry.mjs` and `translate.html` together with dagre and ELK) exposes `DiagramEngine.create(model)` → `engine.layoutStage(...)` and
`engine.selfCheck()`. `meta.layout` (`auto`, `dagre`, `elk`, `force`, `manual`)
selects the layout engine; the choice is made when the diagram is built.
`auto` selects ELK for genuinely nested compound graphs,
dagre for acyclic fan-out/reconvergence backbones even when hubs are
high-degree, and force for graphs with irreducible peer cycles. Explicit or automatic
ELK selection is prepared asynchronously, so await `engine.ready` before using
the instance layout/self-check API; the instance methods remain synchronous
after preparation. The static one-shot helpers `DiagramEngine.layoutStage(...)`,
`DiagramEngine.layoutFlow(...)`, and `DiagramEngine.selfCheck(...)` always return
Promises, including for synchronous dagre/force models, and reject when ELK
preparation fails.
`template.html` is DOM/D3 rendering and interaction on top of the stored
layouts; a headless caller can validate every stage's geometry without a page.

For a browser-only YAML workflow, open `assets/translate.html` from a local
HTTP server, paste or upload the DSL, and use **Convert and validate**. It runs
the browser validator, translates to MODEL, checks every stage with the shared
engine, and enables the HTML download only when all checks pass. It is an
authoring tool: it computes the layout in the browser and embeds it in the page
it produces, which is the same kind of page as the builder's. The paired
`archnime-dsl/scripts/validate_transition_diagram.js` and
`translate_transition_diagram.js` files are the zero-build browser ports of the
CLI validation and mapping path.

## Workflow

1. **Gather evidence.** Read every input, inspect images, and record components, boundaries, routes, identity decisions, and uncertainties.
2. **Choose the mode.** Use staged mode for current/target states or an explicit sequence, one-shot mode for a single architecture with entry animation and route emphasis, or fixed flow mode when one topology should be narrated through ordered steps.
3. **Create the model first.** Write `meta`, `canvas`, `catalog`, `packages`, and `stages`. Give each architectural component one stable ID for the whole sequence.
4. **Select the layout engine.** Prefer `meta.layout: auto`; it chooses ELK for
   two-or-more-level compound package hierarchies, dagre for flat directional
   graphs, and force for genuinely peer-like meshes. Use explicit `elk`, `dagre`,
   `force`, or `manual` only for a documented presentation constraint. The
   engine runs when the diagram is built, not in the page. Read
   `references/layout.md`.
5. **Resolve hierarchy honestly.** Use shallow packages for logical hierarchy and boundaries for ownership, trust, or compliance. For a v2 deployment view, let the normalized infrastructure tree own region/cluster/host nesting and keep logical packages separate. A package listed directly in a view stays collapsible; a leaf listed explicitly in `nodes` is made visible by expanding its package ancestors. Comparison bundles also expand packages whose selected membership or internal wiring differs between options.
6. **Build from the template.** Keep D3 as the rendering/interaction layer:
   preserve keyed joins, stable IDs, SVG transitions, zoom, focus, and export.
   Keep ELK/dagre/force inside the shared engine, at build time only, and keep
   renderer-only coordinates out of the semantic DSL. Use only the shared
   icon/style library. Build with `scripts/build_bundle.py`; the page it writes
   shows stored layouts and never places a node.
7. **Validate interaction and truth.** The build runs the self-check (`store_geometry.mjs` exits 1 on findings unless `--allow-findings`; `build_bundle.py` passes them on as warnings and still builds). In the page, run `diagramSelfCheck()`, which checks every stored state, then exercise the perspective dropdown, search, disclosure, zoom/fit, the details-panel hide/restore control, exports, presenter/print modes, themes, responsive widths, keyboard access, and reduced motion.
8. **Make documentation exports.** For presentations, deliver the interactive
   HTML. For README/docs/Office, export **SVG (documentation)** from the *same*
   settled view/stage (not **SVG (this view)**, which retains presenter zoom),
   and include a static fallback and link to the live viewer. Export every
   relevant migration stage and v2 view explicitly; verify the actual target
   document rather than assuming animation or controls are preserved. Without a
   browser at hand, `archnime-renderer/scripts/export_svg.mjs spec.yaml --out
   diagram.svg` writes the same SVG headless (add `--sequence` for a flow's
   sequence view). Read `references/documentation-export.md`.
9. **Tune the layout when needed.** Tune layout is a build option, not a button
   in the page: pass `--tune` to `build_bundle.py` or `store_geometry.mjs` to
   try bounded deterministic layered strategies. The engine reroutes wires and
   rechecks labels/collisions for each candidate, then stores the
   lowest-scoring result for every stage and expansion state like any other
   layout. Treat it as a presentation override; it must not alter semantic IDs,
   packages, boundaries, or wires.

Never patch a sandbox case or generated HTML to hide a reusable defect. Fix the
template or library, regenerate from the semantic source, and repeat the
layout/interaction audit.

## Semantic and visual invariants

- Stable IDs represent the same component across stages; `changed` marks architectural changes, not every new caller.
- Packages describe hierarchy; boundaries describe ownership, trust, or compliance. Do not use one as the other.
- Use the shared icon/style library, preserve semantic wire types, and keep one line per same-direction/same-type relationship after collapse.
- `meta.icons` may register a new node type as a built-in alias or an inline
  SVG `{ viewBox, markup }` definition; the base built-ins stay frozen and
  `kind` still controls fill/stroke.
- `meta.theme` sets the project's own colours per scheme (`light`, `dark`), one role at a time (`panel`, `ink`, `data`, `data-fill`, ...). The presenter writes them after its own stylesheet, in a media rule for each scheme, so the documentation SVG and the sequence SVG carry them too; the validators refuse a colour that drops text under 4.5:1 or a line under 3:1 (`theme-contrast`). Change the theme in the spec, never in the generated HTML.
- The perspective dropdown exposes the authoritative choices (`All`, `Data`, `Security`, `Migration`, `Operations`, plus advanced `Control`, `Compat`, `Neutral`, and `Trust & compliance`). It restyles or hides rendered layers without recomputing layout. An explicit `meta.perspectives` list is authoritative; self-check always runs against the unfiltered geometry. The current choice is persisted per diagram title.
- The right details panel can be hidden and restored with an accessible `Hide details`/`Show details` control. Persist that choice per diagram title, keep `aria-expanded` truthful, and let the diagram canvas reclaim the available width while the panel is hidden.
- Calculate geometry, then routes, then labels. Fix crossings and collisions in the model/layout, not with opacity or generated-HTML patches. Directional rank order is preserved through deconfliction, package/boundary clearance, minimum-wire-length correction, and fitting; foreign nodes are cleared from explicit trust boundaries on automatic layouts. Exclusive downstream datastore matches may align across unequal packages while shared cache targets remain in their own lane. ELK positions feed the same collision-aware route pass: curved wires keep stable axis-aligned endpoint tangents on every block face while their control points search both sides of the chord, and a curve that cannot clear a container follows a searched clear route with rounded corners, so it stays curved. **Tune layout** (the `--tune` build option) evaluates ELK placement together with curved, orthogonal, and direct wire-routing strategies under balanced, wire-clearance, and boundary-safe objectives, then keeps the lowest complete geometry/label self-check score. Preserve obstacle context through every reroute pass, including minimum-wire-length correction.
- A wire records `requestedRouting`, `actualRouting`, `routeFallback`, and
  `routeFallbackReason` independently of semantic `type`, `layer`, and flow
  direction. Every wire stays in the selected style: a blocked Curved wire
  rounds a searched clear route, a blocked Direct wire pulls it taut into
  straight runs, and a wire with no clear route is reported as
  `<style>-blocked`. Geometry metadata must still describe the painted
  family, never only the request.
- Changing the wire style reroutes the stored layout in place; it never
  re-places nodes or discards expansion state or a placement stored by a
  `--tune` build. Returning to a style reproduces its earlier geometry. Nothing
  in the page recomputes placement: every package expansion state a click can
  reach is stored (the default plus every set in which an expanded package has
  its ancestors expanded, up to 64 states per stage; `store_geometry.mjs
  --max-states`), so expanding, collapsing, perspectives, search, presenter
  mode, playback, print and all exports work from stored layouts. Each state
  has one layout, so the result does not depend on the order of clicks.
- Presenter mode reuses the stored layouts: it enlarges labels, hides panels
  and raises contrast, and does not enlarge the boundary chip.
- At build time, ELK retry candidates are scored after routes and labels are recomputed. A
  retry performs a bounded seeded multi-start search: it varies ELK child/edge
  order for fresh block placements and crosses those placements with the wire
  routing strategies and objective weights. A retry may improve positioning,
  but it cannot hide self-check findings or rewrite the portable model. The
  built-in engine accepts `strategyId` (`balanced`, `wire-clearance`, or
  `boundary-safe`) when a caller needs one objective instead of the default
  all-strategy search.
- Stage changes tween settled wire paths and stable node shapes over `DUR`; the
  reduced-motion media query sets `DUR` to zero so the same state change is
  immediate and accessible.
- Staged mode starts with `Current state` and ends with `Target state` when those states are supplied. Keep labels short and evidence-based.
- Flow mode lays out one synthetic stage once. Its numbered timeline changes active wires, markers, panel copy, and playback state without moving nodes; returns, grouped edges, parallel edges, async work, and retry loops remain explicit in the portable model.
- A flow step's optional `label` is a presentation override for the active
  wire label; it does not mutate permanent wire metadata or layout.
- Set `meta.flow.intro: true` to synthesize a non-geometric overview step from
  the flow step titles before the active walkthrough begins.
- The non-geometric intro step is not assigned a wire marker number; the first
  geometric flow step is marker `1`.
- Flow semantics stay visible in the canvas: returns use dashed arrows,
  parallel work gets fork/join glyphs, and loops show a retry badge.
- `meta.flow.render` selects `stepwise` (default), `all-steps` (static numbered
  overview with no dash animation), or `single` (slide-friendly chrome).
- Selecting a node focuses the canvas to `meta.focusHops` hops (default `1`)
  without relayout; Escape or selecting the same node again restores context.
- A v2 `views` bundle is rendered as one materialized model per view. The view
  selector and `?view=<viewId>` URL choose the active model; the first view is
  the root breadcrumb target. `navigateTo` on nodes or flow steps changes the
  selected view without reparsing the source. `MODEL.shared.catalog` and
  `MODEL.shared.packages` are merged into every active view before the engine
  is created; consumers must not rely on a test harness to perform that merge.
- `contains` on a catalog node is drill-down navigation: double-click or Enter
  targets a contained view, or expands a contained package and zooms to its
  outline. Package drill-down is zoom-only and does not add a breadcrumb; the
  root breadcrumb and selector are reserved for view navigation. A single click
  retains its existing focus/expand behavior.
- Deployment models carry `deployment.infrastructure` and `placements`; the
  translator derives stable physical instance IDs and the engine's deployment
  profile lays them inside nested infrastructure outlines with distinct styling.

## Pairing with archnime-dsl

For a semantic YAML source, validate and translate it with the paired skill,
then build the renderer derivative:

```bash
python3 -B archnime-dsl/scripts/validate_transition_diagram.py diagram.yaml
python3 -B archnime-dsl/scripts/translate_transition_diagram.py diagram.yaml --output diagram.model.json
python3 -B archnime-renderer/scripts/build_bundle.py --template archnime-renderer/assets/template.html --model diagram.model.json --output diagram.html
```

These commands assume the repository root. For installed skills, resolve
scripts from the installed skill directories.

## Pairs with archnime-interview

Use `archnime-interview` before this renderer when the request is
an incomplete brief or “help me diagram my architecture.” The interview
skill confirms mode, identities, assumptions, and gaps; this skill renders
the validated YAML/JSON derivative. Optional
`engineering:system-design` or `engineering:architecture` companions can
add reasoning or an ADR when available.

For a non-destructive preview, run interview → validate/translate → build →
browser self-check inside a dedicated temporary workspace. Review the
validation output and only explicitly promote the selected artifact.

## Delivery

Open the built HTML from disk and run `diagramSelfCheck()` or `?check=1`; it
checks every stored state. Fix every reported geometry, label, identity, and
overflow finding in the model or the engine and build again. SVG remains the
lossless interactive source; raster/GIF export may degrade gracefully when an
optional CDN dependency is unavailable. Read `references/validation.md` for
the complete checklist.

`tests/render_check.mjs` drives every example and fixture bundle in headless
Chromium — `diagramSelfCheck()` plus rendered-DOM checks (declared leaf nodes
must be reachable, duplicate nodes, swallowed / false-nested boundaries,
node/boundary straddles) and a collapse → re-expand round trip. Run it after
any change to `template.html` or `diagram-engine.js` (regenerate
`diagram-runtime.js` with `npm run gen-runtime` first); `diagramSelfCheck()`
alone does not see what paints.
The **SVG (documentation)** control emits a single-stage SVG with fitted full
content bounds, an embedded pinned font, and an opaque background. It carries the
light and the dark palette and follows the reader's `prefers-color-scheme`. It is the
preferred static documentation artifact; the normal **SVG (this view)** retains
presenter zoom and must not be used as a docs substitute. See
`references/documentation-export.md`.

The **Animated SVG** control emits one JavaScript-free SVG containing every
stage as a CSS-timed `<g>`, a visible flow legend, and a reduced-motion rule
that freezes on stage 1; it warns rather than silently exporting when the file
grows past roughly 2 MB.

The **Mermaid** control emits a `.mmd` `architecture-beta` snapshot for the
selected state. It keeps services, nested packages, built-in type icons, and
directional edges, but intentionally drops boundaries, wire labels/types, and
staged history because Mermaid's architecture syntax has no matching concepts.
Use the validated YAML or renderer JSON for a lossless source.

For a flow model, **Sequence (Mermaid)** emits a separate `sequenceDiagram`
companion with participants, calls, returns, parallel blocks, and retry loops.
It is intentionally a companion export rather than a second native renderer;
see the DSL skill's `references/sequence-policy.md`.

For a v2 bundle, the export follows the currently selected view. Deployment
instances are emitted as the normalized physical nodes; the v2 YAML remains
the lossless source for infrastructure metadata and view ordering.

Comparison bundles use the same v2 view selector with `meta.comparison`:
options are keyed view swaps, the side panel shows weighted criteria and
per-option tradeoffs, and playback is disabled. Use `docs:`/`adr:` links to
connect the visual options to an engineering decision record.

The custom element accepts `stage` (one-based), `mode` (`interactive` or
`static`), `perspective`, and `controls` (`full`, `minimal`, or `none`). It
scopes DOM/D3 queries, CSS token roots, keyboard listeners, and runtime helper
state to its shadow root, so multiple diagrams can be embedded together.

`tests/translate_check.mjs` exercises every DSL example through `translate.html`
and compares the browser validator's rule names with the Python validator for
every invalid fixture. It also opens every produced page and checks that it
runs from stored geometry with no layout library.
