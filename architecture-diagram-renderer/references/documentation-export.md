# Documentation-safe architecture exports

The **canonical YAML/JSON model is authoritative**. Use the D3/ELK/Dagre
renderer to create the interactive presentation and export documentation from
that same settled geometry. Do not run a second renderer for documentation:
re-layout could change the apparent relationships, grouping, or trust scope.

## Choose the delivery format

| Destination | Deliver | Guarantees and limitations |
| --- | --- | --- |
| Presentation or live demonstration | Interactive HTML and its required assets | Zoom, search, stage playback, drill-down, and perspectives; a one-file `--inline` build still requires CDN runtime scripts unless vendored separately |
| GitHub README / Markdown | **SVG (documentation)** plus a hyperlink to the interactive viewer | Static SVG with its own Inter font, explicit background, full content bounds, and no dependence on presenter zoom |
| HTML documentation site | The same static SVG, or Animated SVG after target testing; link to interactive HTML | SVG image embedding does **not** provide JavaScript-driven controls |
| Word / Google Docs / PDF | Documentation SVG if accepted by the target; otherwise a PNG made from that artifact | No dependable interaction or animated playback after conversion |
| Architecture transition or flow in formal documents | Individual documentation snapshots for each significant stage | Do not replace multi-stage meaning with an undocumented single frame |

For generic Markdown, use a static image and a separate viewer link:

```md
[![Architecture diagram](diagrams/orders-stage-1-documentation.svg)](https://example.org/orders-architecture.html)

Interactive walkthrough: [Open presentation](https://example.org/orders-architecture.html)
```

Replace URLs with actual published artifact locations; never promise that a
`file://` link or a relative HTML attachment will execute inside GitHub.

## Export procedure

1. Author/validate the semantic DSL. Translate it to the portable renderer model;
   build the HTML using the normal skill workflow.
2. Open the HTML, wait until the chosen layout is ready and check the **displayed**
   geometry and the unfiltered multi-state self-check.
3. Choose a view, stage, routing style, theme, expansion state, and perspective.
   Use **Export → SVG (documentation)**. This export stops playback, settles the
   selected frame, drops presentation zoom/pan, fits the SVG `viewBox` around the
   visible geometry with padding, includes the pinned Inter font, and adds an
   explicit opaque background. It does **not** mutate component IDs or wires.
4. For a migration, export **every important stage** separately and give each a
   caption. For v2 bundles, export each view separately. Do not silently discard
   stages, flow steps, hidden perspectives, or collapsed subgraphs.
5. For animations on supported websites, use **Animated SVG** after checking
   that the destination displays the complete sequence. It embeds the same font
   but CSS animation support is viewer-specific. Do not use it as the only
   documentation artifact.
6. For Office/PDF or systems that sanitize SVG, render the documentation SVG
   to PNG at a chosen resolution and inspect the result in the actual document.

A stage that uses progressive disclosure reveals its supporting flows layer by layer on a
timer in the presenter. The documentation export always renders every layer, so the image shows
the whole stage whenever it is taken, and then puts the presenter back at the layer it was
showing: exporting never skips or advances the presenter's own reveal.

The ordinary **SVG (this view)** action deliberately retains current presenter
zoom. It is not a documentation-safe export.

## Batch export

To export every important state in one command instead of clicking through the toolbar:

```bash
node architecture-diagram-renderer/scripts/export_snapshots.mjs --model model.json --out snapshots
node architecture-diagram-renderer/scripts/export_snapshots.mjs --model bundle.json --out snapshots --views production,checkout
node architecture-diagram-renderer/scripts/export_snapshots.mjs --model model.json --out snapshots --states 2,target
```

The model is built with `build_bundle.py`, opened in Chromium, and each view's states
(migration stages, scenario variants, flow steps) are selected through the presenter's own
`?view=` and `?stage=` / `?variant=` / `?step=` parameters. Each is written once, as the exact
SVG that **SVG (documentation)** produces, to `<model>--[<view>--]<NN>-<state>.svg`. `--views`
and `--states` (1-based numbers or state ids) narrow the request; an unknown view or state is
reported with the available ones before anything is built or written. The same model always
produces byte-identical files. Playwright and Chromium are required.

Every export also writes `manifest.json`: the SHA-256 of the source model and of the renderer
files (template, engine, library, font), and for each snapshot its view, mode, state, file
name, size and SHA-256. It holds no timestamps or paths, so a rerun reproduces it byte for
byte. Check a directory later, optionally against the model it came from:

```bash
node architecture-diagram-renderer/scripts/verify_snapshots.mjs --dir snapshots --model model.json
```

It exits 1 with one line per problem when a snapshot was edited, deleted or added by hand, a
listed name is unsafe (a path, a duplicate), or the model has changed since the export.

`snapshots.md` is written beside the SVGs for pasting into a README or docs page: per view and
state, the image, a plain `[SVG](file)` link (the static fallback), and, with
`--viewer-url https://example.org/architecture.html`, an "Open in the interactive presenter"
link such as `…architecture.html?view=checkout&step=2` that opens the same view and state.
Titles are escaped, file names percent-encoded, and a viewer URL that is not `http(s)` or a
relative path is refused. Without `--viewer-url` the page holds images and static links only.

## Release checks

- The exported SVG must parse as XML, load as an image, include local font data
  and an explicit background, and have a viewBox that contains the exported
  geometry; the viewport must not retain presenter zoom.
- Node labels, wire types/directions, package/boundary outlines, and all
  selected visible relationships must correspond to the validated source.
- Verify at least one dense/nested example, one flow, and one migration stage.
  Review narrow and normal documentation widths; the page must not crop labels,
  shift text, hide arrows, or change semantic meaning.
- Confirm that the static SVG renders with external network requests blocked.
  A parser/load check alone does **not** establish pixel-accurate rendering.
- Check the target documentation stack (GitHub README, static-site generator,
  Word/PDF conversion) when relevant; renderer CI cannot guarantee an Office
  import result or third-party Markdown sanitization.
- Supply the source model and a working interactive presentation link along
  with embedded static media. SVG in an `<img>` cannot preserve HTML controls.

## Future increments

- Batch-export named view/stage snapshots and a checksummed manifest.
- Make the interactive HTML genuinely offline by vendoring pinned runtime assets,
  with an offline browser regression gate.
- Add screenshot/pixel comparison of SVG-as-image at target widths plus source
  ID/count checks; retain evidence for any unavoidable font fallback.
- Test CSS vs SMIL animated SVG in actual destination viewers before changing
  the animation implementation.
