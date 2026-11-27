# Active Backlog

## 🛤️ Lanes

- main: documentation reliability, interactive presentation portability, and architecture diagram validation
- hardening: review-derived correctness, Python/browser parity, security and test-gate fixes

## 🌳 Task Tree

### hardening

- [ ] **FIX-041** (fix): Pause does not stop the animated flow dashes: in a flow walkthrough the dashes on the active wires keep moving after Pause. From: TASK-037. Check: `node skills/archnime-renderer/tests/playback_gate_check.mjs` with `movingWhenPaused` removed from `playback-gate-budgets.json`.
- [ ] **FIX-042** (fix): In a flow view, collapsing a package is not painted until the next repaint, because the flow layout is refreshed on expand and not on collapse. From: FEAT-038. Check: `node skills/archnime-renderer/tests/stored_geometry_check.mjs commerce-views` fails when a collapse click has no effect.
