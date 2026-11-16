# architecture-diagram-validation

Review architecture-diagram YAML, normalized models, rendered HTML/SVG, and
the evidence that connects them. This skill is paired with the DSL validator
for semantic contracts and the renderer for geometry and interaction checks.

## Run

From the repository root, use the commands in
[`skills/architecture-diagram-validation/SKILL.md`](../skills/architecture-diagram-validation/SKILL.md).
The repository gate is `npm test`; browser checks are explicit `SKIP` locally
when Chromium is unavailable and required in CI.

## Verdicts

Report semantic, translation, geometry, interaction, delivery, and environment
results separately. Use **pass** only when required checks ran, **conditional
pass** when only environment-limited checks remain, and **fail** for a defect
or an incomplete required assertion.
