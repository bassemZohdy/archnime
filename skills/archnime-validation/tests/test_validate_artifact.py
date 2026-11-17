from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from unittest import mock
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "archnime-validation" / "scripts"))
import validate_artifact  # noqa: E402


class ValidateArtifactTests(unittest.TestCase):
    def test_valid_yaml_is_pass(self) -> None:
        report = validate_artifact.validate(ROOT / "archnime-validation" / "examples" / "checkout-flow.yaml")
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["kind"], "architecture-yaml")

    def test_invalid_portable_model_is_fail_with_structural_reason(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text(json.dumps({"meta": {}, "canvas": {}, "catalog": {"a": {}}, "stages": [{"nodes": ["a"], "wires": [{"from": "a", "to": "missing"}]}]}), encoding="utf-8")
            report = validate_artifact.validate(path)
        self.assertEqual(report["status"], "FAIL")
        self.assertIn("not present in that stage", report["checks"][0]["message"])

    def test_generated_html_embedded_model_is_checked_without_becoming_fixture(self) -> None:
        model = json.loads((ROOT / "archnime-renderer" / "assets" / "examples" / "portable-transition-model.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "diagram.html"
            path.write_text(f'<script type="application/json" id="diagram-model">{json.dumps(model)}</script>', encoding="utf-8")
            report = validate_artifact.validate(path)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["kind"], "rendered-html")
        self.assertTrue(report["limitations"])

    def run_main(self, *arguments: str) -> tuple[int, str]:
        buffer = io.StringIO()
        with contextlib.redirect_stdout(buffer):
            code = validate_artifact.main(list(arguments))
        return code, buffer.getvalue()

    def test_text_output_lists_each_finding_with_its_rule_and_path(self) -> None:
        """FIX-011: a failing YAML names what is wrong, not only that something is."""
        fixture = ROOT / "archnime-dsl" / "assets" / "fixtures" / "invalid" / "duplicate-id.yaml"
        code, output = self.run_main(str(fixture), "--format", "text")
        self.assertEqual(code, 1)
        self.assertIn("FAIL", output)
        self.assertIn("duplicate-id", output)
        self.assertIn("$.catalog.shared", output)

    def test_text_output_shows_the_message_of_a_structural_failure(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "bad.json"
            path.write_text(json.dumps({"meta": {}, "canvas": {}, "catalog": {"a": {}}, "stages": [{"nodes": ["a"], "wires": [{"from": "a", "to": "missing"}]}]}), encoding="utf-8")
            code, output = self.run_main(str(path), "--format", "text")
        self.assertEqual(code, 1)
        self.assertIn("not present in that stage", output)

    def test_exit_codes_distinguish_pass_fail_skip_and_unsupported(self) -> None:
        example = str(ROOT / "archnime-validation" / "examples" / "checkout-flow.yaml")
        self.assertEqual(self.run_main(example, "--format", "text")[0], 0)
        with tempfile.TemporaryDirectory() as directory:
            notes = Path(directory) / "notes.txt"
            notes.write_text("not a diagram", encoding="utf-8")
            self.assertEqual(self.run_main(str(notes), "--format", "text")[0], 3)
        with mock.patch.object(validate_artifact, "_load_module", side_effect=ModuleNotFoundError("No module named 'yaml'", name="yaml")):
            code, output = self.run_main(example, "--format", "text")
        self.assertEqual(code, 2)
        self.assertIn("SKIP", output)
        self.assertIn("LIMITATION", output)

    def test_missing_python_dependency_is_a_skip_not_a_crash(self) -> None:
        """The DSL validator exits the process when pyyaml or jsonschema is missing; that is a SKIP."""
        example = str(ROOT / "archnime-validation" / "examples" / "checkout-flow.yaml")
        with mock.patch.object(validate_artifact, "_load_module", side_effect=SystemExit(2)):
            code, output = self.run_main(example, "--format", "json")
        self.assertEqual(code, 2)
        self.assertEqual(json.loads(output)["status"], "SKIP")

    def test_unknown_input_is_unsupported_not_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notes.txt"
            path.write_text("not a diagram", encoding="utf-8")
            report = validate_artifact.validate(path)
        self.assertEqual(report["status"], "UNSUPPORTED")


if __name__ == "__main__":
    unittest.main()
