# Shared visual language

The durable style and icon mapping lives in `assets/architecture-library.js`. Generated diagrams load that file beside the HTML. Do not tune colours or redraw a semantic icon per diagram; change the library once when the system-wide language needs to evolve.

## Permanent flow mapping

| `type` | Appearance | Meaning |
| --- | --- | --- |
| `data` | solid cyan, 2.6px, arrowhead | Request, event, or payload flow |
| `security` | dashed pink, 2.2px, arrowhead | Authentication, authorization, identity |
| `control` | dotted purple, 2.2px, arrowhead | Configuration, orchestration, control |
| `compat` | dashed amber, 2.2px, arrowhead | Temporary compatibility route |
| `neutral` | solid grey, 1.6px, arrowhead | Supporting call |

Active data flow is a second dashed/dotted animated stroke with a moving dash offset. It is an overlay, not a replacement for the semantic base line. Stagger simultaneous flows deterministically. The on-diagram legend always explains at least data, security, and control, plus any other type present.

## Permanent node mapping

The library maps semantic types to fixed SVG symbols:

| Type | Icon / outer shape | Use for |
| --- | --- | --- |
| `actor`, `user` | Person icon in a pill | People, devices, callers |
| `service`, `function` | Service icon in a rounded rectangle | Applications and executable services |
| `gateway` | Gateway icon in a rounded rectangle | Gateways, ingress, routers |
| `agent` | Agent icon in a rounded rectangle | AI agents |
| `llm`, `model` | Model chip icon in a rounded rectangle | Language models the system calls |
| `vector-store` | Store icon with linked points, database cylinder | Embedding indexes for retrieval |
| `tool` | Wrench icon in a rounded rectangle | Functions an agent may call |
| `database`, `cache` | Database cylinder | Durable stores and caches |
| `queue`, `topic` | Rounded queue rail with stacked-message glyph | Queues, topics, streams |
| `external`, `provider` | External-system icon | Systems outside the estate |
| `security`, `idp` | Shield icon | Identity/security services |
| `package` | Package icon in a grouped block | Collapsed nested cluster |

`variant: external` draws any type with a dashed outline: the part is run by someone else. A `refused` flow step is drawn as short dashes in the security colour ending in a cross at the caller.

`kind` remains a lifecycle/role treatment: existing amber, new cyan, mixed cyan-on-amber, security pink, retired grey. The type/icon and kind/treatment carry different meanings and should not be conflated.

## Typography and accessibility

Labels are driven by the shared `--diagram-label-font`, `--diagram-detail-font`, `--diagram-wire-font`, and `--diagram-line-height` tokens. The runtime reads those CSS values for SVG measurement and wrapping, so CSS and geometry cannot silently drift. Presenter/print mode raises labels and increases contrast; labels wrap to two lines maximum.

Measure the complete label against that two-line budget before placement, not
just its longest word. Include detail text when sizing collapsed packages as
well as leaf nodes. Automatic widening is capped at 300 logical pixels and
must never shrink an explicitly wider node; content that still cannot fit
remains a validation finding.

Text colours use dedicated label tokens rather than low-contrast stroke colours. The light-theme data, security, control, neutral, and compatibility label colours target at least 4.5:1 against the panel; the dark-theme equivalents do the same against the dark panel. The default muted detail colour also targets at least 4.5:1. Lines and decorative strokes may use the brighter semantic colours because they are non-text graphics, but any text label must use its accessible label token. Every node has a title for assistive hover/readout, and selected search results use glow plus connected-edge emphasis rather than colour alone.

Secondary `control` and `neutral` flows can be marked as `layer: secondary`. `flowPresentation.mode: deemphasize` preserves their routes while reducing visual competition; `secondaryRoute: bundle` gives explicitly named secondary groups a shared lane. The live Curved, Orthogonal, or Direct routing choice still applies to bundled wires. Cross-cutting boundary envelopes use a deterministic visual lane offset when their rails would coincide; this is a paint-space distinction, not a new hierarchy or scope. Neither option changes the permanent semantic type mapping.

## Themes and motion

The library palette has light and dark values. Check both. `prefers-reduced-motion` removes transitions and moving flow overlays but leaves arrows, labels, and stage navigation intact. Use the same icon geometry at every zoom level; semantic zoom changes visible detail, not the identity of a component.
