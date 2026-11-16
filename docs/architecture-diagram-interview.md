# architecture-diagram-interview

Use this skill as the front door when an architecture brief is incomplete or
the right diagram mode has not been chosen. It elicits the smallest useful set
of facts, makes assumptions visible, and hands a confirmed semantic source to
the DSL and renderer skills.

- **Skill directory:** [`skills/architecture-diagram-interview/`](../skills/architecture-diagram-interview/)
- **Entry file:** [`SKILL.md`](../skills/architecture-diagram-interview/SKILL.md)
- **Pairs with:** [`architecture-diagram-dsl`](architecture-diagram-dsl.md) for
  validation and [`architecture-diagram-renderer`](architecture-diagram-renderer.md)
  for HTML/SVG output.

## 1. When this skill applies

Load it for requests such as “help me diagram my architecture,” an incomplete
system description, or a design that has not yet chosen among a system
snapshot, transition, steps, scenarios, flow, deployment, multi-view, or
comparison representation. Use a fill-gaps pass when a partial fact ledger or
existing YAML is already available.

## 2. Interview procedure

1. Establish the desired mode and audience.
2. Ask a compact batch of related questions from the matching mode bank.
3. Offer sensible defaults and a “you decide” escape for reversible choices.
4. Maintain stable IDs, relationships, boundaries, lifecycle changes, and
   unresolved assumptions in a fact ledger.
5. Apply only relevant nudges: keep packages distinct from ownership/trust
   boundaries, preserve identity across states, and do not invent evidence.
6. Present a plain-language summary with explicit gaps and assumptions.
7. Wait for confirmation or corrections before emitting YAML.

The skill does not validate, translate, lay out, or render the document itself;
those responsibilities remain in the paired skills.

## 3. Output contract

The confirmed handoff contains:

- a concise architecture summary;
- the selected mode and version (`transition-diagram/1.0` or `2.0`);
- stable component identities, boundaries, relationships, and lifecycle facts;
- an explicit assumptions and gaps report; and
- the smallest useful YAML source.

Comparison requests additionally capture the option set, decision criteria,
relative weights, ratings or notes, and any preferred option. The DSL validator
must pass before the renderer is offered.

## 4. Reference material

- [`references/question-banks.md`](../skills/architecture-diagram-interview/references/question-banks.md)
  — mode-specific questions and defaults.
- [`references/best-practice-nudges.md`](../skills/architecture-diagram-interview/references/best-practice-nudges.md)
  — reusable modeling guidance.
- [`references/output-contract.md`](../skills/architecture-diagram-interview/references/output-contract.md)
  — confirmation and handoff requirements.
- [`references/comparison.md`](../skills/architecture-diagram-interview/references/comparison.md)
  — option comparison and ADR handoff.

For a no-touch preview of the full interview-to-render path, pair this skill
with an optional external sandbox runner and keep the confirmed source,
translated model, bundle, and report under
`.sandbox/architecture-diagram/<slug>/` until the user chooses a disposition.
