# archnime-renderer

Build a browser-only **interactive architecture diagram** — an HTML page
(HTML + SVG + D3) plus a portable structured model — that explains a single
system, a current-state → target-state transition, a fixed-topology flow
walkthrough, or a v2 multi-view bundle with deployment placement.

- **Skill directory:** [`skills/archnime-renderer/`](../skills/archnime-renderer/)
- **Entry file:** [`SKILL.md`](../skills/archnime-renderer/SKILL.md)
- **Not for:** static diagrams (use a diagramming tool) or numeric charts (use a
  charting library).

---

## 1. When this skill applies

Load it when the request is for an **animated, staged, step-by-step, zoomable, or
presentation-ready** architecture diagram — including diagrams that show how
an architecture changes between two states or how one request moves through a
fixed topology.

## 2. What it produces — a portable HTML bundle

| File | Role |
| --- | --- |
| `<title>.html` | The interactive diagram. Built from `assets/template.html` with the model embedded as `const MODEL`. The default build keeps relative links to the two sidecars below; `--inline` embeds them for single-file delivery — not an offline guarantee, since D3/dagre/ELK/GIF still load from runtime URLs. It includes SVG, PNG, JPEG, GIF, and JavaScript-free Animated SVG export. |
| `<title>.json` (or `.yaml`) | The **portable model** — the source artifact. Another tool must be able to regenerate the visual from this alone, without reading SVG geometry. Kept identical to the embedded `MODEL`. |
| `architecture-library.js` | The shared visual language (icons, colour tokens, flow styles). Linked/copied by default or inlined with `--inline`; never edited per diagram. |
| `diagram-engine.js` | The layout + self-check engine (`DiagramEngine.create(model)` → `layoutStage`, `selfCheck`). Shared with the DSL translator so a diagram's geometry can be validated without rendering a page. Linked/copied by default or inlined with `--inline`; never edited per diagram. |
| `architecture-diagram-element.js` | Optional plain-global `<architecture-diagram>` web component. It mounts the renderer in a shadow root and accepts `src` or an inline JSON child script. Keep it beside `template.html` because it loads the shared renderer source from that file. |

The handover also lists the CDN dependencies, any placeholders and assumptions,
the selected layout engine, and the browser used for validation. For repeatable
generation, `scripts/build_bundle.py` embeds the portable JSON in the canonical
template without copying or rewriting renderer logic. For YAML authors, use
[`assets/translate.html`](../skills/archnime-renderer/assets/translate.html)
to parse, structurally validate, geometry-check, and download an HTML result in
the browser; serve the repository over localhost when the page needs to fetch
its template and sidecars.

### Runtime dependencies

Pinned CDN scripts, loaded by the browser template, may be vendored for offline delivery:
`d3` 7.9.0, `@dagrejs/dagre` 1.1.4, `elkjs` 0.12.0, `gif.js` 0.2.0. Missing `d3` shows a visible
notice; missing `dagre` falls back to a deterministic layered layout; explicit
ELK models wait for the pinned asynchronous layout preparation; missing
`gif.js` disables only GIF export.

Animated SVG export keeps every rendered stage in one SVG `<g>` and cycles them
with CSS `@keyframes`; reduced-motion users see stage 1. The export carries a
flow legend and warns when it exceeds roughly 2 MB.

The **Mermaid** export writes a `.mmd` file containing a single
`architecture-beta` snapshot of the selected state. It preserves services,
nested packages, built-in type icons, and directional connectivity. It is a
lossy interchange format: boundaries, wire labels/types, and staged history
are not representable in Mermaid architecture diagrams. The YAML/JSON model
remains the source of truth for those semantics. The paired DSL CLI emits the
same projection with `translate_transition_diagram.py --mermaid`.

Catalog types can extend the base icon set through `meta.icons`: use a
built-in alias such as `worker: agent`, or provide an inline SVG definition
with `viewBox` and `markup`. The validator keeps the 11 built-in types intact;
`kind` continues to determine node fill and stroke. The shared library merges
registrations per model, so one diagram cannot mutate another diagram's icons.

### Multi-view bundles and deployment

The renderer accepts the DSL translator's compact v2 bundle shape: shared
catalog/package data lives in `shared`, while `views` retain materialized
stages and only per-view deltas. The `?view=<viewId>` URL parameter and View
selector choose the active model. `navigateTo` on a node or flow step changes
that parameter without a page reload; the first view is the interactive root
breadcrumb target. `contains` double-click/Enter drills into a contained view
or expands and zooms to a contained package.

Deployment views normalize logical components to deterministic physical IDs
such as `orders-orders-host-1`, emit one representative route per logical wire,
and lay
instances inside distinct nested region/cluster/host infrastructure outlines.
See the renderer data model and layout references for the normalized contract.

Comparison bundles reuse the same v2 navigation model: each candidate is a
view over the shared catalog, while `meta.comparison` supplies weighted
criteria, the recommended option, and per-option trade-offs. The side panel
shows the criteria matrix and option notes; playback is disabled and shared
nodes retain keyed identity when options change.

### Shadow-root web component

For client-side embedding, load the shared files in order and register the
element:

```html
<script src="architecture-library.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
<script src="diagram-engine.js"></script>
<script src="architecture-diagram-element.js"></script>
<architecture-diagram
  src="orders.model.json"
  stage="2"
  mode="interactive"
  perspective="all"
  controls="full"></architecture-diagram>
```

Use `<script type="application/json">{ ... }</script>` inside the element
instead of `src` for an inline model. `stage` is one-based and also selects a
flow step or scenario variant according to the model. `mode="static"` freezes
the presentation and hides interaction chrome. `controls` accepts `full`,
`minimal`, or `none`; `perspective` selects one of the renderer's available
perspectives. The component keeps DOM queries, D3 selection, token lookup,
keyboard listeners, layout cache, and exported helper methods inside its
shadow root so multiple diagrams can coexist on one page.

## 3. The procedure

1. **Gather evidence** — read every input (images, sketches, descriptions,
   existing diagram source, structured models). Record components, boundaries,
   routes, identity decisions, and uncertainties. Never invent a router,
   boundary, traffic percentage, or service the evidence does not support.
2. **Choose the mode** — *staged* when current and target states or an explicit
   sequence are given; *one-shot* for a single architecture with an entry
   animation and route emphasis; *flow* when one topology should be followed
   through ordered calls, returns, grouped work, parallel work, and retries.
3. **Create the portable model first** — `meta`, `canvas`, `catalog`,
   `packages`, and either `stages` or a `flow` with its normalized step list.
   Give each architectural component one stable ID for the whole sequence.
   Embed the same object as `MODEL` in the HTML.
4. **Select the layout engine** — use `auto` by default: it selects ELK for
   deeply nested compound packages, dagre for flat directional graphs, and
   force for peer meshes. Choose explicit `elk`, `dagre`, `force`, or `manual`
   only when the evidence requires an override.
5. **Resolve semantic levels** — model C4-style Context → Container → Component
   with nested `packages`; collapsed is the default.
6. **Build from the template** — preserve the keyed D3 joins and stable IDs; use
   the shared icon/style library; do not invent node shapes, line colours, or
   flow styles.
7. **Validate** — run `diagramSelfCheck()`, which retries each stage through a
   bounded collapse/expand scenario matrix. Walk every stage, exercise search,
   package caption and frame expand/collapse, zoom/fit, every export, presenter
   and print modes, light/dark themes, and reduced motion.
8. **Deliver the bundle.**

For a reproducible bundle build:

```bash
python skills/archnime-renderer/scripts/build_bundle.py \
  --template skills/archnime-renderer/assets/template.html \
  --model path/to/model.json \
  --output path/to/diagram.html
```

## 4. The portable model

```jsonc
{
  "meta": {
    "title": "Orders extraction",
    "subtitle": "...",
    "layout": "auto",              // auto | dagre | elk | force | manual
    "direction": "LR",             // layered direction: LR | TB
    "level": "Container",          // breadcrumb "you are here"
    "levels": ["Context", "Container", "Component"],
    "autoExpandChangedPackages": true,
    "playIntervalMs": 3200,
    "flowPresentation": {          // optional secondary-flow treatment
      "secondaryTypes": ["control", "neutral"],
      "mode": "deemphasize",       // deemphasize (fade) | hide (drop from view)
      "secondaryRoute": "direct",  // direct | bundle (shared lane for named `bundle` groups)
      "bundleBend": 28, "bundleSpacing": 18
    },
    "disclosure": { ... },         // optional; see §7
    "gif": { "fps": 8, "maxDurationMs": 10000 }   // capped: fps <= 12, duration <= 10 s
  },
  "canvas": { "w": 1520, "h": 860, "minWidth": 1000 },   // logical SVG space, not CSS px
  "catalog": {
    "orders": { "label": "Orders service", "detail": "owns order lifecycle",
                "type": "service", "shape": "service", "kind": "new",
                "w": 170, "h": 64, "level": "Component" }
  },
  "packages": {
    "commerce": { "label": "Commerce platform", "level": "Container", "children": ["runtime"] },
    "runtime":  { "label": "Runtime components", "level": "Component",
                  "children": ["gateway", "orders", "ordersdb"] }
  },
  "stages": [ { ...stage... } ]
}
```

### `catalog`

One entry per stable component ID — the default appearance for that component in
every stage.

- **`type`** (semantic, selects the icon): `actor`, `user`, `service`,
  `function`, `gateway`, `agent`, `database`, `cache`, `queue`, `topic`,
  `external`, `provider`, `security`, `idp`, `package`.
- **`kind`** (lifecycle/role treatment): `existing` (amber), `new` (cyan),
  `mixed` (cyan-on-amber), `security` (pink), `retired` (grey dashed).
- `shape` is fixed by the library and normally mirrors `type`; `w` / `h` are
  logical size; `level` sets the C4 level.

A stage node may override `label`, `detail`, `kind`, `w`, `h`, and role text —
never identity or semantic type.

### `packages`

A parent with `children` of leaf IDs or other package IDs; nesting is valid. A
collapsed package renders as one block and visible wire endpoints are rewritten
to it. Expanding it makes its children part of the stage's **single global
layout** (dagre and ELK lay expanded packages out as compound/parent clusters); the outline is
drawn around where the members settled.

Keep grouping disciplined:

- Expand **one meaningful level at a time**. The layout is one pass, not a
  per-package sub-layout — two heavily cross-linked sibling packages, or three
  levels of nesting, will overlap in dense graphs. Use separate stages for
  deeper C4 drill-down.
- **Do not package a single node** — a one-member expanded package draws no
  outline; keep it collapsed if you want the tier labelled.
- **Group members that sit near each other in the flow.** A package holding both
  an IdP at ingress and a notifier at egress becomes a full-width box that
  overlaps everything.
- `force` layout tolerates **at most one** nested package; beyond that use
  `layout: manual`.

### `stages`

```jsonc
{
  "id": "target",
  "title": "Target state",
  "summary": "...",
  "changes": ["Repurposed: ...", "Introduced: ..."],
  "callout": "...",
  "expandedPackages": ["commerce", "runtime"],   // default expansion for this stage
  "layout": "dagre",                             // optional per-stage override
  "boundaries": [ { "id": "regulated", "label": "Cardholder data scope",
                    "tone": "security", "contains": ["orders", "ordersdb"] } ],
  "nodes": [ "client", { "id": "gateway", "kind": "mixed", "detail": "..." } ],
  "wires": [ { "from": "gateway", "to": "orders", "type": "data",
               "label": "/orders", "flow": true } ],
  "changed": ["gateway", "orders"],
  "disclosure": { ... }                          // optional per-stage; see §7
}
```

- **`changed`** names only nodes introduced, moved with architectural meaning,
  repurposed, or retired in that stage — not nodes that merely gained a caller.
- For a transition, the renderer compares the first and last stage and
  auto-expands only the ancestor packages of nodes that actually differ.

### Boundaries — ownership, trust, or compliance zones (not structure)

Prefer the id-driven form so the rectangle tracks the automatic layout:

```yaml
boundaries:
  - id: regulated
    label: Cardholder data scope
    tone: security                 # optional; security renders pink
    contains: [ orders, ordersdb ] # rectangle computed from these members each stage
```

`{ id, label, tone?, x, y, w, h }` with explicit coordinates still works but
drifts whenever the node set, canvas, or layout changes and usually trips
`boundary-straddle`. A boundary whose members equal a package's is redundant —
make it span a subset or something that crosses package lines.

**Collapse and boundary honesty.** A boundary is only honest as a rectangle when
everything inside it is within its scope. When a collapse folds a boundary's
whole visible scope into a subset of — or the same block as — another boundary's
scope, and the two are disjoint in the model, an enclosing rectangle would read
as a false "A contained by B". The renderer draws that boundary as a small
dashed **tag on the shared block(s)** in its tone instead. Collapse always
works; only the degenerate boundary's rendering changes. Two disjoint zones that
keep exclusive members but collide on a shared collapsed block get those
exclusive members separated (Venn overlap, not one swallowing the other);
genuine cross-cuts that share a real model leaf stay overlapping.
When two boundaries genuinely cross-cut — they share members but each also has
exclusive members — the renderer gives their computed envelopes deterministic
visual lane separation when their rails would otherwise coincide. This keeps
the scopes readable without moving shared blocks or changing their membership;
the extra paint-space inset does not imply package hierarchy.

### Wires and the permanent flow mapping

`{ from, to, type, label?, flow?, layer?, priority?, bundle?, offset? }`.

| `type` | Rendering | Meaning |
| --- | --- | --- |
| `data` | solid cyan, 2.6px | Request, event, or payload flow |
| `security` | dashed pink, 2.2px | Authentication, authorization, identity |
| `control` | dotted purple, 2.2px | Configuration, orchestration, control |
| `compat` | dashed amber, 2.2px | Temporary compatibility route |
| `neutral` | solid grey, 1.6px | Supporting call, not central to the story |

These mappings are permanent and live in `architecture-library.js`; a diagram
never re-decides them. `flow: true` adds the animated dashed direction overlay
(respecting `prefers-reduced-motion`). `layer: secondary` marks a supporting
route for disclosure and presentation treatment. `bundle` names a shared
secondary lane when `flowPresentation.secondaryRoute` is `bundle`. Arrows point
caller → callee; a bidirectional relationship is two explicit wires. Legacy
`kind` values (`legacy`, `new`, `compat`, `neutral`) still map to the fixed
styles. A named bundle groups related lanes but does not lock them to Curved;
the live Curved, Orthogonal, or Direct selector applies to every wire.

**At most one line per same-direction, same-type relationship, at every zoom
level.** The renderer merges wires that resolve to the same `(from, to, type)`
once the current view's package collapse is applied — including two
leaf-level wires that only coincide after their owning packages fold up.
Distinct labels join with `" + "`; identical labels collapse to one. A
*different* type between the same pair (`data` + `security`, say) stays a
separate line, and the reverse direction (`B → A`) is a different
relationship, not a duplicate. Never author a second same-type wire hoping to
show two labels — write one wire with both facts in the label, or give it a
real second type.

When same-type constituents merge after collapse, a `primary` disclosure layer
wins over `secondary`; named bundle, offset, and priority metadata are retained
when the first constituent did not define them. Parallel wires receive a
deterministic lane offset even when their authored offset is zero, so distinct
types and directions cannot paint over one another.

Full schema and migration patterns:
[`references/data-model.md`](../skills/archnime-renderer/references/data-model.md).

### Fixed flow walkthroughs

Flow models keep one synthetic stage for layout and add `flow.steps` for the
narrative controller. The template renders a numbered timeline, active wire
markers, and step copy while keeping node positions stable. A return points to
the earlier forward wire; `group` and `parallel` make multi-edge work explicit;
`async` and `loop` preserve delivery and retry semantics.
An optional step-level `label` temporarily replaces the selected wire's
permanent label, which is useful when one route carries different operations
over time.
Set `meta.flow.intro: true` to add a synthetic, non-geometric overview step
that lists the authored step titles before the active walkthrough.
Active returns render as dashed arrows; parallel steps add fork/join glyphs; a
loop step shows a retry badge containing its `repeat` condition.
Set `meta.flow.render` to `all-steps` for a static printable overview with all
flow-mapped wires numbered, or `single` to hide walkthrough controls for a
slide-friendly frame; `stepwise` is the default.

Selecting a node focuses the rendered view to `meta.focusHops` graph hops
(default `1`). This only hides distant SVG layers after layout, so node
positions remain stable; Escape or selecting the same node clears the focus.

## 5. Layout engine

`auto` picks per stage:

- **ELK** (layered) when the visible graph has two or more package-parent
  levels and needs a true compound hierarchy. `auto` selects it; explicit
  `layout: "elk"` remains available and requires awaiting the engine's
  asynchronous preparation.
- **dagre** (layered) when most nodes are low-degree (≤ 3–4 connections), the
  graph is flat, and it has clear upstream/downstream structure. Uses
  `direction` for rankdir.
- **force** (D3 `forceSimulation` + `forceCollide`) when a substantial share
  (~35 %+) of nodes are high-degree and endpoint structure is weak.

Spacing is derived from local density (a ~20–40 px margin from the busiest
layer/degree) and feeds dagre/ELK separation, force collision, package padding, and
label-candidate distances. Clearance is ordered: node-to-node first, then
package padding, then a larger boundary-zone inset. High-degree nodes get an
extra label-clearance lane. Disjoint boundary groups receive a separation pass,
and package/boundary captions are placed against settled geometry rather than
pre-layout coordinates. Expanded package clusters are pushed apart in **both**
engines (force previously only pulled members together).

When ELK is loaded, preparation scores the complete route and label result for
each bounded expansion scenario. A clean baseline keeps its default strategy;
only a scenario with collisions prepares alternate deterministic
layering/placement strategies and retains the lowest-scoring result. **Tune
layout** performs the same bounded tuning for the current stage and
expansion state. Manual stages keep their authored node positions while Tune
searches routes and labels; automatic stages also penalize foreign nodes that
land substantially inside a boundary envelope. Curved wires keep stable endpoint lanes while searching their
cubic Bézier control points on both sides of the chord; if no clear curve exists, the
wire uses the collision-aware orthogonal safety route and records the fallback.
The retry affects presentation state only; semantic identities and
relationships remain fixed.

Leaf node boxes
auto-grow in width to fit their detail line and longest label word up to a 300px
  cap, and existing SVG shapes are resized when keyed node dimensions change.
  After the separation passes settle, a fit pass translates — and only if that
  cannot fit, uniformly scales — the layout back inside `canvas` before wires
  and labels are routed. Explicit legacy boundary rectangles follow that fit too.

Layout is a bounded search, not a one-shot placement. Each stage/scenario is
retried from a stable seed with progressively wider node, package, boundary, and
label lanes; the best trial is retained and a clear trial stops early. The
default is 12 trials per scenario (hard cap 32), and the scenario matrix is
capped separately (default 20, hard cap 32). Positions remain deterministic —
reloading produces the identical layout. See
[`references/layout.md`](../skills/archnime-renderer/references/layout.md).

The stage's fully expanded ("master") layout is solved once; its leaf positions
seed every other expansion state (and a collapsed package is seeded at its
members' centroid), so blocks stay put across states and force meshes do not
re-settle per state. `diagramSelfCheck()` evaluates the all-expanded scenario
first and seeds the rest from it. The selected layout per `(stage, expansion
set, presenter)` is memoised — highlight, search dim, hover, and disclosure-step
re-renders reuse it; only stage nav and package expand/collapse re-solve.

### Wire style, text metrics, and clearance contracts

- **Wire style never re-places nodes.** Switching Curved, Orthogonal, or Direct
  reroutes the settled layout. Node boxes, package and boundary envelopes,
  expansion state, and a committed Tune result are kept, and returning to a
  style reproduces its earlier geometry exactly. Cached layouts are rerouted
  lazily, when next requested, so a switch costs one reroute per layout shown.
  Only Tune, expansion, and print/media refresh recompute placement.
- **Requested versus actual routing is recorded per wire.** `requestedRouting`
  is the selected style; `actualRouting` is the geometry family painted
  (curved Béziers, orthogonal polylines, or direct polylines with a diagonal
  run); `routeFallback` and `routeFallbackReason` say when they differ.
  Every wire stays in the selected style: a blocked Curved wire follows a
  searched clear route with rounded corners, and a blocked Direct wire is that
  route pulled taut into straight runs. Only a wire with no clear route at all
  is reported, as `<style>-blocked`, still drawn in its style.
  `tests/routing_family_check.mjs` checks every wire of every model in every
  style, and `tests/route_fallback_check.mjs` bounds the fallbacks per model
  and style against a recorded budget.
- **Text is measured from a pinned table, not the host.** The engine sums
  per-character advances for Inter Variable (a table of 220 characters at
  five weights, in font units) and the template embeds the same font, so
  geometry is identical on Windows, Linux, and CI regardless of installed
  fonts, hinting, or font-load timing. An injected `measureContext` still
  overrides the table (the embedded-element tests use one), and characters
  outside the table measure as one em. Perspective emphasis therefore never
  changes text weight or size; it uses colour, stroke width, and underline.
  `scripts/gen_font_assets.mjs` regenerates the table and embedded font.
- **Directional order is protected, and so are trust envelopes.** In the
  ranked profile, a foreign node or package that sits upstream of a trust
  boundary and would touch it is cleared by opening the rank gap downstream
  (every node after it shifts along the rank axis and the logical canvas
  grows); pushing it upstream would reverse its rank. Packages outside a
  boundary's scope keep the same clearance outside the envelope that member
  packages keep inside it (`boundary-package-gap`).

## 6. Interaction and export

- **Search** by component name or ID — expands ancestor packages, highlights the
  node and its wires, dims the rest, and animates an SVG zoom to the node. `Fit`
  restores the view. `Esc` clears.
- **Stage navigation** — Prev / Next, numbered pills, `←` `→` `Home` `End`, and
  Play (auto-advance at `meta.playIntervalMs`).
- **Package expand/collapse** — click or keyboard-activate an outline or block.
  Structural changes commit the validated container, child blocks, boundaries,
  wires, and labels together, avoiding a transient overlap during the change;
  ordinary same-shape stage changes retain their animated morph.
- **Presenter mode** — the `Present` toolbar toggle (or `P`) hides
  search/hover affordances and the side panels, and raises label size and
  contrast; the button reports its state and switches to `Exit present`.
- **Stage tweening** — transitions settled wire paths and stable node shapes
  over the normal duration; `prefers-reduced-motion` uses a zero duration.
- **Print** — dedicated print CSS.
- **Perspectives** — a `Perspective` dropdown offers `All`, the default
  `Data`, `Security`, `Migration`, and `Operations`, or the exact
  `meta.perspectives` list when one is supplied. Migration surfaces
  compatibility/control routes plus changed, new, mixed, and retired
  components. Operations surfaces control/configuration, compatibility,
  retired, deployment, and `ops: true` layers. Advanced `Control`, `Compat`,
  `Neutral`, and `Trust & compliance` (`zones`) options may be requested
  explicitly. Filters restyle or emphasize rendered layers without relayout;
  the choice is persisted per diagram title.
- **Documentation SVG** — **SVG (documentation)** exports the selected settled stage
  at full content bounds, independent of presenter zoom, with the pinned Inter
  font, explicit opaque background, and preserved vector paths. One file carries the
  light and the dark palette and follows the reader's `prefers-color-scheme`.
  `scripts/export_svg.mjs spec.yaml --out diagram.svg` writes the same SVG headless,
  offline and byte-stable, for CI. Use it as the
  static embedding artifact for Markdown/web docs and as the source of a PNG
  fallback for formal documents. Export all relevant stages/views explicitly;
  no SVG image embedding retains the interactive controls. See
  [documentation-export.md](../skills/archnime-renderer/references/documentation-export.md).
- **Export** — SVG (lossless source of truth), PNG, JPEG (selected stage +
  current zoom), Animated SVG (all stages as CSS-timed groups), and GIF (the
  staged sequence, capped at `fps` ≤ 12 and `maxDurationMs` ≤ 10 000).
- **Flow sequence export** — flow models can download a Mermaid
  `sequenceDiagram` companion containing participants, calls, returns, refusals
  (`--x`), grouped or parallel work, and retry loops, and a native
  **SVG (sequence)** view (also `export_svg.mjs --sequence`): a lifeline per flow
  node and a numbered message per step, returns dashed, refusals ending in a cross.
- **Comparison navigation** — v2 comparison options switch through keyed
  views, show weighted criteria and trade-offs, mark the recommendation, and
  do not autoplay.
- **Deep links** — `?stage=N` opens a specific stage; `?check=1` runs the
  self-check on load and writes the result to the status line.
- **Responsive** — SVG `viewBox` + `width: 100%`; a narrow-viewport branch keeps
  horizontal scrolling inside a bounded diagram scroller, never the page.

## 7. Progressive disclosure (dense stages)

When a single state has too many simultaneous routes, a stage `disclosure`
sequence reveals `primary` wires first, then supporting `secondary` wires. This
is independent of a current-state/target-state transition and does not move the
settled layout.

```yaml
disclosure:
  mode: progressive
  initialStep: 0
  intervalMs: 900          # auto-advance; auto: false requires the on-screen control
  layers:
    - { id: primary,   label: primary }
    - { id: secondary, label: supporting }
```

A wire joins a layer via `layer: primary|secondary`; if omitted, the renderer
infers `secondary` from `flowPresentation.secondaryTypes` and assigns the rest to
`primary`.

## 8. Validation — `diagramSelfCheck()`

Open the HTML from disk and run `diagramSelfCheck()` in the console (or append
`?check=1`). `diagramSelfCheck({ displayed: true })` instead checks the layout exactly as painted (current wire style, expansion, and Tune), tagging each finding `[displayed]`. A flow's synthetic stage is checked across the same expansion matrix as every other stage. It checks every stage through a deterministic scenario matrix:
the model default, collapsed, configured, one-package, nested-level, pairwise,
and all-expanded states, subject to the model's
`layoutValidation.maxExpansionScenarios` cap. Viewer overrides are ignored for
the model-default and configured checks, so a previous click cannot contaminate
the audit. Every scenario gets at most `layoutValidation.maxTrials` bounded
layout attempts (default 12, hard cap 32), and scenario tags such as
`[all]` or `[expand:package-id]` identify the failing state. The result is an
array of `{ type, detail }`.

| Type | Meaning |
| --- | --- |
| `unknown-node` / `duplicate-node` | Stage ID not in the catalog / appears twice |
| `wire-unknown-endpoint` / `wire-self` | Endpoint absent from the stage / collapsing a package made a self-edge |
| `changed-missing` | `changed` names an invisible node |
| `node-overlap` | Visible node rectangles intersect |
| `label-collision` / `label-node-collision` / `label-label-collision` | No clear settled-curve position for a wire label |
| `wire-label-over-endpoint` | A wire label overlaps a source/target silhouette or rendered node text zone |
| `wire-too-short` | A visible settled wire is shorter than the effective `meta.minWireLen` |
| `edge-crosses-node` | A settled wire path passes through an unrelated visible node |
| `edge-crosses-package` / `edge-crosses-boundary` | A curved or orthogonal wire enters a package or boundary that holds neither endpoint |
| `edge-route-fallback` | A wire needed the orthogonal safety route or an orthogonal route fell back to a diagonal curve |
| `package-label-collision` | Nested package headings overlap |
| `package-label-overflow` | A package caption exceeds its reserved heading box |
| `package-overlap` | Two sibling package outlines intersect (neither nested in the other) |
| `package-contains-foreign-node` | A node that is not a member of a package (at any nesting level) sits inside that package's rendered outline — usually a spacing shortfall on a free-standing node near an expanded package, not an over-grouped model |
| `boundary-straddle` | A `contains` member is not fully inside its boundary, or a non-member sits mostly inside one |
| `boundary-label-collision` | Two boundary titles land on the same spot (there is no `boundary-overlap` rule — overlapping/nested boundary rectangles are often correct, unlike packages) |
| `boundary-label-overflow` | A boundary title exceeds its reserved caption box |
| `boundary-chip-overflow` | A collapsed boundary tag leaves the logical canvas |
| `boundary-chip-collision` | A collapsed boundary tag overlaps another block, package caption, wire label, or tag |
| `package-boundary-label-collision` | A boundary title lands on a package heading — a boundary is allowed to wrap a package's exact membership, so this isn't a model problem; see below |
| `label-truncated` / `detail-overflow` | Text exceeds its block after the renderer already auto-grew the node to its 300px width cap — shorten the detail line (≈30 chars) or label |
| `stage-overflow` | A node, package, boundary, or label leaves the logical canvas *after* the fit-within-canvas pass — the content is genuinely larger than `canvas`, so grow it or expand fewer levels |

For any spacing or caption finding: widen the density margin and retry budget
only within their caps first; then widen the canvas, package padding, boundary
inset, or label lanes as appropriate. Do not solve a caption collision by
shrinking text below the visual-language minimum. For
`package-contains-foreign-node`: the renderer repeats package clearance after
each boundary/deconfliction pass and recomputes boundaries before routing.
Widening the canvas is still reliable for `dagre` and often needs a bigger
jump than expected. Consider whether the node is honestly a package member,
then fall back to `layout: manual` — canvas widening is markedly weaker for
`force` layout specifically, since the simulation settles in its own space
before being rescaled to fit the canvas.

`package-boundary-label-collision` is the one row in this table that isn't
fixed by editing the model. A boundary that wraps a package's exact
membership shares that package's topmost/leftmost reference member, so the
two rendered corners — and their title text — land near each other
regardless of node placement or canvas size. The template keeps them apart
by giving a boundary's own padding a larger fixed offset than a package's
headroom; if this check fires, that constant has drifted, and the fix
belongs in `resolveBoundaries`, not in the diagram.

The full manual pass (CDN-missing behaviour, keyed morphing across stages,
export inspection, viewport sizes, themes, reduced motion) is in
[`references/validation.md`](../skills/archnime-renderer/references/validation.md).

## 9. Known limitations

Each trial is a **single global pass** (dagre, ELK, or force) with package outlines
drawn afterward — not recursive per-package layout — and the renderer searches a
bounded sequence of wider passes. The clustering post-pass reduces overlap but
a model with two heavily cross-linked sibling packages can still exhaust the
retry budget and trip `package-overlap`. When it does, the model is asking for
more grouping than a flat layout can show at once: expand fewer levels, re-group
members that sit near each other, split a package that spans the whole flow,
move deep C4 detail into its own stage, or use `layout: manual`.

A related failure: a free-standing node can end up rendered *inside* an
expanded package it doesn't belong to (`package-contains-foreign-node`). The
renderer now repeats the bounded push across nested package outlines after
deconfliction and settles boundaries again before routing. If the finding
remains, the push has run out of usable canvas — especially once a package's
own outline already spans most of the canvas. Widening the canvas is the
reliable fix for `dagre`; for `force` layout it is markedly weaker (the
simulation settles in its own coordinate space and gets rescaled to fit
afterward, so a bigger canvas mostly scales the whole picture up rather than
freeing new relative room) — `layout: manual` with explicit coordinates is
usually the faster real fix once widening stalls.

## 10. Files in the skill

```text
skills/archnime-renderer/
  SKILL.md
  assets/
    template.html                       the diagram shell + embedded MODEL + DOM/D3 rendering and interaction
    diagram-engine.js                   layout + self-check engine (window.DiagramEngine); shared with the DSL translator
    architecture-library.js             permanent icons, colour tokens, flow styles (ARCHITECTURE_LIBRARY)
    architecture-diagram-element.js     optional shadow-root <architecture-diagram> web component
    translate.html                       browser YAML translator, schema validator, geometry check, and HTML download
    examples/
      portable-transition-model.json    2-stage current -> target model with a contains boundary; self-checks clean
      dense-mesh-model.json              manual layout, high degree, parallel edges, nested package, bundled secondary routes
      nested-sibling-packages-model.json  regression fixture: two sibling packages nested under one parent, both auto-expanding, plus a nearby free-standing node
      wire-merge-model.json               regression fixture: member-to-member wires of the same type merge into one line when their packages collapse
      boundary-label-collision-model.json  regression fixture: two boundary titles forced onto the same spot
      comparison-views.json               v2 comparison options with criteria and trade-offs; generated from the DSL example
      commerce-views.json                 v2 context/deployment/flow bundle with infrastructure nesting and navigation; generated from the DSL example
  scripts/
    build_bundle.py                     deterministic model-to-HTML builder; linked multi-file default, --inline embeds the sidecars for single-file delivery
    regen_fixtures.py                   regenerate or verify the DSL-derived fixtures (npm run regen-fixtures)
    validate_transition_diagram.js      browser-port validator (loaded by translate.html)
    translate_transition_diagram.js     browser-port DSL-to-MODEL mapper
  tests/
    render_check.mjs                    headless Chromium check: diagramSelfCheck + rendered-DOM inspection + collapse round trip
    element_check.mjs                   headless Chromium check of the shadow-root <architecture-diagram> web component
    visual_audit.mjs                    retained responsive evidence audit across wide/medium/narrow, presenter, and print modes
    test_build_bundle.py                Python regression tests for editable and ship-mode HTML bundles
    translate_check.mjs                 browser translator + JS-validator rule-parity check over both examples and every invalid fixture
    fixtures/                           portable models exercising collapse / boundary cases the examples do not
  references/
    data-model.md                       full schema, boundaries, wires, identity/migration patterns
    layout.md                           engine choice, density spacing, edge/label routing, nested packages, boundaries
    visual-language.md                  permanent flow + node mapping, typography tokens, contrast targets, themes
    validation.md                       diagramSelfCheck reference + the manual browser and truth passes
```

For a non-destructive preview, generate the source YAML, portable model, HTML
bundle, and browser self-check evidence inside a dedicated temporary workspace.
Promote only reviewed artifacts into the project.
