# Build-time layout: decision note

**Status: done in 3.0.0.** Layout is computed when a diagram is built and stored in the page. A delivered page places nothing: it loads no layout library and carries no placement code. The renderer that laid out in the page (releases up to 2.1.1) is archived as the tag `legacy-runtime-layout` and the branch `legacy/2.x`, for reference only. This note keeps the evidence, the decisions and what was built, in the order they happened; the sections before "3.0.0" describe the state at the time they were written.

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

## Regression gate (TASK-037)

`skills/archnime-renderer/tests/playback_gate_check.mjs` ports the four measurements of the comparison harness and runs them on the current renderer at 1280 x 800, so the same numbers exist before and after the change:

| Measurement | Staged diagram (`strangler-migration`) | Flow walkthrough (`checkout-flow`) |
|---|---|---|
| Next, Back and jump while playing | pass | pass |
| Pause: pixels changing over 2.5 s (target under 0.05%) | 0.000% | 0.034% to 0.038% |
| Pause: elements still animating (target 0) | 0 | 4 |
| Smallest text on screen (target 12 px) | 6.1 px | 5.5 px |
| Text characters under 12 px (target 0%) | 31.9% | 27% |
| Run from the first step | 9.1 s, 3 steps at 3 s, no loop | 8.5 s, 7 steps at 1.2 s, no loop |

Three targets are not met today and are recorded as known gaps, which the gate holds at their current values:

- **Text size.** At 1280 px wide the diagram is scaled to about 0.55 to fit, so 11 to 13 px labels paint at 6 px. Roughly a third of the text is under 12 px. FIX-043 fits the opening view to the content instead of the 1600 x 900 canvas, which raised the smallest text from 6.1 to 7.5 px (`strangler-migration`) and from 5.5 to 6.5 px (`checkout-flow`). The target is still not met, and cannot be at 1280 px by scaling: the side panel leaves the diagram 884 px, and `checkout-flow` is 1315 units wide, so reaching 12 px would take larger fonts, which change node sizes and every stored layout. The gate holds the new values. Larger fonts do not help: a spike that raised every font token about 1.4 times gave 8.0 px and 6.0 px, because nodes grow with their text, the layout widens in step and the fit scale falls by the same factor. Reaching 12 px depends on how wide a diagram is against the window, so it takes fewer parts per row, a wider window or a hidden side panel, not larger fonts.
- **Pause on a flow** (fixed after 3.0.0 by FIX-041; the table shows the state when the gate was added). Pause stopped the steps, but the animated dashes on the active wires kept moving. They cover too few pixels to trip the harness threshold, which is why the gate also counts animating elements.
- **No loop** (decided in TASK-044: intended). Staged playback stops after the last stage and pressing Play again restarts it from stage 1; a flow loops only with `meta.flow.loop`. Presenters can stop on the final stage, so looping stays opt-in and staged diagrams have no switch for it. The harness measured a loop length, so the figure in the table is one run.

## Stored geometry (FEAT-038)

`skills/archnime-renderer/scripts/store_geometry.mjs` computes the layouts in Node and `build_bundle.py --geometry` embeds them. When this was built it was opt-in; since 3.0.0 it is the only path (see "3.0.0" below).

How it works:

- **A stored layout is a cache entry.** The engine already kept each computed layout in a cache keyed by stage and expanded packages, and already rerouted a cached layout when the wire style changed. Stored geometry is that cache, filled at build time and written as JSON. With it the engine places nothing; `layoutStage` returns the stored layout or throws.
- **Every state a click can reach is stored.** A click collapses a package with its descendants or expands one with its ancestors, so the reachable states are the default plus every set in which an expanded package has its ancestors expanded. Four packages nested as in `nested-three-levels` give 7 states per stage, not 16. The build fails above 64 states per stage (`--max-states`).
- **Stale or missing geometry fails the build.** The file records a hash of the model and of the engine (`diagram-engine.js` and `architecture-library.js`), ignoring line endings. `build_bundle.py` refuses a mismatch and names the command to run. In the page a state with no stored layout is an error, not a layout.
- **The build runs the self-check** on the stored layouts and fails on a finding unless `--allow-findings` is passed.

Measured on seven fixtures (`tests/stored_geometry_check.mjs`, one machine, offline single-file pages):

| Fixture | Engine | States stored | Geometry | Page, stored | Page, run time | Ready, stored | Ready, run time |
|---|---|---|---|---|---|---|---|
| `orders-failover-scenarios` | dagre | 3 | 34 KB | 769 KB | 2401 KB | 0.4 s | 1.0 s |
| `free-form-mesh` | dagre | 2 | 71 KB | 809 KB | 2404 KB | 0.4 s | 1.1 s |
| `checkout-flow` | dagre | 1 | 20 KB | 760 KB | 2405 KB | 0.4 s | 1.0 s |
| `deep-nested-crosscut` | dagre | 5 | 124 KB | 861 KB | 2403 KB | 0.4 s | 1.7 s |
| `orthogonal-routing` | ELK | 6 | 55 KB | 791 KB | 2402 KB | 0.4 s | 1.0 s |
| `nested-three-levels` | ELK | 14 | 300 KB | 1039 KB | 2404 KB | 0.4 s | 7 to 8 s |
| `force-mesh-packages` | force | 4 | 103 KB | 841 KB | 2403 KB | 0.4 s | 6.2 s |

- On six fixtures the stored page equals the run-time page on every step walked: each stage, each wire style, and collapsing and expanding each package. Equal means the layout object and the painted node positions, wire paths and package outlines.
- **The force layout is the exception, and it is a behaviour change.** At run time it starts each simulation from where the nodes last were, so the layout after a collapse depends on the clicks before it, and expanding again does not bring the first layout back. A stored page has one layout per state. The two agree until the first collapse; after it the stored page is the stable one.
- Geometry holds complete layouts, about 15 to 25 KB per state, which is larger than the boxes-only form the parity matrix proposed. Complete layouts made the stored page equal to the run-time page with no new routing code path. Even so every stored page is under half the size of the run-time page, because ELK is 1.6 MB. Trimming to boxes plus rerouting in the page is still open if size matters.
- Computing geometry in Node took 0.2 s to 7 s per fixture, except `nested-three-levels`, which took 48 s for its 14 ELK states. That is the build cost of the wait the run-time page imposes on every load.

The rest of the parity matrix, done after the single-view part:

- **Multi-view bundles.** The geometry file holds one geometry per view id. The function that merges a view with what the bundle shares moved from the page into the engine (`DiagramEngine.materializeView`), so the build step and the page merge a view with the same code. `commerce-views` (context, deployment and flow views, 10 states, 53 KB) and `comparison-views` (two options, 4 states, 28 KB) equal the run-time page on every step, view by view.
- **Exports.** The documentation SVG and the animated SVG a stored page exports are byte-identical to those of the run-time page, on the eight fixtures where the two pages are compared to the end (all but the force fixture). `export_svg.mjs` is itself a build-time tool that lays out in its own headless page; it is unchanged.
- **Tune layout as a build option.** `store_geometry.mjs --tune` runs the page's Tune search for every state and stores the best placement, keeping the wire style. On `orthogonal-routing` it improved 2 of 6 states; two runs give the same file.
- **The `<architecture-diagram>` element.** It takes the geometry file as `geometry-src` or an inline `data-geometry` script and then places nothing; the check runs it on a host page with neither dagre nor ELK. It has no model file to hash, so the engine refuses a stored layout whose nodes are not the ones the model shows. That catches a changed set of nodes, not a changed label; the builder's hash check catches both.


One thing the walk turned up in the current renderer, stored or not: in a flow view, collapsing a package is not painted until the next repaint, because the flow's layout is not refreshed on collapse as it is on expand. Fixed after 3.0.0 by FIX-042.

## 3.0.0: stored geometry is the only path (TASK-039)

What changed:

- **The builder always embeds geometry.** `build_bundle.py` runs `store_geometry.mjs` itself when no `--geometry` file is given, so a build is still one command; it needs Node.js 24 or newer and says so when Node is missing. Computed geometry is cached by model and engine in the system temporary folder (`ARCHNIME_GEOMETRY_CACHE=0` turns that off). `--tune` runs the Tune search during the build.
- **The engine is one source and two files.** `diagram-engine.js` is the whole engine, loaded by the build step and by `translate.html`. `diagram-runtime.js` is generated from it by `scripts/gen_runtime_engine.mjs`: the regions marked as placement are dropped, then every function nothing left refers to. That removed 50 of 132 functions and took the file from 226 KB to 140 KB. A delivered page loads the runtime file only. `npm run check-runtime` fails when the generated file is out of date, and `tests/runtime_engine.test.mjs` holds that, from the same geometry, the runtime file gives exactly what the whole engine gives on every fixture and example.
- **The page lost what placed nodes:** the dagre and ELK script tags, the Tune button with its strategy list and Keep wires box, and the layout refresh around printing. Opening `template.html` unbuilt shows a message instead of a diagram.
- **Each state is laid out the way the self-check lays it out**: the fully expanded layout first, then every state seeded from its positions. What is stored is therefore what was checked. Before, the self-check validated layouts computed by a slightly different route than the one the page took.
- **`translate.html`** computes the layout in the browser with the whole engine and embeds it in the page it produces. `tests/headless_layout_check.mjs` holds that Node and the browser compute identical geometry (eight fixtures, every state, numbers compared exactly).
- **The `<architecture-diagram>` element** requires geometry and loads the runtime engine.
- **The self-check in the page covers every stored state**, and the model checks (duplicate or unknown nodes, wire endpoints, flow steps) run with it.

Measured after the change (offline single-file pages, `tests/stored_geometry_check.mjs`): pages are 675 to 954 KB against about 2.4 MB in 2.1.1, and ready in 0.3 to 0.4 s on all nine fixtures.

What it costs:

- **Node.js is needed to build.** Python alone no longer produces a page unless a geometry file already exists.
- **Storing every reachable state surfaces findings the bounded matrix did not reach.** The Test System example reports 18 self-check findings in expansion states beyond the old matrix, and 8 in states the old matrix covered when it is checked outside a browser. The builder passes findings on as warnings; `store_geometry.mjs` fails on them unless `--allow-findings` is given.
- **The test suite is slower**, because every page a test builds has its layout computed first; the geometry cache absorbs repeated builds.
- **The runtime file is generated and checked in.** Editing the engine means running `npm run gen-runtime`.

## GSAP as the animation layer: not adopted (TASK-040)

The comparison left one question open: would a GSAP animation layer on the stored geometry do better than the page's own animation? The task said to read the GSAP licence first. That reading settled it, and no prototype was built. This is a reading of the licence text, not legal advice.

The licence is the GSAP "Standard No Charge License", owned by Webflow, effective 30 April 2025 and last modified 30 May 2025, read on 2026-11-27 at <https://gsap.com/community/standard-license/>.

- **It is not an open-source licence.** It grants a licence to use, reproduce, display and implement GSAP for permitted uses, and all rights stay with Webflow. This repository vendors each library it delivers with its licence file, so pages work offline, and is published under MIT and Apache-2.0. GSAP could not be shipped on those terms.
- **It can be revoked and changed.** Webflow may terminate it for non-compliance and may amend it by posting new terms; staying on an earlier version means taking no updates.
- **Its prohibited use is wider than "a visual builder".** It covers tools that let users build visual animations without code and that help create something competing with Webflow's animation building. archnime produces animated diagrams from a YAML specification with no animation code. It probably does not compete, but the licence leaves that judgement to Webflow, and its FAQ says to ask when unsure.
- **The gate could not have shown much.** Of the four measurements in the regression gate (TASK-037), text size and run length do not depend on the animation library. The one animation defect the gate found, flow dashes that keep moving after Pause, is a fix in the page's own CSS.

Decision, agreed with the owner on 2026-11-27: GSAP is not adopted and was not measured. The page keeps its own animation (D3 transitions and CSS keyframes). Reopen only if GSAP is offered under an open-source licence, or if a measured need appears that the page's own animation cannot meet.

## Parity matrix (TASK-035)

Status of every renderer feature once geometry is stored at build time and delivered diagrams no longer load dagre, ELK or the force layout. The statuses come from reading `template.html` and `diagram-engine.js` and from the spike above; none has been built. The owner agreed the four rows that needed a decision on 2026-11-27 (Tune layout, loading a specification with no build step, package expansion, presenter mode). A stored geometry belongs to one layout state: a stage and a set of expanded packages.

| Feature | Uses layout in the page today | Status | How, and why |
|---|---|---|---|
| Stage navigation, Play, deep links, stage tweening | reads the layout of each stage | kept | Painted from the stored geometry of each stage. The spike shows that geometry equals what the page computes. |
| Flows (steps, single-flow, all-steps) | one layout for the whole flow | kept | One stored geometry per flow; steps only restyle it. |
| Perspectives | none: filters restyle without relayout | kept | No change. |
| Search, zoom, Fit, hover, panels | reads node and package boxes | kept | Read from the stored geometry. |
| Multi-view bundles, comparison and deployment views | one engine per view | kept | Each view stores its own geometry. Not covered by the spike; needs a fixture in FEAT-038. |
| Package expansion and collapse | new layout per expansion state | replaced | The build lays out and stores every reachable combination of expanded packages, so any click finds its geometry. Build time and page size grow with the number of packages; the build fails with a clear message above a stated limit on the number of states instead of storing a partial set. Owner decision: store every combination. |
| Presenter mode | new layout: the boundary chip size changes | replaced | Presenter mode reuses the stored geometry. It stops enlarging the boundary chip, the one presenter change that moved the layout; larger and bolder labels, hidden panels and contrast stay. Owner decision: one geometry. |
| Wire styles (Curved, Orthogonal, Direct) and reroute | reroutes wires, keeps boxes; no layout library involved | kept | Routing is the engine's own code, not dagre or ELK. Keep the routing part of the engine in the page and store boxes plus the default routes. Storing all three route sets instead would triple the wire data, which is most of the geometry. |
| Tune layout | searches ELK variants, seeds and strategies in the page | dropped from the page, replaced at build | A build option runs the same search and stores the best result. The Tune button, strategy list and Keep wires box leave the page. Owner agreed. |
| Self-check (`diagramSelfCheck()`, `?check=1`) | lays out every stage and expansion state, then checks | replaced | The build runs the full self-check and fails on findings, as translation does today. In the page, `checkLayout` on a stored geometry needs no layout library, so `?check=1` can keep reporting on what is shown. |
| SVG (documentation), SVG, PNG, JPEG export | paints the current layout | kept | Painted from stored geometry. `export_svg.mjs` runs at build time already. |
| Animated SVG and GIF export | paints every stage | kept | Same stored geometries; no relayout. |
| Print | invalidates the layout cache before and after printing | replaced | Print uses the stored geometry; the cache refresh goes away. To verify that print output is unchanged. |
| `<architecture-diagram>` element | lays out the model it is given | replaced | The element accepts a built model that carries geometry and refuses one that does not, with the same message as the build. |
| Loading a specification in the page with no build step (`translate.html`) | translates, lays out and checks in the browser | kept as an authoring tool | `translate.html` stays the one page that loads the layout libraries, for authors checking a specification. It is not a delivered diagram, and nothing it produces is delivered without the build. Owner decision: "no old runtime" applies to delivered diagrams. |
| ELK retry variants and the dagre fall-back when ELK is missing | chosen in the page | replaced | Chosen at build. A layout that cannot be produced fails the build instead of falling back. |
| Pinned CDN scripts, their integrity hashes and vendored copies | D3, dagre, ELK, GIF | replaced | dagre and ELK leave the delivered page and stay as build dependencies and for `translate.html`. D3 stays for painting, GIF for export. |
| Text measurement from the pinned Inter table | used by layout | kept | Used at build; the page still needs it for wire rerouting and label boxes. |

What the matrix settles for the next tasks:

- **Stored size.** Geometry measured 7 to 25 KB per state, most of it wire routes. Storing every expansion combination multiplies the states (four packages can give up to 16 per stage), so FEAT-038 stores node, package and boundary boxes plus the default routes and leaves rerouting to the page; that is why wire routing is kept. FEAT-038 sets the limit on states and measures the real size.
- **What "runtime layout code" means for TASK-039.** Wire routing and `checkLayout` stay in the delivered page. TASK-039 removes placement from it: dagre, ELK, the force layout and the Tune search. `translate.html` keeps loading the libraries.
- **No row is dropped without a replacement** except the in-page Tune controls, which the owner agreed to move to the build.

## Decision

1. **Archive the current renderer** as the git tag `legacy-runtime-layout` plus a `legacy/2.x` branch for fixes. It is not moved into the repository tree, because the repository root is the plugin and archived code would ship with every install.
2. **Make build-time layout the layout path.** Geometry is produced per stage with the existing engine and stored in the generated page. A missing or stale geometry fails the build; there is no fall-back to layout in the page.
3. **Do not keep the old runtime layout as an option.** The runtime layout code and the dagre, ELK and force libraries are removed from delivered diagrams in 3.0.0, a major version because the default changes. The authoring page `translate.html` keeps them (parity matrix).
4. **Gate the removal.** Nothing is removed until the parity matrix shows what is kept, replaced or dropped, the free-form and nested fixtures render correctly, and the regression gate passes.

The canonical YAML, the validators, the SVG documentation export, the aggregator and its routing rules stay. Stored geometry is derived and never edited.

## Risks and open questions

- The runtime features that depend on layout in the page (the Tune layout search, expansion of packages, per-style rerouting) may need the engine at runtime. With the old runtime not kept, each of them becomes a kept, replaced or dropped row in the parity matrix, and a dropped row needs the owner's agreement.
- Opening a specification directly in the page with no build step would no longer be laid out. The parity matrix must say whether that use is dropped or served some other way.
- Stored geometry can drift from the model; the hash check turns drift into a build failure.
- Does the same approach hold on a free-form, non-lane-aligned diagram?
- Would a GSAP animation layer on the same layout do better than the plain Web Animations runtime? Not tested, and closed on the licence: see "GSAP as the animation layer" above.
- Any change to the renderer needs the existing renderer tests, fixtures and browser checks to pass (see `AGENTS.md`).

## Plan

The tasks are in [TODO.md](../TODO.md), under the `build-time-layout` lane: archive, spike, parity gate, fixtures and regression gate, stored geometry, then the 3.0.0 release that removes the old runtime. The optional GSAP spike was closed on its licence without a prototype.
