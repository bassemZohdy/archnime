# Build-time layout: decision note

**Status: decided on 2026-11-26, pending the parity gate.** Build-time layout is the direction, the current runtime layout will be archived, and the old runtime will not be kept as an option. Nothing in the renderer has changed yet: no code is removed until the parity gate (TASK-035 in `TODO.md`) passes.

## What was compared

Five ways of building one animated architecture diagram (six-step storyboard, packets hop by hop, CHANGED and UNCHANGED badges, playback controls, one offline HTML file), each built by a fresh agent from the same brief and then given the same change (a sixth entity and a seventh step):

- D3 with ELK running in the page
- vanilla CSS and the Web Animations API
- GSAP
- archgram 0.10.1
- a hybrid: ELK runs once at build time, the resulting geometry is stored in the HTML as data, and a vanilla Web Animations runtime plays it

An independent script then measured all ten resulting pages. The full report, brief, sources, harness and scores are in the tech-reports repository, branch `animated-diagram-technology-choice` until merged: <https://github.com/bassemZohdy/tech-reports/tree/animated-diagram-technology-choice/reports/animated-diagram-technology-choice>.

## What the evidence suggests

One run per option, so these are leads to test, not proven rankings.

- The hybrid ranked first under all four weightings tried (88.9, 91.9, 86.3 and 90.8 out of 100) and in 93% of random weightings.
- Its page was 36 KB. The D3 + ELK page was 1.99 MB because ELK ships inside it.
- It rebuilt from the specification alone, took 2.2 minutes to absorb the change, and needed 13 changed code lines, all for one new kind of traffic.
- Its loop length (63.9 s against 79 to 193 s) reflects the pacing the agent chose, not the tool.
- Its brief was more prescriptive than the others, so its build and change times are the least reliable numbers.
- ELK could not lay out a box that spans several layers. Two agents independently computed that box by hand from its members.

## How this relates to archnime today

As described in [archnime-renderer.md](archnime-renderer.md), archnime lays diagrams out in the page with ELK, dagre or force (chosen by `meta.layout`), and the interactive HTML loads D3, dagre, ELK and GIF libraries from pinned runtime URLs. The layout and self-check engine, `assets/diagram-engine.js`, is also used outside the page so geometry can be validated without rendering. That suggests geometry could be produced before the page is built; the spike below tried it.

The evidence above came from a deliberately small, lane-aligned diagram. archnime serves larger and more varied models (nested packages, trust boundaries, perspectives, tuning), so it does not show that the same approach carries over.

## Spike: the engine without a page (TASK-034)

`skills/archnime-renderer/tests/headless_layout_check.mjs` runs the layout engine in plain Node, with no browser and no `document`, and compares the result with what the engine computes inside the built page. One run on one machine (Windows, Node 24, headless Chromium), default expansion state only. Times cover preparing the engine and laying out every stage:

| Fixture | Shape | Engine | Stages | Headless | In the page | Geometry JSON | Equal |
|---|---|---|---|---|---|---|---|
| `orders-failover-scenarios` | flat | dagre | 3 | 0.2 s | 0.06 s | 20.8 KB | yes |
| `deep-nested-crosscut` | nested packages | dagre | 1 | 2.9 s | 0.8 s | 21.0 KB | yes |
| `checkout-flow` | flow | dagre | 1 | 0.1 s | 0.04 s | 12.9 KB | yes |
| `orthogonal-routing` | nested packages | ELK | 2 | 0.4 s | 0.09 s | 25.1 KB | yes |
| `force-mesh-packages` | nested packages | force | 1 | 15.3 s | 4.0 s | 26.1 KB | yes |
| `free-form-mesh` (TASK-036) | free-form, no lanes | dagre | 2 | 1.1 s | 0.3 s | 50.5 KB | yes |
| `nested-three-levels` (TASK-036) | three levels of packages | ELK | 2 | 37.4 s | 10.3 s | 40.5 KB | yes |

What this shows and what it does not:

- Equal means every number is identical, not rounded: node, package and boundary boxes, wire routes, label positions and canvas. The layout each page painted on load also equals a headless stage.
- The engine needed no change. Text is measured from the pinned Inter advance table and sizes come from the static tokens, which match the page's CSS tokens outside presenter mode.
- Geometry is 7 to 25 KB per stage uncompressed, most of it wire routes. A page with many stages and expansion states stores one geometry per state it can show.
- The ELK bundle runs in Node only when the context has no `self`; with `self` and no `document` it takes itself for a web worker. A build step has to load it that way.
- Layout in Node took 3 to 4 times as long as in Chromium on every fixture. The cause was not investigated.
- Two small diagrams are slow today: the force layout takes 4 s in the page (15 s headless) for nine nodes, and three levels of packages take 10 s in the page (37 s headless) for eight nodes, most of it preparing ELK for the expansion states. Build-time layout moves that wait from every page load to the build; the build cost is something to measure before FEAT-038.
- The free-form fixture has call cycles and no lane order. `auto` chose dagre for it; the stored-geometry approach does not depend on which engine ran.
- Not covered: presenter mode (it changes the chip size token, so its geometry is a separate state), package expansion states other than the default, tuned layouts, perspectives, comparison and deployment views, and custom `measureContext` fonts. These are rows for the parity matrix (TASK-035).

## Parity matrix (TASK-035, draft awaiting the owner)

Proposed status of every renderer feature once geometry is stored at build time and the page no longer loads dagre, ELK or the force layout. The statuses come from reading `template.html` and `diagram-engine.js` and from the spike above; none has been built. A stored geometry belongs to one layout state: a stage, a set of expanded packages, and presenter mode on or off.

| Feature | Uses layout in the page today | Status | How, and why |
|---|---|---|---|
| Stage navigation, Play, deep links, stage tweening | reads the layout of each stage | kept | Painted from the stored geometry of each stage. The spike shows that geometry equals what the page computes. |
| Flows (steps, single-flow, all-steps) | one layout for the whole flow | kept | One stored geometry per flow; steps only restyle it. |
| Perspectives | none: filters restyle without relayout | kept | No change. |
| Search, zoom, Fit, hover, panels | reads node and package boxes | kept | Read from the stored geometry. |
| Multi-view bundles, comparison and deployment views | one engine per view | kept | Each view stores its own geometry. Not covered by the spike; needs a fixture in FEAT-038. |
| Package expansion and collapse | new layout per expansion state | replaced | Store one geometry per expansion state. The engine already enumerates the states its self-check covers (default, all, each package, pairs, capped by `meta.layoutValidation.maxExpansionScenarios`, 20 by default). A state outside that list has no geometry: the build either stores every combination or the page refuses the click. **Owner to choose.** |
| Presenter mode | new layout: the boundary chip size changes | replaced | Store a second geometry per state for presenter mode, which doubles the stored size, or keep one geometry and stop changing the chip size in presenter mode. **Owner to choose.** |
| Wire styles (Curved, Orthogonal, Direct) and reroute | reroutes wires, keeps boxes; no layout library involved | kept | Routing is the engine's own code, not dagre or ELK. Keep the routing part of the engine in the page and store boxes plus the default routes. Storing all three route sets instead would triple the wire data, which is most of the geometry. |
| Tune layout | searches ELK variants, seeds and strategies in the page | dropped from the page, replaced at build | The search needs ELK. Proposed: a build option runs the same search and stores the best result; the Tune button, strategy list and Keep wires box leave the page. **Needs the owner's agreement.** |
| Self-check (`diagramSelfCheck()`, `?check=1`) | lays out every stage and expansion state, then checks | replaced | The build runs the full self-check and fails on findings, as translation does today. In the page, `checkLayout` on a stored geometry needs no layout library, so `?check=1` can keep reporting on what is shown. |
| SVG (documentation), SVG, PNG, JPEG export | paints the current layout | kept | Painted from stored geometry. `export_svg.mjs` runs at build time already. |
| Animated SVG and GIF export | paints every stage | kept | Same stored geometries; no relayout. |
| Print | invalidates the layout cache before and after printing | replaced | Print uses the stored geometry; the cache refresh goes away. To verify that print output is unchanged. |
| `<architecture-diagram>` element | lays out the model it is given | replaced | The element accepts a built model that carries geometry and refuses one that does not, with the same message as the build. |
| Loading a specification in the page with no build step (`translate.html`) | translates, lays out and checks in the browser | dropped, or kept as a separate tool | Without layout libraries the page cannot lay out a new specification. Either drop it, or keep `translate.html` as the one page that still loads the libraries, as an authoring tool rather than a renderer. The second contradicts "no old runtime" unless the owner reads that as applying to delivered diagrams only. **Needs the owner's agreement.** |
| ELK retry variants and the dagre fall-back when ELK is missing | chosen in the page | replaced | Chosen at build. A layout that cannot be produced fails the build instead of falling back. |
| Pinned CDN scripts, their integrity hashes and vendored copies | D3, dagre, ELK, GIF | replaced | dagre and ELK leave the page and stay as build dependencies. D3 stays for painting, GIF for export. |
| Text measurement from the pinned Inter table | used by layout | kept | Used at build; the page still needs it for wire rerouting and label boxes. |

Open points the matrix raises:

- **Stored size.** Geometry measured 7 to 25 KB per state. A view with 3 stages, 8 expansion states and presenter mode stores about 48 states, roughly 0.5 to 1 MB uncompressed, against about 2 MB for ELK today. Storing node, package and boundary boxes and routing wires in the page would cut this to a small fraction; that is why wire routing is proposed as kept.
- **What "runtime layout code" means for TASK-039.** If wire routing and `checkLayout` stay in the page, TASK-039 removes placement (dagre, ELK, force, the Tune search) and not the whole engine.
- **Three rows need the owner**: Tune layout, loading a specification with no build step, and the choice for expansion states outside the enumerated list. Presenter mode is a choice between two ways of keeping it.

## Decision

1. **Archive the current renderer** as the git tag `legacy-runtime-layout` plus a `legacy/2.x` branch for fixes. It is not moved into the repository tree, because the repository root is the plugin and archived code would ship with every install.
2. **Make build-time layout the layout path.** Geometry is produced per stage with the existing engine and stored in the generated page. A missing or stale geometry fails the build; there is no fall-back to layout in the page.
3. **Do not keep the old runtime layout as an option.** The runtime layout code and the dagre, ELK and force libraries are removed in 3.0.0, a major version because the default changes.
4. **Gate the removal.** Nothing is removed until the parity matrix shows what is kept, replaced or dropped, the free-form and nested fixtures render correctly, and the regression gate passes.

The canonical YAML, the validators, the SVG documentation export, the aggregator and its routing rules stay. Stored geometry is derived and never edited.

## Risks and open questions

- The runtime features that depend on layout in the page (the Tune layout search, expansion of packages, per-style rerouting) may need the engine at runtime. With the old runtime not kept, each of them becomes a kept, replaced or dropped row in the parity matrix, and a dropped row needs the owner's agreement.
- Opening a specification directly in the page with no build step would no longer be laid out. The parity matrix must say whether that use is dropped or served some other way.
- Stored geometry can drift from the model; the hash check turns drift into a build failure.
- Does the same approach hold on a free-form, non-lane-aligned diagram?
- Would a GSAP animation layer on the same layout do better than the plain Web Animations runtime? Not tested.
- Any change to the renderer needs the existing renderer tests, fixtures and browser checks to pass (see `AGENTS.md`).

## Plan

The tasks are in [TODO.md](../TODO.md), under the `build-time-layout` lane: archive, spike, parity gate, fixtures and regression gate, stored geometry, then the 3.0.0 release that removes the old runtime. Optional GSAP spike after the release.
