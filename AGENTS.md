# Diagram skills contributor guidance

Only four architecture-diagram skills live here. Keep their canonical YAML semantics distinct from renderer layout details; never modify catalog IDs, relationship endpoints, or trust-boundary membership to hide display defects.

- Work in the responsible skill's reusable source; never patch generated HTML to conceal a bug.
- Check schema validation and renderer self-check, then execute browser render/interaction tests where available.
- Keep generated fixtures in sync with YAML sources using `npm run regen-fixtures`.
- Keep the pinned Inter font and matching font-metrics table synchronized using `npm run check-fonts`.
- Documentation exports must include the complete visible diagram independent of presenter pan/zoom; check font embedding, bounds, source meaning, and image rendering.
- Prefer new targeted fixtures and regression tests over expanding the skills' scope unnecessarily.
- Keep the four skills standalone and public; do not add repository-specific secrets, private organizational documents, or unrelated agent/workflow skills.
- Do not merge unverified changes; missing browser or visual evidence is a limitation, not a pass.
