#!/usr/bin/env python3
"""Keep installed validation examples synchronized with the DSL source set."""

from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[2]
DSL = ROOT / "archnime-dsl" / "assets" / "examples"
VALIDATION = ROOT / "archnime-validation" / "examples"


class ValidationExampleSyncTests(unittest.TestCase):
    def test_validation_examples_match_canonical_dsl_examples(self) -> None:
        self.assertEqual(sorted(path.name for path in VALIDATION.glob("*.yaml")), sorted(path.name for path in DSL.glob("*.yaml")))
        for source in sorted(DSL.glob("*.yaml")):
            with self.subTest(source=source.name):
                self.assertEqual((VALIDATION / source.name).read_bytes(), source.read_bytes())


if __name__ == "__main__":
    unittest.main()
