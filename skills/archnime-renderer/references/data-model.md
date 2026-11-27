# Portable data model

The portable artifact is one JSON or YAML document. All HTML producers use the
same embedding contract: one `<script type="application/json" id="diagram-model">`
payload followed by the renderer script, which reads
`JSON.parse(document.getElementById("diagram-model").textContent)`. The payload
escapes `<` before insertion, so labels cannot terminate the data script. Keep
the sibling model file in sync so another AI tool can regenerate the diagram
without reading SVG geometry.

```json
{
  "meta": {
    "title": "Orders extraction",
    "layout": "auto",
    "minWireLen": 72,
    "perspectives": ["data", "security", "control", "zones"],
    "direction": "LR",
    "levels": ["Context", "Container", "Component"],
    "autoExpandChangedPackages": true,
    "flowPresentation": {
      "secondaryTypes": ["control", "neutral"],
      "mode": "deemphasize",
      "secondaryRoute": "direct"
    },
    "gif": { "fps": 8, "maxDurationMs": 10000 }
  },
  "canvas": { "w": 1400, "h": 760, "minWidth": 960 },
  "catalog": {
    "orders": { "label": "Orders service", "type": "service", "shape": "service", "kind": "new", "ops": true }
  },
  "packages": {
    "commerce": { "label": "Commerce platform", "level": "Container", "children": ["runtime"] },
    "runtime": { "label": "Runtime", "level": "Component", "children": ["orders"] }
  },
  "stages": [{
    "id": "current",
    "title": "Current state",
    "nodes": [{ "id": "orders" }],
    "wires": [{ "from": "client", "to": "orders", "type": "data", "flow": true }],
    "changed": []
  }]
}
```

State-like views may carry optional `docs` and `adr` strings. The renderer
shows them as links in the active panel and rejects executable URL schemes;
they are references, not layout inputs.

`meta.minWireLen` is a positive logical-pixel minimum for visible settled wire
geometry. `meta.perspectives`, when present, is the authoritative ordered list
of filter options; the renderer adds only `All` as the reset. Supported IDs are
`data`, `security`, `migration`, `devops`, `control`, `compat`, `neutral`, and
`zones` (with `all` also accepted for an explicit reset). `migration` is the
composite transitional lens over compatibility/control routes and changed,
new, mixed, or retired components. The optional boolean `ops` tag is
preserved on catalog nodes, node overrides, wires, packages, boundaries, and
deployment infrastructure for the Operations perspective.

## Fixed flow walkthroughs

A renderer model may contain a `flow` sibling alongside a single synthetic
`stages` entry. The stage supplies the stable topology to the layout engine;
`flow.steps` supplies the narrative controller:

```json
{
  "flow": {
    "id": "checkout",
    "title": "Checkout request path",
    "nodes": ["client", "gateway", "orders"],
    "wires": [{ "from": "client", "to": "gateway", "type": "data" }],
    "steps": [{
      "id": "step-1",
      "kind": "call",
      "edges": [{ "from": "client", "to": "gateway", "wireFrom": "client", "wireTo": "gateway" }],
      "note": "The browser sends the request."
    }]
  }
}
```

The template lays the synthetic stage once, then changes active wire/marker
classes, the panel, and the numbered timeline as the step changes. `group`
and `parallel` are preserved as flags on a normalized step; `return` and
`refused` edges point back to the forward wire with `wireFrom`/`wireTo`. Flow layout is fixed
for the walkthrough, so step changes must not recompute node positions.

## Multi-view bundles and deployment

DSL 2.0 translators emit a compact bundle with shared catalog/package data and
per-view materialized stages. A view may carry only catalog/package deltas
(deployment views add physical instances and infrastructure packages):

```json
{
  "meta": { "title": "Commerce architecture pack" },
  "shared": {
    "catalog": { "client": {/* ... */}, "orders": {/* ... */} },
    "packages": { "commerce": {/* ... */} }
  },
  "views": [
    { "viewId": "context", "viewMode": "system", "stages": [/* ... */] },
    { "viewId": "production", "viewMode": "deployment",
      "catalog": { "orders-orders-host-1": {/* ... */} },
      "packages": { "deployment_us-east": {/* ... */} },
      "deployment": {/* ... */}, "stages": [/* ... */] }
  ]
}
```

The template merges `shared` with the selected view's deltas, selects
`views[*]` from the `view` URL parameter, populates the view selector, and
keeps the first view as the root breadcrumb. A
`navigateTo` target changes that parameter; a catalog `contains` target either
changes views or expands a package and zooms to its computed outline. Package
drill-down is zoom-only and intentionally does not create a breadcrumb entry;
breadcrumbs represent view navigation only.

Deployment normalization keeps logical catalog IDs authoritative while adding
stable physical IDs such as `orders-orders-host-1`. Its `deployment` payload
contains `infrastructure`, `roots`, and `placements`; infrastructure nodes are
represented as deployment packages solely for the nested layout profile and
are styled separately from logical packages:

```json
{
  "deployment": {
    "infrastructure": [{ "id": "orders-host", "kind": "host", "parent": "orders-cluster", "children": [] }],
    "roots": ["us-east"],
    "placements": [{ "component": "orders", "target": "orders-host", "replicas": 2, "instanceIds": ["orders-orders-host-1", "orders-orders-host-2"] }]
  }
}
```

Logical deployment wires retain `logicalFrom`/`logicalTo` and use
`replicaFanout: "representative"`; the translator emits the first source and
first target instance for each logical wire rather than every replica pair.

Logical wires keep `logicalFrom`/`logicalTo` and use one deterministic
representative physical route per logical relationship; no relationship is
invented by placement and replica count does not create an N×M wire set.

## `meta` and `canvas`

- `layout` is `auto` (recommended), `dagre`, `elk`, `force`, or `manual`. `auto` selects asynchronous ELK for deeply nested compound graphs; `direction` is the layered direction (`LR` or `TB`) for dagre and ELK. The engine is chosen and run when the diagram is built (`build_bundle.py` runs `store_geometry.mjs`; `translate.html` does the same in the browser); the delivered page shows the stored layouts and loads no layout library. Callers of the whole engine (`diagram-engine.js`) using ELK must await `DiagramEngine.create(model).ready` before calling the synchronous instance layout or self-check methods. The static one-shot `DiagramEngine.layoutStage`, `layoutFlow`, and `selfCheck` helpers always return Promises and reject failed preparation.
- `levels` drives the visible breadcrumb. Use the C4 vocabulary `Context`, `Container`, and `Component` unless the source uses a more precise level.
- `autoExpandChangedPackages` defaults to true for a transition. GIF defaults are intentionally capped to keep exports usable.
- When a collapse folds a boundary's whole visible scope into a subset of (or the same block as) another disjoint-in-the-model boundary's scope, the renderer draws that boundary as a small dashed tag on the shared block instead of an enclosing rectangle — so it never reads as a false "A contained by B". Collapse itself is never blocked.
- `flowPresentation` controls optional treatment of secondary routes without changing the permanent five-type visual language. `secondaryTypes` defaults to `control` and `neutral`; `mode` may be `deemphasize`, `bundle`, or `hide`; `secondaryRoute` may be `direct` or `bundle`.
- `perspectives` is an optional renderer-model array that limits the perspective options offered by the template. The default options are `data`, `security`, `migration`, and `devops` (labeled Operations); advanced values `control`, `compat`, `neutral`, and `zones` may be supplied explicitly. `all` is always included. Perspective filtering changes visibility/emphasis only and never recomputes layout. The selected value is persisted per diagram title. The old `trust` ID is invalid; use `zones` (Trust & compliance).
- `layoutValidation` is renderer-only tuning. `maxTrials` caps bounded spacing retries per stage/expansion state (default 12, hard cap 32); `maxExpansionScenarios` caps the collapse/expand states exercised by `diagramSelfCheck()` (default 20, hard cap 32). Keep these finite.
- A model with `flow` uses one stable stage layout and `flow.steps` for navigation. `meta.flow` may carry `intro`, `autoAdvanceMs`, and `loop` for the timeline controller.
- `canvas` is logical SVG space, not CSS pixels. Grow the canvas before shrinking labels. `minWidth` controls narrow-screen scrolling.
- The renderer uses `{ w: 1600, h: 900, minWidth: 960 }` when a DSL translator receives a document without `canvas`; explicit dimensions remain authoritative.

## `catalog`

Each architectural component has one stable key for every stage. The catalog entry is the default; a stage node can override `label`, `detail`, `kind`, `w`, `h`, and role text. `type` is semantic and selects the shared icon; `shape` is normally the same family and is fixed by the library.

`w`/`h` set a *floor*, not the final box. The renderer grows a leaf node's width to fit its detail line and its longest single label word, up to a 300px cap (the same auto-grow a package block gets for its caption), so a slightly long `detail` widens the node instead of tripping `detail-overflow`. Existing SVG shapes are resized whenever a keyed node's dimensions change, including stage overrides and Presenter mode. Keep the detail line to roughly 30 characters — past the cap the finding stands and the text must be shortened.

Supported semantic types: `actor`, `service`, `gateway`, `agent`, `database`, `cache`, `queue`, `topic`, `external`, `security`, `package`, `llm`, `vector-store`, and `tool`. A node with `variant: "external"` carries the class `variant-external` (dashed outline).

Kinds are `existing`, `new`, `mixed`, `security`, or `retired`. A kind explains lifecycle/role; a type explains what the component is. Never mint an ID for a responsibility that moved into an existing component.

## `packages`

`packages` is optional — omit the key entirely for a flat diagram with no grouping (a one-shot mesh or a simple hierarchical path, for example). A package is a parent node containing leaf IDs or other package IDs. Nested packages are valid:

```yaml
packages:
  commerce:
    label: Commerce platform
    level: Container
    children: [runtime]
  runtime:
    label: Runtime components
    level: Component
    children: [gateway, orders, ordersDb]
```

The renderer collapses packages by default into a single package block and rewrites visible wire endpoints to that block. Clicking a collapsed package node expands it; clicking the package's visible caption or dashed frame hit target collapses it again. The caption uses a transparent filled target and the frame uses a transparent stroke band, so border clicks work without covering child nodes. Both actions recalculate one global stage layout, while a separate top interaction layer keeps the visual outline behind child nodes. In staged transitions, compare first and last stage membership and role data; expand only ancestors of changed IDs. `stage.expandedPackages` can request a default expansion, and a viewer's click is a temporary **stage-scoped** local override, so a collapse in one stage cannot leak into another. Collapsing an ancestor clears its effective nested expansion even if a child was previously opened. The bounded self-check exercises root, child, nested, and all-expanded states across every stage.

Packaging that fights the topology produces overlapping outlines. Keep it disciplined:

- **Prefer one meaningful level of grouping at a time.** The layout is a single global pass (dagre, ELK, or force) with outlines drawn around where members land — it does not run a separate layout per package. The renderer retries wider spacing and checks deeper nesting, but very dense multi-level states can still exhaust the finite budget. For deeper C4 drill-down use staged stages (Context stage, then Container stage) rather than relying on an unlimited expansion.
- **Don't package a single node.** A one-member expanded package draws an outline around one box — the renderer skips that outline. If you want the node labelled as a tier, keep the package collapsed so it renders as a block.
- **Group members that sit near each other in the flow.** A package whose members are at opposite ends of the request path (an "external systems" bucket holding both the IdP at ingress and a notifier at egress) becomes a full-width box that overlaps everything. Split it or leave those nodes unpackaged.
- **`force` layout tolerates at most one nested package.** Mesh diagrams with several packages will overlap; prefer `layout: manual` with coordinates when a mesh genuinely needs multiple groups.

Degenerate boundary tags are part of the layout audit. A `boundary-chip-overflow`
finding means a tag leaves the canvas; `boundary-chip-collision` means it lands
on another block, package caption, wire label, or tag. Chips are non-interactive
annotations so they never intercept node or package clicks.

## `stages`

Every stage lists the semantic state, not coordinates:

```yaml
stages:
  - id: current
    title: Current state
    nodes:
      - { id: client }
      - { id: gateway }
    wires:
      - { from: client, to: gateway, type: data, label: HTTPS, layer: primary }
    changed: []
```

`nodes` accepts either compact string IDs (`nodes: [client, gateway]`) or
objects (`nodes: [{ id: gateway, detail: ... }]`). Use object entries only
when a stage needs a presentation override; identity and semantic type still
come from `catalog`.

For a dense stage, add an optional within-stage disclosure sequence. It is separate from current-state/target-state staging:

```yaml
disclosure:
  mode: progressive
  initialStep: 0
  intervalMs: 900
  layers:
    - { id: primary, label: primary }
    - { id: secondary, label: supporting }
```

Wires use `layer: primary|secondary` to participate. If a wire omits `layer`, the renderer infers `secondary` from `flowPresentation.secondaryTypes` and assigns other wires to `primary`. A viewer can reveal the next layer with the generated control; automatic reveal can be disabled with `auto: false`.

`x` and `y` are optional manual-layout hints. The automatic engines own positions; do not make downstream tools infer semantics from them.

## Boundaries

A boundary is an ownership, trust, or compliance zone — not decorative grouping, and not the same thing as a package (which is structural). Prefer the id-driven form so the boundary tracks the automatic layout:

```yaml
boundaries:
  - id: regulated
    label: Cardholder data scope
    tone: security            # optional; security renders pink
    contains: [ orders, ordersdb ]   # the renderer computes the rectangle from these nodes each stage
```

`{id, label, tone?, x, y, w, h}` with explicit coordinates still works for a deliberate presentation constraint, but hand-tuned coordinates drift whenever the node set, canvas, or layout changes and usually produce `boundary-straddle`. Use `contains` unless you have a specific reason not to. A boundary whose member list matches a package's is redundant — make it span a *different* set (a subset, or something that crosses package lines).

## Wires

Use `type` for the permanent style mapping: `data`, `security`, `control`, `compat`, or `neutral`. The old `kind` values (`legacy`, `new`, `compat`, `neutral`) remain accepted for migration and map to the corresponding fixed style. A wire is `{from, to, type, label?, flow?, layer?, priority?, bundle?, offset?}`. `flow: true` adds the animated direction overlay. `layer: secondary` marks a supporting route for staged disclosure and presentation treatment. `bundle` names a shared secondary routing lane when `meta.flowPresentation.secondaryRoute` is `bundle`; it is optional and should only group semantically related routes. `offset` is an exception for a known crowded route; parallel routes are offset automatically, including when several authors explicitly use `offset: 0`. Bundling affects lane grouping only: the viewer's Curved, Orthogonal, or Direct routing choice applies to every wire.

If package collapse makes multiple wires share the same visible `(from, to,
type)`, the renderer keeps one line, joins distinct labels with `" + "`,
deduplicates identical labels, and lets a primary layer win over a secondary
constituent. Explicit bundle, offset, and priority metadata are preserved when
the retained line did not already define them.

Use a stable pair of component IDs across stages. A route whose semantic type changes should keep its endpoint IDs and change its `type`, so the viewer can understand the transition. Use two explicit wires for bidirectional traffic — `A → B` and `B → A` are different relationships and are never merged.

**Same direction, same type, same visible pair renders as one line.** The renderer merges wires automatically at every zoom level, not just once at authoring time: two wires that resolve to the same `(from, to, type)` after the current view's package collapse are one relationship, not two, because `type` is what the line style actually communicates — two parallel cyan "data" lines between the same blocks reads as a rendering bug, not as two facts. This applies however the duplication arises: two literal entries in `wires` between the same leaf pair, or two different leaf-level wires that both collapse onto the same package pair once their owning packages fold up. Merged labels are joined with `" + "` (exact duplicate labels collapse to one, not `"X + X"`). A *different* type between the same pair (`data` and `security`, say) is a separate, real relationship and is never merged with this one. Model bidirectional or multi-purpose traffic as distinct types when it is semantically distinct — don't add a second same-type wire hoping to show two labels; write one wire with both facts in a single label, or give it a real second type.

## Identity and migration patterns

| Situation | Model it as |
| --- | --- |
| Code migrates from A into existing B | Keep B's ID; change its kind/detail and list B in `changed`. |
| Canary lives inside a gateway | Keep the gateway ID; add data/control wires and describe the split. |
| Component is decommissioned | Show it as `retired` in the retiring stage, then omit it. |
| Temporary bridge | `type: compat`; remove it in the stage where it stops carrying traffic. |
| Shared database during transition | One database ID with explicit data wires from both owners. |
| Package unchanged between endpoints | Leave it collapsed unless the viewer expands it. |
