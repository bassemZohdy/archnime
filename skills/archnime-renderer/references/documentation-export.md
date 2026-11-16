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
   One file serves light and dark pages: the light colours are inline and a
   `@media (prefers-color-scheme: dark)` rule repaints every element whose
   colour differs, so a README shows the diagram in the reader's theme. Both
   palettes are read from the template's own `:root` rules.
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

## One SVG from the command line

`export_svg.mjs` writes one documentation SVG from a spec or a translated model,
headless and with nothing from the network (it builds a single offline bundle from
the vendored libraries):

```bash
node archnime-renderer/scripts/export_svg.mjs docs/diagrams/system.yaml --out docs/diagrams/system.svg
node archnime-renderer/scripts/export_svg.mjs docs/diagrams/checkout.yaml --state 5 --out checkout-step-5.svg
node archnime-renderer/scripts/export_svg.mjs docs/diagrams/checkout.yaml --sequence --out checkout-sequence.svg
```

The SVG is exactly what **SVG (documentation)** produces for that state (`--state`
takes a number or a stage/step id, `--view` a v2 view id). It holds no timestamps or
random ids: the same spec and renderer write the same bytes, so a CI job can
regenerate it and fail on a diff. `--sequence` writes the flow's **sequence view**
instead (also in the toolbar as **SVG (sequence)**): one lifeline per flow node in
`flow.nodes` order, one numbered message per step edge under its step title, calls
solid, returns and async messages dashed, a `refused` reply dashed in the security
colour and ending in a cross. It carries both palettes too. `--sequence` on a spec
without a flow is refused. It needs Playwright with Chromium, like the batch export.

## Batch export

To export every important state in one command instead of clicking through the toolbar:

```bash
node archnime-renderer/scripts/export_snapshots.mjs --model model.json --out snapshots
node archnime-renderer/scripts/export_snapshots.mjs --model bundle.json --out snapshots --views production,checkout
node archnime-renderer/scripts/export_snapshots.mjs --model model.json --out snapshots --states 2,target
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
node archnime-renderer/scripts/verify_snapshots.mjs --dir snapshots --model model.json
```

It exits 1 with one line per problem when a snapshot was edited, deleted or added by hand, a
listed name is unsafe (a path, a duplicate), or the model has changed since the export.

`snapshots.md` is written beside the SVGs for pasting into a README or docs page: per view and
state, the image, a plain `[SVG](file)` link (the static fallback), and, with
`--viewer-url https://example.org/architecture.html`, an "Open in the interactive presenter"
link such as `…architecture.html?view=checkout&step=2` that opens the same view and state.
Titles are escaped, file names percent-encoded, and a viewer URL that is not `http(s)` or a
relative path is refused. Without `--viewer-url` the page holds images and static links only.

## Choosing a format for a document

```bash
node archnime-renderer/scripts/document_format.mjs --svg diagram.svg --target pdf --out out --name diagram
```

| `--target` | Result |
| --- | --- |
| `markdown`, `html` | the SVG itself |
| `pdf` | a one-page vector PDF, kept only if it passes verification; otherwise a 2x PNG fallback |
| `word`, `google-docs` | a 2x PNG made from the SVG (these sanitise or reject SVG), or the SVG with `--accepts-svg` |

A PDF is accepted only if its page is the diagram's size (CSS px x 0.75, within 1.5 pt) and
every visible label is still text in it, not pixels or outlines. If not, a PNG of the same SVG is
written instead and the command says so and why (`png (fallback)` and the reason), so a document
never silently ends up with a picture of text or a cropped page. The check uses a small reader
for Chromium's PDF output (`scripts/pdf_text.mjs`); it needs no PDF library.

## Animated SVG behaviour

The Animated SVG plays the stages (or flow steps) in order with CSS keyframes, one slot of the
cycle per stage, and carries no script. `animated_svg_compat.test.mjs` pins what a destination
can rely on:

| Viewer behaviour | What it shows |
| --- | --- |
| Runs CSS animation | Stage 1, then 2, 3 ... one at a time, in order, looping |
| `prefers-reduced-motion: reduce` | Stage 1 only, no animation |
| Reads the stylesheet but ignores or strips animation | Stage 1 only (never a blank image) |
| Embedded with `<img>` | Draws in both of the above modes; it cannot be paused or controlled |

Before 1.x of this policy the delay of each stage was negative, which played the stages in reverse
(1, last, last-1 ...), and a viewer without animation support showed nothing. Both are fixed.
Anything that removes `<style>` altogether (some sanitizers) leaves every stage stacked, so check
the destination or use the static documentation SVG per stage instead.

### CSS or SMIL

Decision: the Animated SVG stays **CSS keyframes only**. `animation_format.test.mjs` measures an
equivalent four-stage animation written both ways in every engine installed on the machine that
runs the tests (Chromium always; Firefox and WebKit when a build is found). On the last run
(Chromium 147, Firefox 153, WebKit 26.4):

| Engine | CSS in order | CSS stops on reduced motion | SMIL in order | SMIL stops on reduced motion |
| --- | --- | --- | --- | --- |
| Chromium | yes | yes | yes | no |
| Firefox | yes | yes | yes | no |
| WebKit | yes | yes | yes | no |

SMIL plays the same sequence, but `prefers-reduced-motion` cannot stop it, so a SMIL file would be
an accessibility regression and a second renderer to keep in step, for no verified gain. Add SMIL
only for a destination that is *measured* to ignore CSS animation but run SMIL, and then as a
fallback inside the same file, not a second export. Not measured here, and so not claimed:
Office, Google Docs, GitHub's image proxy and other sanitising destinations; check the actual
destination (procedure step 5) before relying on the animation.

## Non-Latin labels

The embedded Inter subset paints Latin text only (printable Latin, Latin-1 and common
typographic punctuation such as quotes, dashes, the ellipsis, the bullet and the euro sign).
A label in another script (Arabic, Hebrew, Han, Cyrillic, Greek, Hangul, Devanagari ... or an
emoji) would be drawn with whichever font each viewer happens to have, in another shape and
width than the layout measured, and nothing in the file would say so. The documentation SVG
export therefore **refuses** such a diagram, in the toolbar and in `export_snapshots.mjs`,
with a message that names the script and the characters (`Arabic: خ ... (U+062E ...)`). Words
the font covers are never listed, so a mixed Latin/Arabic label reports only its Arabic part.
The presenter itself still draws the diagram with the viewer's fonts. Its own join and loop
symbols are not checked; the loop's repeat condition is.

**Which scripts are supported.** Only Latin, through the pinned Inter subset; no other font is
embedded. `FONT_SCRIPTS` in `assets/diagram-engine.js` is the registry (script, font file,
version, SPDX licence, licence text, SHA-256), and `DiagramEngine.fontScripts()` reads it.
`node scripts/gen_font_assets.mjs --check` verifies the font bytes, the licence text and that
every character of the advance table exists in the font's own `cmap` (read by
`scripts/font_cmap.mjs`; a canvas silently measures a missing character with another font, so
the table alone proves nothing). `tests/font_portability.test.mjs` also loads the exported SVG
with the network blocked and compares the painted widths with what the layout measured.

**Adding a script.** Scripts that are painted one character at a time, such as Cyrillic and
Greek, can be added by registering a licensed font with its licence text and SHA-256 and
extending the advance table. Joined or shaped scripts (Arabic, Devanagari, Thai and similar)
change glyph shape and width with their neighbours, so per-character advances would reintroduce
the silent width mismatch; they stay refused until the layout measures shaped strings.

## Automated visual gates

`npm test` renders the exported SVG both as an image and inline for the dense, nested and
trust-boundary examples in light and dark, compares the two, checks that every wire still
ends on its node, that nothing is clipped, and that the PNG export has the same theme
background (`documentation_visual.test.mjs`). They catch a missing embedded font, a lost
style, a shifted arrow layer and a clipped scene without committed screenshots. They do not
replace the manual checks below: GitHub, Office and PDF viewers render SVG their own way.

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
