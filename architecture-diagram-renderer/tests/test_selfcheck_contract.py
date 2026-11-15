"""Static contract: every self-check type is weighted for Tune and documented."""

from __future__ import annotations

import re
import unittest
from pathlib import Path

RENDERER = Path(__file__).resolve().parents[1]
ENGINE = (RENDERER / "assets" / "diagram-engine.js").read_text(encoding="utf-8")
VALIDATION = (RENDERER / "references" / "validation.md").read_text(encoding="utf-8")

SEMANTIC_TYPES = {
    "unknown-node", "duplicate-node", "wire-unknown-endpoint", "wire-self", "changed-missing",
    "declared-node-not-rendered", "flow-step-empty", "flow-step-unknown-edge", "flow-return-no-forward",
}


def emitted_types() -> set[str]:
    # Bare push(...) calls are the self-check reporter; `.push(` is array code.
    return set(re.findall(r'(?<![.\w])push\("([a-z]+(?:-[a-z]+)*)"', ENGINE))


def weights() -> dict[str, int]:
    start = ENGINE.index("const layoutIssueWeight")
    block = ENGINE[start:ENGINE.index("[type] || 1", start)]
    return {name: int(value) for name, value in re.findall(r'"([a-z-]+)": (\d+)', block)}


def documented_types() -> set[str]:
    found: set[str] = set()
    for line in VALIDATION.splitlines():
        if line.startswith("| `"):
            found.update(re.findall(r"`([a-z]+(?:-[a-z]+)*)`", line.split("|")[1]))
    return found


class SelfCheckContractTests(unittest.TestCase):
    def test_every_emitted_type_has_a_tune_weight(self) -> None:
        self.assertEqual(sorted(emitted_types() - set(weights())), [], "emitted self-check types without a Tune weight")

    def test_every_emitted_type_is_documented(self) -> None:
        self.assertEqual(sorted(emitted_types() - documented_types()), [], "emitted self-check types missing from references/validation.md")

    def test_semantic_types_cannot_be_traded_away(self) -> None:
        table = weights()
        for name in sorted(SEMANTIC_TYPES):
            with self.subTest(type=name):
                self.assertGreaterEqual(table.get(name, 0), 1000)
        layout_max = max(value for name, value in table.items() if name not in SEMANTIC_TYPES)
        self.assertLess(layout_max, 1000)

    def test_no_weight_names_a_type_the_engine_never_emits(self) -> None:
        self.assertEqual(sorted(set(weights()) - emitted_types()), [], "stale weights")


if __name__ == "__main__":
    unittest.main()
