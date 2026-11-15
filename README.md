# diagram-skills

Four portable Agent Skills for **interactive, animated architecture presentations** and **documentation-safe diagram exports**. A single validated YAML architecture model drives semantic validation, rendering, and export.

## Skills

| Skill | Responsibility |
| --- | --- |
| [architecture-diagram-interview](architecture-diagram-interview/) | Elicit architecture facts, boundaries, assumptions, and diagram type. |
| [architecture-diagram-dsl](architecture-diagram-dsl/) | Author, validate, and translate the renderer-independent YAML source. |
| [architecture-diagram-renderer](architecture-diagram-renderer/) | Present interactive HTML/D3, animated flows, multi-stage migrations, and SVG/raster exports. |
| [architecture-diagram-validation](architecture-diagram-validation/) | Validate semantics, layout, interactions, and documentation fidelity. |

**Pipeline:** interview → canonical DSL → validate/translate → interactive HTML → documentation-safe SVG.

The canonical DSL, not any SVG geometry, is the architecture source of truth. The renderer supports D3, Dagre, ELK, and force layouts. The browser outputs include search, zoom, disclosure, perspectives, and stage/flow playback.

## Quick start

Requirements: Python 3.12, Node 24+, and a modern Chromium for browser regression checks.

```bash
python -m pip install -r requirements-dev.txt
npm ci
npx playwright install chromium

python architecture-diagram-dsl/scripts/validate_transition_diagram.py architecture-diagram-dsl/assets/examples/checkout-flow.yaml
python architecture-diagram-dsl/scripts/translate_transition_diagram.py architecture-diagram-dsl/assets/examples/checkout-flow.yaml --output checkout-model.json
python architecture-diagram-renderer/scripts/build_bundle.py --template architecture-diagram-renderer/assets/template.html --model checkout-model.json --output checkout.html
```

Open `checkout.html` in a browser. By default it loads pinned D3/ELK/Dagre/GIF runtime scripts over the network; `--inline` only inlines the renderer's local sidecars and is **not** a fully offline bundle.

## Presentation vs documentation

Use **interactive HTML** for live demonstrations and drill-down. In the HTML export menu use **SVG (documentation)** for a static, zoom-independent SVG with embedded font data, a bounded viewBox, and an opaque background. Keep the viewer link alongside README diagrams; **embedded SVG images cannot provide the HTML interaction controls**. Export each important stage/view separately for formal documents. Animated SVG is available but needs destination-specific compatibility checks.

See [documentation-export.md](architecture-diagram-renderer/references/documentation-export.md) and [the renderer guide](docs/architecture-diagram-renderer.md).

## Tests

```bash
npm test
npm run check-fixtures
npm run check-fonts
```

`npm test` checks skill structure, pinned fonts, translated fixture parity, Python validators and headless browser interactions. CI sets `REQUIRE_BROWSER_TESTS=1` to prevent missing browser coverage from being reported as a pass. Layout pixel verification in GitHub/Office/PDF viewers remains a separate acceptance step.

## License

This repository's original scaffold and new integration files are MIT licensed under [LICENSE](LICENSE). The four architecture-diagram skills and their migrated implementation are Apache-2.0 licensed under [LICENSE-APACHE-2.0](LICENSE-APACHE-2.0) and each `SKILL.md` declares the same. The embedded Inter font is under the SIL Open Font License (see [font license](architecture-diagram-renderer/assets/fonts/LICENSE-Inter-OFL.txt)). Preserve these notices when distributing artifacts.
