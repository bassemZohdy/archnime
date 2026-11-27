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
