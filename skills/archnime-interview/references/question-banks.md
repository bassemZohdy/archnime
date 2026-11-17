# Architecture interview question banks

Ask only the selected bank's questions, in batches. Start with the first two
or three high-value questions and defer presentation choices.

| Mode | Core questions | Useful default |
| --- | --- | --- |
| System | What enters the system? What are the main services/data stores? Who owns or trusts each boundary? | Use `system:` and `meta.layout: auto`. |
| Transition | What is current? What is target? Which identities persist, change, appear, or retire? | Use full `transition:` states when both endpoints are known. |
| Steps | What is the base state? What cumulative add/remove/set changes happen in order? | Use `steps:` when deltas explain the migration better than repeated full states. |
| Flow | What is the fixed topology? What are the ordered calls, returns, groups, parallel branches, and retries? | Keep one topology and use `flow.steps`; offer the Mermaid sequence companion. |
| Deployment | Which logical components run in which region/cluster/host targets? Are there replicas? | Use a v2 `views:` bundle and `mode: deployment`; keep hosts out of the logical catalog. |
| Views | Which perspectives should be navigable, and what is the shared catalog/package set? | Use `navigateTo` for view changes and stable `viewId` values. |
| Scenarios | Which independent variants share the base? What differs in each? | Use `scenarios:` and a selector, not sequential playback. |
| Comparison | How many options? Which criteria and weights? Is one preferred? What is each option's tradeoff? | Use v2 views plus `meta.comparison`; do not imply a recommendation without evidence. |

For every mode, ask for stable names and relationships before colors,
coordinates, animation timing, or other renderer-only preferences. “You decide”
means the skill selects the documented default and records that choice as an
assumption.
