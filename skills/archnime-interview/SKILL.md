---
name: archnime-interview
description: Elicit the minimum architecture facts needed to produce a validated transition-diagram YAML; use when the user says “help me diagram my architecture,” has an incomplete architecture brief, or needs to choose among system, transition, flow, deployment, or comparison views. Also use it to draw an architecture from the code or a named document ("draw how this works", "diagram this repo"): it writes the reader contract and an evidence-only spec where every part and wire names the file or sentence behind it.
license: Apache-2.0
---

# Architecture Diagram Interview

Act as the front door to the architecture-diagram DSL. Turn an incomplete
brief into a plain-language architecture summary, an explicit assumptions and
gaps report, and—only after confirmation—a `transition-diagram/1.0` or `2.0`
YAML source. Do not reimplement schema validation, translation, layout, or
rendering here; hand those jobs to the paired skills.

## Drawing from code or a document

When the facts are already written down (the user asks to "draw how this
works", diagram a repository, or names a design doc to draw from), do not
interview for them: follow `references/extraction.md`. In short:

1. Write the reader contract into `meta.reader`: audience, 3 to 5 questions,
   the one idea, what is left out.
2. Set `meta.evidence: code` (or `document`) and draw only what a file or a
   sentence backs, each part and wire with its `source`; what only the docs
   claim is a gap for the report.
3. Print the format with `archnime-dsl/scripts/spec_brief.py` instead of
   writing from memory.
4. Validate with `--strict`, then run `archnime-dsl/scripts/check_sources.py`
   until both pass; keep within the density budget. On an update, run the
   source check first, on the spec as it is.
5. Critique the spec against the contract, then report each part and wire
   with its evidence.

Ask the user only when the code and the docs disagree or the request names
something you cannot find.

## Choose the kind

Draw the kind the reader's question asks for, and never one kind as another
without saying so: a request drawn as a system loses its order, and a
migration drawn as one snapshot loses what changed.

| The reader asks | Draw |
| --- | --- |
| What is it made of, and what calls what? | `system:` (one snapshot) |
| In what order do the parts call each other for one request, and what comes back? | `flow:`, with `alt`/`opt`/`loop` for its branches and `phase` for its parts; the sequence SVG and the Mermaid companion come from the same spec |
| How do we get from today's system to the target, step by step? | `transition:`, or `steps:` when each step is a small change |
| What changes under this failure, region or option? | `scenarios:` |
| Where does each part run? | a `views:` bundle with a `mode: deployment` view |
| Which of these options should we pick? | a `views:` bundle with `meta.comparison` |
| What states does one thing go through (a lifecycle)? Which role does each step of a business process (lanes)? | Not a kind archnime draws. Say so, offer a `flow:` or `system:` where it answers part of the question, and point to a state or swimlane diagram tool (Mermaid `stateDiagram`, Mermaid swimlanes) for the rest |

"How it works", "the architecture", a diagram for a README: `system:`.
"What happens when ...", "step by step", one request: `flow:`.
`references/architecture-styles.md` says, per architecture style, which of
these a reader usually needs and how to draw it.

## Interview loop

1. Start mode-first. Ask which outcome is needed: one system snapshot,
   ordered migration, fixed request flow, deployment placement, named
   scenarios, or a comparison of options (the table above). If the user has
   already made the choice, skip this question.
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
- Read `references/extraction.md` to draw from code or a named document.
- Read `references/architecture-styles.md` to recognise the system's style and
  what its readers ask.

Pairs with `archnime-dsl` for semantic YAML and validation, then
`archnime-renderer` for interactive HTML/SVG. When available,
`engineering:system-design` and `engineering:architecture` are optional
companions for deeper tradeoff reasoning and ADRs; they do not replace this
elicitation loop or the DSL validator.

When a user wants a non-destructive preview, keep the confirmed YAML,
translated model, HTML bundle, and review report in a dedicated temporary
workspace. Review the artifacts before explicitly promoting them into a project.
