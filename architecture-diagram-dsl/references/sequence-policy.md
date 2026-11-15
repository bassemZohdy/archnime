# Sequence companion policy

The DSL translator may emit a Mermaid `sequenceDiagram` companion for a
`flow:` document. It is a readable narrative projection, not a second
semantic source: the YAML flow topology, ordered steps, return edges, groups,
parallel branches, and retry metadata remain authoritative. The companion
may omit package and boundary geometry and must never be used to validate
component identity or wire endpoints. Run the canonical DSL validator before
emitting it; the renderer's browser checks cover its header and representative
flow constructs.
