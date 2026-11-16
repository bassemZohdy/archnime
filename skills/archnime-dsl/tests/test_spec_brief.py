"""FEAT-018.3: the spec brief is printed from this copy of the skill and stays a valid spec."""
from __future__ import annotations

import io
import sys
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

import yaml

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import spec_brief  # noqa: E402
import validate_transition_diagram as validator  # noqa: E402


def run(*args: str) -> tuple[int, str, str]:
    out, err = io.StringIO(), io.StringIO()
    with redirect_stdout(out), redirect_stderr(err):
        code = spec_brief.main(list(args))
    return code, out.getvalue(), err.getvalue()


class SpecBrief(unittest.TestCase):
    def test_the_brief_example_validates_clean_even_strict(self) -> None:
        doc = yaml.safe_load(spec_brief.BRIEF_EXAMPLE)
        findings = validator.validate_document(doc, validator.load_schema(validator.DEFAULT_SCHEMA_PATH))
        self.assertEqual([(f.rule, f.path, f.severity) for f in findings], [])

    def test_the_brief_example_is_an_extraction(self) -> None:
        doc = yaml.safe_load(spec_brief.BRIEF_EXAMPLE)
        self.assertEqual(doc["meta"]["evidence"], "code")
        self.assertTrue(3 <= len(doc["meta"]["reader"]["questions"]) <= 5)
        self.assertTrue(all("source" in wire for wire in doc["flow"]["wires"]))

    def test_the_brief_prints_the_example_and_a_line_per_section(self) -> None:
        code, out, _ = run()
        self.assertEqual(code, 0)
        self.assertIn(spec_brief.BRIEF_EXAMPLE.strip(), out)
        names = [name for name, _, _ in spec_brief.sections()]
        self.assertGreaterEqual(len(names), 12)
        for name in names:
            self.assertRegex(out, rf"(?m)^{name}\s+\S")
        for required in ("views", "flow", "source", "catalog", "wires"):
            self.assertIn(required, names)

    def test_each_section_prints_alone(self) -> None:
        for name, heading, _ in spec_brief.sections():
            with self.subTest(section=name):
                code, out, _ = run("--section", name)
                self.assertEqual(code, 0)
                self.assertTrue(out.startswith(f"## {heading}"))

    def test_an_unknown_section_is_a_usage_error_naming_the_sections(self) -> None:
        code, out, err = run("--section", "nope")
        self.assertEqual((code, out), (2, ""))
        self.assertIn("flow", err)


if __name__ == "__main__":
    unittest.main()
