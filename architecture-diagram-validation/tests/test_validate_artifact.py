from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "architecture-diagram-validation" / "scripts"))
import validate_artifact  # noqa: E402


class ValidateArtifactTests(unittest.TestCase):
    def test_valid_yaml_is_pass(self) -> None:
        report = validate_artifact.validate(ROOT / "architecture-diagram-validation" / "examples" / "checkout-flow.yaml")
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
        model = json.loads((ROOT / "architecture-diagram-renderer" / "assets" / "examples" / "portable-transition-model.json").read_text(encoding="utf-8"))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "diagram.html"
            path.write_text(f'<script type="application/json" id="diagram-model">{json.dumps(model)}</script>', encoding="utf-8")
            report = validate_artifact.validate(path)
        self.assertEqual(report["status"], "PASS")
        self.assertEqual(report["kind"], "rendered-html")
        self.assertTrue(report["limitations"])

    def test_unknown_input_is_unsupported_not_pass(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "notes.txt"
            path.write_text("not a diagram", encoding="utf-8")
            report = validate_artifact.validate(path)
        self.assertEqual(report["status"], "UNSUPPORTED")


if __name__ == "__main__":
    unittest.main()
