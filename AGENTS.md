# Diagram skills contributor guidance

Four architecture-diagram domain skills live here, plus `archnime`, an aggregator that scans the workspace and routes to them. Keep canonical YAML semantics distinct from renderer layout details; never modify catalog IDs, relationship endpoints, or trust-boundary membership to hide display defects.

- Work in the responsible skill's reusable source; never patch generated HTML to conceal a bug.
- Check schema validation and renderer self-check, then execute browser render/interaction tests where available.
- Keep generated fixtures in sync with YAML sources using `npm run regen-fixtures`.
- Keep the pinned Inter font and matching font-metrics table synchronized using `npm run check-fonts`.
- Documentation exports must include the complete visible diagram independent of presenter pan/zoom; check font embedding, bounds, source meaning, and image rendering.
- Prefer new targeted fixtures and regression tests over expanding the skills' scope unnecessarily.
- Keep the skills standalone and public; do not add repository-specific secrets, private organizational documents, or unrelated agent/workflow skills.
- The aggregator owns no diagram rules: it only reads the workspace (`skills/archnime/scripts/workspace_state.py`) and routes to a domain skill. A new scanner state needs a routing row in its `SKILL.md` (`test_skill_contract.py` enforces this); a new rule belongs in the domain skill that owns it.
- The skills live in `skills/<name>/`; the repository root is a plugin (`plugin.json`, `.claude-plugin/`, `.agents/plugins/`, `gemini-extension.json`). Keep the plugin name and version identical in every manifest (`npm run check-skills` enforces it). Commands written inside a `SKILL.md` or its `references/` are relative to the folder holding the skills, so they work both here and in an installed copy; do not prefix them with `skills/`.
- Do not merge unverified changes; missing browser or visual evidence is a limitation, not a pass.
