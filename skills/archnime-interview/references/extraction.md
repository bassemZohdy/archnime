# Drawing from code or a document

Use this path when the facts are already written down: the user asks to
"draw how this works", "diagram this repo", "the architecture of this
service", or names a document to draw from (a design doc, a docs page, an
article). The interview loop is for facts that live only in someone's head;
here the code or the document is the witness, and every box and line must be
able to point at it.

```
Progress:
- [ ] 1. Reader contract
- [ ] 2. Facts, each with its file or sentence
- [ ] 3. The format, from the spec brief
- [ ] 4. Spec written, validated and checked against the code
- [ ] 5. Critique against the contract
- [ ] 6. Report
```

## 1. Reader contract

Decide who reads the diagram before reading any code, and write it into the
spec as `meta.reader`:

- `audience`: who reads it (the README's audience, the user's words);
- `questions`: the 3 to 5 questions they must answer from the diagram alone;
- `idea`: the one idea it must make obvious;
- `omitted`: what is left out on purpose.

Take the reader from the context; ask only when nothing tells you. Everything
after this is checked against the contract: a part no question needs is left
out, a question no part answers is a gap. The validator warns
(`reader-contract-incomplete`) when there are fewer than 3 or more than 5
questions, or no idea.

## 2. Facts, each with its evidence

Set `meta.evidence: code` (or `document`). Then read the code the diagram
describes, at one level for the whole diagram (containers, or components of
one container), from each entry point the reader's questions touch to what it
calls, reads and writes.

- **Evidence only.** Draw a part only when a file backs it: a module, a route,
  a script, a store. Name it after the file that decides, found by following
  the imports, and put that file in its `source`. Draw a wire only where a
  line of code makes it, and give the wire a `source` with that line and a few
  words of it: `src/api.ts:42#db.insert(order)`. A person, a browser or a
  system the project calls but does not own (`type: actor` or `external`)
  needs no file; its wire takes the line that receives it.
- **What only the docs say** ("the data team reads it") is a claim no line
  backs. It goes into the report as a gap or a question, never into the
  drawing.
- **From a document**, the document is the facts in place of the code: draw a
  part only where a sentence states it and a wire only where a sentence says
  one part calls, sends to or reads from another. Its `source` is the
  document and a few words of the sentence, and its label uses the
  document's own words.
- **Ask only when the architecture is unclear**: the README describes a part
  the code does not have, two readings of the code are equally likely, or the
  request names something you cannot find. Say what you found and what you
  need. Decide everything else yourself.

The validator warns (`evidence-source-missing`) for every part or wire with no
`source` while `meta.evidence` is `code` or `document`; write a wire as a
mapping to carry one.

**Fit it to what a reader takes in.** About 12 nodes and 16 wires per view is
as much as a reader follows (`density-budget` warns past that). Merge parts
with the same relations (the merged node's `detail` names what it stands for),
use packages for drill-down, or split into views or flows. Raise
`meta.density` only when density is the point.

## 3. The format, from the spec brief

Print the format from the very copy of the DSL skill that will validate it,
rather than writing from memory:

```bash
python3 archnime-dsl/scripts/spec_brief.py
python3 archnime-dsl/scripts/spec_brief.py --section flow
```

The brief is one complete spec that uses the fields most diagrams need,
including `meta.reader`, `meta.evidence` and `source`, then one line per other
section. A field it does not list is not read.

## 4. Write, validate, check against the code

Write the spec beside the code it describes (`docs/diagrams/<name>.yaml`).
When the file exists, this is an update: start with the source check, move or
remove what lost its code, then walk the code for what is new. Change what
the check and the walk found, and nothing more.

```bash
python3 archnime-dsl/scripts/validate_transition_diagram.py --strict docs/diagrams/<name>.yaml
python3 archnime-dsl/scripts/check_sources.py docs/diagrams/<name>.yaml --root .
```

Repeat until both pass. A source the check reports is a fact you could not
back: fix the fact, not only the spec, and drop the part or line when no code
makes it. Never delete a `source` to make the check pass.

## 5. Critique against the contract

Before rendering, read the spec against `meta.reader` and fix what you find:

- a question the picture cannot answer, or a missing hop on its path;
- a box no file backs, or a wire with no line behind it;
- a part or a label no question needs;
- the one idea not visible without reading the notes.

Then hand the spec to `archnime-renderer` for the presenter and the
documentation SVG.

## 6. Report

Tell the user, briefly:

- the reader contract, and how the drawing answers each question;
- each part drawn, one line each, with the file (or sentence) behind it, or
  that none backs it (a browser, a person);
- each wire, one line each, with the line (or sentence) that makes it;
- on an update, what changed and why, starting with what the source check
  said had lost its code;
- what the diagram still does not show, and the gaps found only in the docs.
