# Roadmap

The following work remains focused on interactive architecture diagrams and reliable documentation delivery.

- [ ] **P0 · Documentation fidelity verification:** inspect the zoom-independent documentation SVG against real GitHub Markdown rendering and dense nested diagrams before considering it production-verified.
- [ ] **P0 · Batch snapshots:** export each required view, migration stage, or flow step and attach provenance + SHA-256 manifest.
- [ ] **P1 · Offline presenter:** vendor pinned runtime scripts and prove that the HTML viewer is fully functional without network access.
- [ ] **P1 · Visual regression:** compare image-embedded SVG and PNG at realistic Markdown/Office widths, including labels, arrowheads, boundaries, and dark/light themes.
- [ ] **P1 · Multilingual font fidelity:** ensure Arabic and other non-Latin labels embed a licensed font or fail explicitly instead of silently reflowing.
- [ ] **P2 · Animated SVG compatibility:** compare current CSS-keyframe animation with SMIL on actual target viewers; keep a static fallback.
