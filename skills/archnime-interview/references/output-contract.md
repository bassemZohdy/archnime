# Interview output contract

Before YAML, present:

1. **Mode and scope** — the selected root mode and any v2 views.
2. **Plain-language summary** — components, boundaries, relationships, and
   the narrative in the user's terms.
3. **Assumptions** — defaults selected by the skill or facts supplied as
   uncertain.
4. **Open gaps** — questions that could change semantic identity, topology,
   ownership, or recommendation. Layout preferences are not blocking gaps.
5. **Confirmation prompt** — ask whether to write the YAML or revise the
   summary only when semantic gaps, uncertain ownership/topology, or an
   unapproved recommendation remain. A complete brief that already requests
   YAML or rendering is authorized to proceed with its assumptions stated.

After confirmation, emit the YAML, run the DSL validator, report every finding
without hiding it, and offer the renderer pipeline. Preserve the YAML as the
semantic source; generated JSON/HTML are derivatives. A handoff should state
which validation and rendering commands were run and link the optional
engineering/ADR follow-up when relevant.
