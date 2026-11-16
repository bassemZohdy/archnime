---
name: archnime-interview
description: Elicit the minimum architecture facts needed to produce a validated transition-diagram YAML; use when the user says “help me diagram my architecture,” has an incomplete architecture brief, or needs to choose among system, transition, flow, deployment, or comparison views.
license: Apache-2.0
---

# Architecture Diagram Interview

Act as the front door to the architecture-diagram DSL. Turn an incomplete
brief into a plain-language architecture summary, an explicit assumptions and
gaps report, and—only after confirmation—a `transition-diagram/1.0` or `2.0`
YAML source. Do not reimplement schema validation, translation, layout, or
rendering here; hand those jobs to the paired skills.

## Interview loop

1. Start mode-first. Ask which outcome is needed: one system snapshot,
   ordered migration, fixed request flow, deployment placement, named
   scenarios, or a comparison of options. If the user has already made the
   choice, skip this question.
2. Ask a small batch of related questions from the selected mode bank. Prefer
   one compact batch over a long chain of single-field questions. Offer
   sensible defaults and a “you decide” option when a choice is reversible or
   presentation-only.
3. Maintain a fact ledger: stable component IDs, labels/types, packages,
   boundaries, relationships, lifecycle changes, ownership, and unresolved
   assumptions. Never invent an external dependency, route, owner, or
   compliance boundary silently.
4. Apply only the relevant best-practice nudges. In particular, keep package
   hierarchy distinct from boundaries, preserve identity across stages, keep
   same-direction/type relationships to one line, and leave layout on `auto`
   unless the author has a reason to override it. Layout-engine selection and
   geometry thresholds belong to the renderer skill, not this elicitation loop.
5. Assemble a short plain-language summary and show the open gaps and
   assumptions. Ask for confirmation when a consequential semantic gap or
   recommendation remains. If the user has already authorized YAML or a full
   render and the brief is complete, state assumptions and proceed without a
   second permission gate.
6. Emit the smallest useful YAML. Use v2 `views:` only when multiple
   perspectives or deployment/comparison navigation share a catalog; include
   `meta.comparison` for option comparisons. Then invoke
   `archnime-dsl` to validate it and offer
   `archnime-renderer` for HTML/SVG output.

For a cold start, use the mode bank and ask for the smallest set of facts that
can establish the mode. For a fill-gaps pass, show the current fact ledger,
ask only unanswered questions that affect semantics, and leave layout-only
preferences for the renderer.

## Comparison branch

When the user wants alternatives, ask for the number of options, decision
criteria, relative weights, and whether there is a preferred option. Capture
ratings or notes per criterion, keep all options comparable, and offer an ADR
draft after the diagram source is confirmed. See
`references/comparison.md`.

## References and handoff

- Read `references/question-banks.md` for mode-specific prompts and defaults.
- Read `references/best-practice-nudges.md` when reviewing or filling gaps.
- Read `references/output-contract.md` before the confirmation and handoff.
- Read `references/comparison.md` for option branches and ADR handoff.

Pairs with `archnime-dsl` for semantic YAML and validation, then
`archnime-renderer` for interactive HTML/SVG. When available,
`engineering:system-design` and `engineering:architecture` are optional
companions for deeper tradeoff reasoning and ADRs; they do not replace this
elicitation loop or the DSL validator.

When a user wants a non-destructive preview, keep the confirmed YAML,
translated model, HTML bundle, and review report in a dedicated temporary
workspace. Review the artifacts before explicitly promoting them into a project.
