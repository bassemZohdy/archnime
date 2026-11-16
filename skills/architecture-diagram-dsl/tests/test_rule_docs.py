#!/usr/bin/env python3
"""TASK-013: every rule a validator can emit is documented and has a negative fixture.

The rule names are the contract between the two validators, the documentation and the
fixtures. Without this guard a new rule can ship in the code alone, and a rule that was
removed can linger in the table that agents read.
"""

from __future__ import annotations

import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "architecture-diagram-dsl"
PYTHON_VALIDATOR = (SKILL / "scripts" / "validate_transition_diagram.py").read_text(encoding="utf-8")
BROWSER_VALIDATOR = (SKILL / "scripts" / "validate_transition_diagram.js").read_text(encoding="utf-8")
REFERENCE = (SKILL / "references" / "validation-and-review.md").read_text(encoding="utf-8")
EXPECTED = json.loads((SKILL / "assets" / "fixtures" / "invalid" / "expected-findings.json").read_text(encoding="utf-8"))

# `schema` is the JSON Schema pass, documented under "Two passes" rather than as a lint row.
SCHEMA_PASS = "schema"
# A defensive net that must never fire on a schema-valid document, so no fixture can trigger it.
NO_FIXTURE_BY_DESIGN = {"lint-internal-error"}


def emitted_rules() -> set[str]:
    python = set(re.findall(r'Finding\(\s*"([a-z][a-z0-9-]*)"', PYTHON_VALIDATOR))
    browser = set(re.findall(r'finding\("([a-z][a-z0-9-]*)"', BROWSER_VALIDATOR))
    return python | browser | {SCHEMA_PASS}


def documented_rules() -> set[str]:
    return set(re.findall(r"^\| `([a-z][a-z0-9-]*)` \|", REFERENCE, flags=re.MULTILINE))


def fixture_rules() -> set[str]:
    return {rule for entry in EXPECTED.values() for rule in entry["rules"]}


class RuleContractTests(unittest.TestCase):
    def test_the_rule_scan_finds_the_rules(self) -> None:
        """Guard the guard: an empty scan would make every other test vacuous."""
        for name, rules in (("emitted", emitted_rules()), ("documented", documented_rules()), ("fixture", fixture_rules())):
            self.assertGreater(len(rules), 30, f"the {name} rule scan found only {len(rules)} rules")

    def test_every_emitted_rule_has_a_row_in_the_reference(self) -> None:
        missing = sorted(emitted_rules() - documented_rules() - {SCHEMA_PASS})
        self.assertEqual(missing, [], f"rules emitted by a validator but missing from validation-and-review.md: {missing}")

    def test_every_documented_rule_is_still_emitted(self) -> None:
        stale = sorted(documented_rules() - emitted_rules())
        self.assertEqual(stale, [], f"rules documented in validation-and-review.md that no validator emits: {stale}")

    def test_the_schema_pass_is_documented(self) -> None:
        self.assertIn("`rule: schema`", REFERENCE)

    def test_every_emitted_rule_has_a_negative_fixture(self) -> None:
        without = sorted(emitted_rules() - fixture_rules() - NO_FIXTURE_BY_DESIGN)
        self.assertEqual(without, [], f"rules with no fixture in expected-findings.json: {without}")

    def test_every_fixture_names_only_known_rules(self) -> None:
        unknown = sorted(fixture_rules() - emitted_rules())
        self.assertEqual(unknown, [], f"expected-findings.json names rules no validator emits: {unknown}")


if __name__ == "__main__":
    unittest.main()
