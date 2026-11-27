# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree
- [ ] **FIX-043** (fix): Text on large diagrams is too small to read. At 1280 px wide the diagram scales to about 0.55 to fit, so 11 to 13 px labels paint at 5.5 to 6.1 px and a quarter to a third of the characters are under 12 px (`strangler-migration` 6.1 px and 31.9%, `checkout-flow` 5.5 px and 27%). From: TASK-037. Check: `node skills/archnime-renderer/tests/playback_gate_check.mjs` with the `minTextPx` and `smallTextPercent` known gaps removed from `playback-gate-budgets.json`.
- [ ] **TASK-044** (task): Decide whether staged playback should loop. It stops after the last stage and a flow loops only with `meta.flow.loop`; the gate measures one run and records no loop length. If it should loop, add an option or a default and measure the loop in the gate; if not, say so in docs/build-time-layout.md and drop the item. From: TASK-037. Check: `node skills/archnime-renderer/tests/playback_gate_check.mjs`.
