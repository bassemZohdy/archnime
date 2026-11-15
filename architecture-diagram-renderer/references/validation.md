# Validation

Run this before every delivery. The data model, template, and shared library should travel together.

## Automated checks

Open the HTML directly (`file://`) and run `diagramSelfCheck()` or append `?check=1`. The check covers every stage, and a flow's synthetic stage, across the bounded expansion matrix, each with fresh placements, and reports the types below. `diagramSelfCheck({ displayed: true })` instead checks the layout exactly as painted (current wire style, expansion, and Tune result) and tags each finding `[displayed]`; use it to confirm what a viewer sees after a style switch. Every type below carries a Tune weight; semantic types (`unknown-node`, `duplicate-node`, `wire-unknown-endpoint`, `wire-self`, `changed-missing`, `declared-node-not-rendered`, and the flow-step rules) weigh 1000 so no layout can trade them away.

| Type | Meaning | Fix |
| --- | --- | --- |
| `unknown-node` | A stage ID is not in the catalog | Fix the ID or add its catalog entry |
| `duplicate-node` | An ID appears twice in one stage | Remove the duplicate |
| `node-overlap` | Visible node rectangles intersect | Increase density spacing or change layout |
| `wire-unknown-endpoint` | A wire endpoint is absent from that stage | Add the node or remove the wire |
| `wire-self` | Collapsing a package would make a self-edge | Remove or model the relationship at package level |
| `changed-missing` | `changed` names an invisible node | Fix the stage change list |
| `label-collision` | No settled-curve label position is clear | Shorten the label or move a node |
| `label-node-collision` | A wire label has no candidate clear of a node or high-degree node clearance lane | Shorten the label, move a node, or increase the logical canvas |
| `label-label-collision` | A wire label has no candidate clear of another wire label | Shorten labels or create a separate routing lane |
| `wire-label-over-endpoint` | A settled wire label overlaps a source/target silhouette or its rendered text zone | Move the label lane, move a node, or shorten the label |
| `wire-too-short` | A visible settled wire is shorter than the effective `minWireLen` in an enforced layered layout | Increase spacing/canvas or use a documented manual/force layout |
| `edge-crosses-node` | A settled wire path passes through an unrelated visible node | Move a node, change a rank, or use an explicit route/bundle lane |
| `edge-crosses-package` | A curved or orthogonal wire enters a package outline that holds neither endpoint | Widen the density margin so the router has room to go around, or re-group members |
| `edge-crosses-boundary` | A curved or orthogonal wire enters a computed boundary rectangle that holds neither endpoint | Same as `edge-crosses-package`; check the boundary `contains` list |
| `edge-route-fallback` | A curved route needed the orthogonal safety router, or an orthogonal route fell back to a diagonal curve (advisory, low weight) | Usually clears once P1 spacing or the surrounding layout loosens; inspect any fallback that also has a crossing issue |
| `wire-jump-collision` | A `wireJumps` hop lands on a node or on another wire's label | Widen spacing so the crossing moves, or set `meta.wireJumps: none` |
| `package-label-collision` | Nested package headings overlap | Recompute nested package bounds or shorten the package label |
| `package-label-overflow` | A package caption cannot fit fully inside its outline | Reserve caption width when computing package bounds; if the issue remains, shorten the package label or expand fewer package levels |
| `boundary-label-overflow` | A boundary title cannot fit fully inside its envelope | Reserve title width for computed boundaries; for explicit coordinates, widen the boundary or shorten the title |
| `boundary-chip-overflow` | A collapsed boundary tag leaves the logical canvas | Increase the canvas or shorten the boundary label; the renderer measures the tag in normal and Presenter modes |
| `boundary-chip-collision` | A collapsed boundary tag overlaps another block, package caption, wire label, or tag | Reposition the host members or shorten the boundary label; chip geometry is included in label obstacles but remains a renderer-layout defect if it survives |
| `package-overlap` | Two sibling package outlines intersect (neither is nested in the other) | Expand fewer package levels at once, re-group so members sit together, or split a package whose members span the whole flow |
| `package-contains-foreign-node` | A node that is not a member of a package (at any nesting level) sits inside that package's rendered outline | Usually a spacing shortfall on a free-standing node near an expanded package, not an over-grouped model — see the fix order below |
| `label-truncated` / `detail-overflow` | Text exceeds its block after the renderer already auto-grew the node to a 300px cap | Shorten the detail line (≈30 characters) or the label; a wider `size` only raises the floor, it cannot exceed the cap |
| `boundary-straddle` | A `contains` member is not fully inside its boundary, or a non-member sits mostly inside one | For a member, the boundary should have grown to fit — check the member id is spelled right; for a non-member, move it clear or add it to `contains` |
| `boundary-gap` | Two disjoint computed boundary envelopes touch or overlap | Increase the density-derived boundary gap or separate the member groups before recomputing the envelopes; do not change shared-member scopes just to force rectangle separation |
| `boundary-package-gap` | A package and a trust envelope are closer than the density-derived boundary gap: a package inside the scope lacks inner clearance, or a package outside the scope (not a member) touches or overlaps the envelope | Increase boundary inset relative to package padding in the template/layout policy; the ranked profile opens the rank gap downstream for an upstream foreign package. Never move the package into or out of `contains` to hide it |
| `boundary-label-collision` | A boundary title has no clear candidate, or two boundary titles land on the same spot | The renderer tries multiple in-boundary title positions after layout. Shared-member boundary rectangles may overlap because scopes legitimately cross-cut; disjoint rectangles are handled by `boundary-gap`. Two unreadable titles are a defect regardless. Reposition one boundary's members or adjust `contains` only when the scope definition is wrong |
| `package-boundary-label-collision` | A package heading and a boundary title land on the same spot | Not a model problem — see "Fixing `package-boundary-label-collision`" below |
| `boundary-contains-foreign-node` | A node that is not in an explicit boundary's `contains` list sits wholly inside its rendered envelope (strict scope: ranked and force layouts) | The renderer pushes foreign nodes clear and reopens the rank gap downstream; if it survives, widen the canvas or check that the boundary's `contains` is right |
| `declared-node-not-rendered` | A leaf declared by the stage is missing from the rendered nodes, or a rendered leaf was never declared | Identity bug in resolution or collapse; fix the engine or translator, not the model |
| `flow-marker-collision` | A numbered flow marker overlaps a node, a wire label, or another marker | Move a node, shorten the label, or widen spacing so the marker lane clears |
| `flow-marker-overflow` | A flow marker leaves the logical canvas | Grow the canvas or reduce expanded levels |
| `flow-return-no-forward` | A `return` step has no earlier forward call on the reverse edge | Add or reorder the forward call; a return must answer a prior call |
| `flow-step-empty` | A flow step has no edge, group, or parallel item | Give the step exactly one of `edge`, `group`, or `parallel` |
| `flow-step-unknown-edge` | A flow step names an edge that is not in the flow's wires | Add the wire or fix the step's edge |
| `stage-overflow` | A node, package, boundary, or label leaves the logical canvas *after* the fit-within-canvas pass ran | The renderer already translated/uniformly-scaled the settled layout back inside `canvas`; a surviving finding means the content is genuinely larger than the canvas — grow `canvas.w`/`canvas.h`, or expand fewer levels in that scenario |

Every layout-dependent row above is checked across a bounded expansion matrix for every stage: deterministic model default (independent of viewer overrides), collapsed, configured, each package, nested level combinations, pairwise combinations, and all-expanded. The renderer retries each state from the same seed, progressively widens the layout, stops at zero findings, and keeps the best result. `meta.layoutValidation.maxTrials` controls attempts per state (default 12, hard cap 32); `maxExpansionScenarios` controls the scenario cap (default 20, hard cap 32). A finding carries a scenario tag such as `[expand:package-id]` or `[all]`. Treat it like the same issue in the collapsed state, but fix it by widening spacing first — increase the density margin, dagre `nodesep`/`ranksep`, package padding, or boundary inset (`references/layout.md`) — since the model isn't necessarily over-grouped. Fall back to re-grouping or expanding fewer levels only if wider spacing would blow up the canvas or shrink labels below readability.

**Fixing `package-contains-foreign-node`.** The renderer repeatedly pushes a free-standing node clear of every expanded package it doesn't belong to after each boundary/deconfliction pass, then recomputes the boundaries before routing. If the finding remains, the push has run out of usable canvas — especially once a package's own outline already spans most of the canvas. Try, in order:
1. **Widen the canvas** (`canvas.w`/`canvas.h`) — reliable for `dagre` layouts; the fix is often a larger jump than expected (not a small nudge) since the free room has to clear both the package's own padding and the canvas-edge reserve.
2. **Make the node an actual package member**, if that's honestly what it is — this was usually the *right* model in practice, not just a workaround (a shared dependency floating outside the package that owns it is often a modeling gap, not a deliberate choice).
3. **Switch that stage to `layout: "manual"`** with explicit coordinates for every node. For `force` layout, canvas widening is markedly less effective than for `dagre` (the simulation settles in its own space and gets rescaled to fit, so a bigger canvas mostly scales the whole picture up rather than freeing new relative room) — manual placement is usually the fastest real fix once widening stalls.

**Fixing `package-boundary-label-collision`.** Unlike every other row in the table, this one is not fixed by editing the model. A boundary is explicitly allowed to wrap a package's exact membership (see `references/layout.md`, "Boundaries and responsive sizing"), and when it does, the boundary's rendered corner and the package's rendered corner are both computed from the same topmost/leftmost member — repositioning nodes, widening the canvas, or changing `contains` does not reliably separate two corners that are pinned to the same point. The template keeps them apart by giving a boundary's own padding a larger fixed offset than a package's headroom, so the two corners (and their title text) land a real distance apart regardless of density. If this check fires, that constant has regressed toward the package's own padding in `resolveBoundaries` — treat it as a template bug, not a diagram to reshape.

Confirm the model's first and last stages preserve stable IDs for components that persist. Confirm package auto-expansion includes only packages with endpoint differences, and that unaffected packages can remain collapsed.

## Browser and interaction pass

- Open from disk with and without the pinned CDN dependencies. Missing D3 must show the visible notice; missing dagre may use the deterministic layered fallback; explicit ELK models must surface a preparation error if the pinned ELK script is unavailable, while an automatically selected ELK state must visibly report its dagre fallback; missing GIF.js must leave other exports usable.
- Run the self-check and confirm the console has no errors or unexpected warnings.
- Walk every stage with Previous/Next, stage pills, Arrow keys, Home, End, and Play. Confirm keyed components morph rather than being recreated by unrelated IDs.
- Click or keyboard-activate a collapsed package to expand it, then activate its visible caption and dashed-frame hit targets to collapse it again. Confirm child layout recalculates, package outline remains behind children, the frame band does not cover child blocks, the caption target is reachable, and nested package headings do not overlap. Confirm no two parallel lines of the *same* type ever appear between the same two visible blocks (collapsing should merge them, joining distinct labels with `" + "`); two different-typed lines between the same pair is correct and expected.
- For any degenerate boundary tags, confirm the dashed chip is fully visible in normal and Presenter modes, does not cover a neighboring block or wire label, and does not intercept the host node or package click. The self-check must report `boundary-chip-overflow` or `boundary-chip-collision` if this fails.
- Expand and collapse every package in the stage, including nested packages, and re-run `diagramSelfCheck()`. The self-check covers these states automatically, but the manual pass confirms the interaction path and the fully-expanded state where overlap is most likely. Repeat for each stage.
- During that pass, confirm a structural expand/collapse commits the container, child blocks, boundaries, wires, and labels together; it should not animate through a transient overlap. Ordinary stage changes with the same visible shape may still morph.
- Search by a component label and ID. Confirm its ancestors expand, the node and connected edges highlight, unrelated nodes/edges dim, and the SVG zoom centers the node. Press Escape to clear; Fit must restore the view.
- Switch the perspective dropdown. With no explicit list, confirm the defaults
  are `All`, `Data`, `Security`, `Migration`, and `Operations`; with
  `meta.perspectives`, confirm it exposes exactly `All` plus that list. Confirm `zones` emphasizes
  boundary scopes, `devops` surfaces control, compatibility, retired,
  deployment, and `ops: true` layers, and no filter moves a node or boundary.
  The dropdown must be keyboard reachable and preserve the choice after reload
  for the same diagram title. No redundant perspective buttons should be
  rendered. `selfCheck()` must
  continue to inspect the unfiltered layout.
- Activate `Hide details` and confirm the right details panel disappears, the
  diagram canvas reclaims the column, the control changes to `Show details`,
  and `aria-expanded` becomes `false`. Activate it again and confirm the
  panel returns, the control and `aria-expanded` are restored, and the choice
  survives a reload for the same diagram title.
- Test SVG, PNG, and JPEG export at a non-default stage and zoom. Open the outputs and confirm they represent the current view. Test GIF with capped defaults and verify it captures stages in order.
- Resize to 1280px and 900px; switch to a narrow mobile-like viewport; check the single-column reflow, touch-sized controls, and intentional diagram-only horizontal scroll when the logical canvas needs it. Use Presenter and Print, and inspect the result in a print preview.
- For a dense stage with `disclosure.mode: progressive`, confirm primary wires render first, supporting layers reveal automatically or with the disclosure control, and revealing a layer does not move the settled layout. Confirm the legend explains secondary-flow treatment. Inspect the hierarchy in order: blocks do not overlap, package outlines have breathing room around their members, boundary envelopes have a larger inset, and disjoint boundary zones have a visible gap.
- Switch light/dark theme and emulate `prefers-reduced-motion`. Content must remain legible and stages must still change.

## Documentation export checks

The static **SVG (documentation)** is a distinct, zoom-independent export.
The test harness checks XML parseability, the full-content viewBox, an opaque
background, embedded Inter font data, preserved visible node count, and
loading through an SVG-as-image context. The animated SVG also embeds the
pinned font; its CSS playback remains destination-dependent. Inspect the
actual GitHub README/documentation viewer or Office/PDF converter for font
fallback, clipped text, missing arrowheads, unreadable scale, and disabled
animation. The HTML presentation remains the only complete interaction surface.
See `references/documentation-export.md` for handoff and format policy.

## Truth and presentation pass

For each transition ask:

- Does a component that exists in both states keep one ID and morph its role instead of being replaced?
- Are only endpoint-different packages auto-expanded?
- Are high-degree mesh graphs using force + collision, and directional low-degree graphs using dagre/layered layout?
- Is spacing visibly more generous in the busiest layer/region?
- Are parallel edges curved and separated, with labels calculated after layout? For ELK stages, do curves clear unrelated nodes and package/boundary rectangles; if a curve cannot, is the orthogonal safety fallback visible in the self-check rather than silently accepted?
- Are high-degree nodes given extra label clearance, and are secondary control/neutral routes either de-emphasized or explicitly bundled without changing their endpoints?
- Do flow type, colour, dash pattern, arrow direction, and legend agree with the permanent library mapping?
- Does every package/group express a semantic level, and do boundaries express real ownership/trust?
- Are assumptions, placeholders, route status, and any text/image conflict stated in the narrative?
