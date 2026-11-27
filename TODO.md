# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

### hardening

- [ ] **TASK-044** (task): Decide whether staged playback should loop. It stops after the last stage and a flow loops only with `meta.flow.loop`; the gate measures one run and records no loop length. If it should loop, add an option or a default and measure the loop in the gate; if not, say so in docs/build-time-layout.md and drop the item. From: TASK-037. Check: `node skills/archnime-renderer/tests/playback_gate_check.mjs`.
