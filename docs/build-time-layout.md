# Build-time layout: decision note

**Status: proposed, not adopted.** Nothing in the renderer has changed. This note records evidence and the plan in `TODO.md` so the decision can be taken deliberately.

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

As described in [archnime-renderer.md](archnime-renderer.md), archnime lays diagrams out in the page with ELK, dagre or force (chosen by `meta.layout`), and the interactive HTML loads D3, dagre, ELK and GIF libraries from pinned runtime URLs. The layout and self-check engine, `assets/diagram-engine.js`, is also used outside the page so geometry can be validated without rendering. That suggests geometry could be produced before the page is built, but this has not been tried.

The evidence above came from a deliberately small, lane-aligned diagram. archnime serves larger and more varied models (nested packages, trust boundaries, perspectives, tuning), so it does not show that the same approach carries over.

## Proposed direction

Add build-time layout as an option alongside the existing runtime layout, and make it the default only if a spike shows it holds for archnime's own fixtures:

1. Produce geometry per stage with the existing engine and store it in the generated page.
2. Let the renderer use stored geometry when present and fall back to runtime layout when it is absent or stale.
3. Where the page needs no layout library, stop loading it.
4. Keep the canonical YAML and the existing validators as the source of truth; stored geometry is derived and never edited.

What stays: the DSL, the validators, the SVG documentation export, the aggregator and its routing rules.

## Risks and open questions

- The runtime features that depend on layout in the page (the Tune layout search, expansion of packages, per-style rerouting) may need the engine at runtime, which would limit what can be dropped.
- Stored geometry can drift from the model; staleness needs a check.
- Does the same approach hold on a free-form, non-lane-aligned diagram?
- Would a GSAP animation layer on the same layout do better than the plain Web Animations runtime? Not tested.
- Any change to the renderer needs the existing renderer tests, fixtures and browser checks to pass (see `AGENTS.md`).

## Plan

The tasks are in [TODO.md](../TODO.md), under the `build-time-layout` lane. The first is a decision and a spike, not an implementation.
