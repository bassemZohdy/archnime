# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

- [ ] **FIX-023** · P0 · high · M · Keep every wire in the style the Wires control selects (curved, orthogonal, direct)
  - Done when: every visible wire of every example and fixture paints in the selected family, with no new crossings; `node skills/archnime-renderer/tests/routing_family_check.mjs`; regression: `npm test`
  - Links: Lane: hardening

- [ ] **FEAT-024** · P1 · mid · XL · Add alt/opt fragments and phases to flows, drawn in the sequence SVG and the Mermaid sequence
  - Done when: alt/opt/loop/par steps validate, translate and draw as frames; `python -m unittest discover -s skills/archnime-dsl/tests -p test_flow_fragments.py`
  - [ ] **FEAT-024.1** · high · M · Schema and both validators accept alt/opt operands with when guards and a phase field
    - Done when: each operand starts from the calls waiting before the fragment; `python -m unittest discover -s skills/archnime-dsl/tests -p test_flow_fragments.py`
  - [ ] **FEAT-024.2** · mid · M · Both translators carry fragments and phases; Mermaid sequence emits alt, opt, loop, par, notes, autonumber
    - Done when: Python and JS output match; `node skills/archnime-renderer/tests/translate_check.mjs`
  - [ ] **FEAT-024.3** · mid · M · Sequence SVG draws alt, opt, loop and par frames with guards, and phase labels
    - Done when: frames appear byte-stably; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`

- [ ] **FEAT-025** · P1 · mid · L · Let a spec set the project's light and dark colours, checked for contrast
  - Done when: meta.theme recolours the presenter and both SVG exports and low contrast is refused; `python -m unittest discover -s skills/archnime-dsl/tests -p test_theme.py`
  - [ ] **FEAT-025.1** · mid · M · Schema and both validators accept meta.theme roles and refuse pairs under WCAG contrast
    - Done when: a low-contrast pair is a finding in Python and JS; `python -m unittest discover -s skills/archnime-dsl/tests -p test_theme.py`
  - [ ] **FEAT-025.2** · mid · M · Renderer applies meta.theme to the presenter and both SVG exports
    - Done when: a themed spec paints its colours light and dark; `node skills/archnime-renderer/tests/static_svg_cli_check.mjs`

- [ ] **TASK-026** · P2 · low · M · Add skill guidance: diagram-kind chooser, update flow, report contract, styles catalogue, comparison
  - Done when: skills stay valid and the comparison doc exists; `npm run check-skills`
