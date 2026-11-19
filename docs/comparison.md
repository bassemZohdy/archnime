# archnime, Mermaid and archgram

Three ways to keep architecture diagrams as text beside the code. They
overlap, but each is built for a different job, and this page says where each
one fits so you can pick, or use two together.

- **Mermaid** is a general diagram language with many diagram kinds, rendered
  by a JavaScript library and natively by GitHub, GitLab and many docs sites.
  Facts below are from the Mermaid documentation at mermaid.js.org.
- **archgram** is a command-line tool and agent skill that draws one
  architecture or sequence diagram as an animated SVG for a README. Facts
  below are from its agent skill, version 0.10.1; a "no" in its column means
  that skill does not describe the feature.
- **archnime** (this repository) is a set of agent skills: a validated YAML
  source for one system, a migration, request flows, deployments and option
  comparisons, an interactive HTML presenter, and static exports.

## At a glance

| | archnime | Mermaid | archgram |
| --- | --- | --- | --- |
| Source | YAML with a JSON Schema, two validators (Python and browser) kept in step | Mermaid text, one syntax per diagram kind | YAML spec, checked by `archgram check` |
| Architecture diagram | yes, typed nodes and wires, packages, trust boundaries | `architecture-beta` (services, groups, junctions, icons; its documented edge syntax has no label) and C4 | yes |
| Request sequence | `flow:` with returns, refusals, async, `parallel`, `alt`/`opt`/`loop`, phases | `sequenceDiagram`, the richest of the three: also `critical`, `break`, activations, participant boxes, create and destroy | yes, with fragments and phases |
| Migration over several states | `transition:`, `steps:`, same ids across states | no | no |
| Named what-if variants | `scenarios:` | no | no |
| Deployment placement | `mode: deployment` views with replicas | as a diagram you draw yourself | no |
| Option comparison | `meta.comparison` with weighted criteria | no | no |
| Lifecycle (state machine), swimlanes, class, ER, Gantt | no | yes | no |
| Interactive viewing | presenter: pan, zoom, step playback, drill-down into packages and views, perspectives, focus on a node's neighbours | click links on flowchart nodes | no; an animated image |
| Static export for READMEs | documentation SVG with light and dark in one file, fonts embedded; PNG, PDF, GIF and animated SVG | rendered in place by the host; the theme is chosen when it is drawn | animated SVG with light and dark in one file |
| Your own colours | `meta.theme`, per scheme, refused under WCAG contrast | built-in themes, `themeVariables` on the `base` theme | a theme file |
| Technology logos | no (custom icons through `meta.icons`) | iconify icon packs on architecture diagrams | yes |
| Ties to the code | `source` on parts, wires and steps; `check_sources.py` reports what is gone | no | yes, `archgram check` |
| Wire routing | curved, orthogonal or straight, switchable live; every wire keeps the chosen style, or the export reports it | per layout engine | its own router |
| Mermaid output | yes: an `architecture-beta` projection and a `sequenceDiagram` companion | — | no |
| Embeds in another page | `<architecture-diagram>` web component | the Mermaid library | as an image |

## When to use which

- Use **Mermaid** when the host renders it for you and the picture is one of
  its kinds: a quick sequence in a pull request, a state machine, a class or
  ER diagram, a Gantt chart, swimlanes. Nothing to build or commit but text.
- Use **archgram** when you want one animated picture of the architecture or a
  request in a README, drawn from the code, with the project's logos.
- Use **archnime** when the diagram is a working document: a migration in
  stages, several views over one catalog, a deployment, a comparison of
  options, a request with branches, a presenter you can step through in a
  review, and exports for documents. archnime also writes Mermaid for the
  places that only render Mermaid.

## What this comparison changed in archnime

Built from this comparison:

- **Flow fragments and phases.** `alt` (with `else`), `opt` and `loop`
  fragments with guards, nestable, and named phases, in the validators, both
  translators, the presenter, the sequence SVG and the Mermaid companion.
- **Project colours.** `meta.theme` per scheme, applied to the presenter and
  both SVG exports, with a WCAG contrast check (`theme-contrast`).
- **Consistent wire styles.** Switching the routing style now changes every
  wire: a wire that cannot route in the chosen style is reported as blocked
  instead of being drawn in another style without notice.
- **Guidance.** A chooser for the kind of diagram (and what archnime does not
  draw), a catalogue of architecture styles and how to draw each, an update
  flow that starts from the source check, and a report that ends with the
  README lines.

Already in archnime before this comparison: the reader contract
(`meta.reader`), evidence-only drawing from code with `source` and the source
check, the density budget, the documentation SVG in light and dark, and the
sequence SVG.

Left out on purpose:

- **Technology logos.** Logos are trademarks with their own usage rules;
  `meta.icons` lets a project register the icons it is entitled to use.
- **Lifecycles and swimlanes.** They are not architecture views; the skills
  say so and point to Mermaid's state and swimlane diagrams.
- **Sequence details** such as activations, `critical`/`break` and
  participant boxes. A flow's self-call is drawn only as a `loop` step.
- **Native rendering on code hosts.** archnime exports images and Mermaid
  instead; the presenter needs a browser.
