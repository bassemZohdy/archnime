#!/usr/bin/env python3
"""Regression coverage for structured DSL CLI error results."""

from __future__ import annotations

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "archnime-dsl" / "scripts" / "validate_transition_diagram.py"
SPEC = importlib.util.spec_from_file_location("validate_transition_diagram", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
# dataclasses resolves string annotations through sys.modules, so register before executing;
# without this the file only loads when another test module imported the validator first.
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


class ValidateTransitionDiagramTests(unittest.TestCase):
    def test_yaml_12_label_scalars_remain_strings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "scalars.yaml"
            source.write_text(
                """dsl: transition-diagram/1.0
meta:
  title: Scalar labels
catalog:
  yes-node:
    label: yes
    type: service
  on-node:
    label: on
    type: service
system:
  title: Scalar labels
  nodes: [yes-node, on-node]
  wires: []
""",
                encoding="utf-8",
            )
            loaded = MODULE.load_document(str(source))
            self.assertEqual(loaded["catalog"]["yes-node"]["label"], "yes")
            self.assertEqual(loaded["catalog"]["on-node"]["label"], "on")

    def test_v2_transition_duplicate_state_id_is_reported(self) -> None:
        findings = MODULE.run_lint_pass(
            {
                "views": [{
                    "id": "migration",
                    "mode": "transition",
                    "states": [
                        {"id": "same", "title": "One", "nodes": ["app"], "wires": []},
                        {"id": "same", "title": "Two", "nodes": ["app"], "wires": []},
                    ],
                }],
                "catalog": {"app": {"label": "App", "type": "service"}},
            }
        )
        self.assertTrue(any(finding.rule == "duplicate-id" and "states[1]" in finding.path for finding in findings))

    def test_leaf_components_cannot_have_multiple_package_parents(self) -> None:
        findings = MODULE.run_lint_pass(
            {
                "catalog": {"app": {"label": "App", "type": "service"}},
                "packages": {"one": {"children": ["app"]}, "two": {"children": ["app"]}},
                "system": {"title": "Packages", "nodes": ["app"], "wires": []},
            }
        )
        self.assertTrue(any(finding.rule == "package-multiple-parents" and "app" in finding.message for finding in findings))

    def test_deployment_repeated_component_target_is_reported(self) -> None:
        findings = MODULE.run_lint_pass(
            {
                "catalog": {"app": {"label": "App", "type": "service"}},
                "views": [{
                    "id": "production",
                    "mode": "deployment",
                    "nodes": ["app"],
                    "wires": [],
                    "deployment": {
                        "infrastructure": {"host": {}},
                        "placements": [
                            {"component": "app", "target": "host"},
                            {"component": "app", "target": "host"},
                        ],
                    },
                }],
            }
        )
        self.assertTrue(any(finding.rule == "deployment-duplicate-placement" for finding in findings))

    def test_mixed_batch_keeps_each_file_result_in_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            valid = Path(directory) / "valid.yaml"
            invalid = Path(directory) / "invalid.yaml"
            valid.write_text((ROOT / "archnime-dsl" / "assets" / "examples" / "one-shot-checkout.yaml").read_text(encoding="utf-8"), encoding="utf-8")
            invalid.write_text("dsl: transition-diagram/1.0\nmeta: [broken\n", encoding="utf-8")
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                result = MODULE.main(["--format", "json", str(valid), str(invalid)])
            self.assertEqual(result, 1)
            parsed = json.loads(output.getvalue())
            self.assertEqual([item["file"] for item in parsed], [str(valid), str(invalid)])
            self.assertEqual(parsed[0]["findings"], [])
            self.assertEqual(parsed[1]["findings"][0]["rule"], "yaml-parse-error")

    def test_missing_schema_and_input_are_distinct_tooling_results(self) -> None:
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            result = MODULE.main(["--format", "json", "--schema", "/does/not/exist/schema.yaml", "/does/not/exist/input.yaml"])
        self.assertEqual(result, 2)
        parsed = json.loads(output.getvalue())
        self.assertIn("tooling_error", parsed)


    def test_every_rule_has_a_negative_fixture_and_both_validators_agree(self) -> None:
        import re
        scripts = ROOT / "archnime-dsl" / "scripts"
        call = re.compile(r"[Ff]inding[(]")
        token = re.compile(r"[\"']([a-z]+(?:-[a-z]+)+)[\"']")

        def rule_ids(path: Path) -> set[str]:
            text = path.read_text(encoding="utf-8")
            found: set[str] = set()
            for match in call.finditer(text):
                # The rule id is the first argument; calls may span lines.
                found.update(token.findall(text[match.end():match.end() + 140]))
            return found

        python_rules = rule_ids(scripts / "validate_transition_diagram.py") - {"lint-internal-error"}
        browser_rules = rule_ids(scripts / "validate_transition_diagram.js")
        self.assertEqual(sorted(python_rules ^ browser_rules), [], "Python and browser validators must define the same rule ids")
        expected = json.loads((ROOT / "archnime-dsl" / "assets" / "fixtures" / "invalid" / "expected-findings.json").read_text(encoding="utf-8"))
        covered = {rule for entry in expected.values() for rule in entry["rules"]}
        self.assertEqual(sorted(python_rules - covered), [], "every validator rule needs a negative fixture in expected-findings.json")

    def test_each_invalid_fixture_produces_exactly_its_expected_rules(self) -> None:
        """FEAT-014: expected-findings.json is checked against what the validator really reports.

        Without this, a fixture could stop failing (or fail for another reason) and the
        rule it stands for would be uncovered while every name-level check still passed.
        """
        invalid = ROOT / "archnime-dsl" / "assets" / "fixtures" / "invalid"
        expected = json.loads((invalid / "expected-findings.json").read_text(encoding="utf-8"))
        schema = MODULE.load_schema(MODULE.DEFAULT_SCHEMA_PATH)
        fixtures = sorted(path.stem for path in invalid.glob("*.yaml"))
        self.assertEqual(fixtures, sorted(expected), "every invalid fixture needs an expected-findings.json entry and vice versa")
        for name in fixtures:
            with self.subTest(fixture=name):
                try:
                    findings = MODULE.validate_document(MODULE.load_document(str(invalid / f"{name}.yaml")), schema)
                    actual_rules = {finding.rule for finding in findings}
                    actual_paths = {finding.path for finding in findings}
                except MODULE.DuplicateKeyError:
                    actual_rules, actual_paths = {"duplicate-yaml-key"}, {"$"}
                except MODULE.yaml.YAMLError:
                    actual_rules, actual_paths = {"yaml-parse-error"}, {"$"}
                self.assertEqual(sorted(actual_rules), sorted(expected[name]["rules"]))
                self.assertTrue(actual_paths <= set(expected[name]["paths"]), f"unexpected paths {sorted(actual_paths - set(expected[name]['paths']))}")


if __name__ == "__main__":
    unittest.main()
