# Best-practice nudges

Use these as short interventions during the interview, not as a lecture.

- Stable identity: one catalog ID represents the same component across every
  state/view. A changed label or role belongs in the state/view override; a
  replacement component gets a new ID.
- Hierarchy: packages describe logical containment and ownership. Boundaries
  describe trust, compliance, or responsibility and can overlap packages.
- Wires: model one same-direction/same-type relationship once. Use labels and
  wire types for meaning; do not encode layout coordinates in the semantic
  source.
- Layout: prefer `auto` and leave engine selection to the renderer skill; here,
  capture only whether the user has a layout preference or constraint (e.g. a
  required direction or a fixed physical arrangement).
- C4 discipline: do not mix context, container, and component detail in one
  unexplained view. Use levels or separate navigable views.
- Deployment: infrastructure nesting belongs in the deployment view. Derive
  deterministic replica IDs and retain the logical relationship as a
  representative route rather than drawing an N×M fan-out.
- Uncertainty: unresolved ownership, data classification, route behavior, or
  migration timing must appear in the assumptions/gaps report.
