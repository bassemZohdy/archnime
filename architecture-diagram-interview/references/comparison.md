# Comparison interview branch

Capture a comparison as a set of peer options, not as a fake sequential
migration. Ask:

- How many options should be compared, and what is each option's short name?
- Which criteria matter, and what relative weight does each have?
- For each option/criterion, is there a rating, a qualitative note, or both?
- Is there a preferred option, and what evidence supports that preference?

Use v2 `views:` so every option can reuse stable catalog IDs while presenting
its own topology or tradeoffs. Put shared criteria and the recommendation in
`meta.comparison`; put per-option ratings/notes beside the corresponding view.
Keep recommendation and uncertainty explicit. Do not turn a comparison into
playback and do not invent scores to fill missing evidence.

After confirmation, offer an ADR containing context, options, criteria,
tradeoffs, recommendation, risks, and unresolved questions. The diagram is
the navigable structure; the ADR remains the reasoning record.
