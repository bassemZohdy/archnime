"""FEAT-018: the agent-first extraction workflow is written down, wired to real tools, and installable.

The workflow is prose an agent follows, so this guards what the prose promises: every step is
there, every rule it names is one the validator emits, every command it names exists, the spec
brief it points to prints a clean spec, and the README documents the one-command install.
"""
from __future__ import annotations

import re
import subprocess
import sys
import unittest
from pathlib import Path

import yaml

SKILLS = Path(__file__).resolve().parents[2]
REPO = SKILLS.parent
INTERVIEW = SKILLS / "archnime-interview"
DSL = SKILLS / "archnime-dsl"
EXTRACTION = (INTERVIEW / "references" / "extraction.md").read_text(encoding="utf-8")
SKILL = (INTERVIEW / "SKILL.md").read_text(encoding="utf-8")
README = (REPO / "README.md").read_text(encoding="utf-8")
VALIDATOR = (DSL / "scripts" / "validate_transition_diagram.py").read_text(encoding="utf-8")
BROWSER_VALIDATOR = (DSL / "scripts" / "validate_transition_diagram.js").read_text(encoding="utf-8")

STEPS = ["Reader contract", "Facts, each with its evidence", "The format, from the spec brief",
         "Write, validate, check against the code", "Critique against the contract", "Report"]


class ExtractionContract(unittest.TestCase):
    def test_every_step_is_a_section_in_order(self) -> None:
        headings = re.findall(r"^## \d\. (.+)$", EXTRACTION, flags=re.MULTILINE)
        self.assertEqual(headings, STEPS)

    def test_the_reader_contract_has_its_four_fields(self) -> None:
        for field in ("`audience`", "`questions`", "`idea`", "`omitted`", "3 to 5 questions"):
            self.assertIn(field, EXTRACTION)

    def test_drawing_is_evidence_only(self) -> None:
        prose = " ".join(EXTRACTION.split())  # sentences wrap across lines
        for rule in ("Draw a part only when a file backs it", "Draw a wire only where a line of code makes it",
                     "never into the drawing", "meta.evidence: code", "Never delete a `source`"):
            self.assertIn(rule, prose)

    def test_every_rule_it_names_is_emitted_by_both_validators(self) -> None:
        named = set(re.findall(r"`([a-z]+(?:-[a-z]+)+)`", EXTRACTION)) & {
            "reader-contract-incomplete", "evidence-source-missing", "density-budget", "source-path-unsafe"}
        self.assertEqual(named, {"reader-contract-incomplete", "evidence-source-missing", "density-budget"})
        for rule in named:
            with self.subTest(rule=rule):
                self.assertIn(f'"{rule}"', VALIDATOR)
                self.assertIn(f'"{rule}"', BROWSER_VALIDATOR)

    def test_every_command_it_names_exists(self) -> None:
        scripts = set(re.findall(r"archnime-dsl/scripts/([a-z_]+\.py)", EXTRACTION + SKILL))
        self.assertEqual(scripts, {"spec_brief.py", "validate_transition_diagram.py", "check_sources.py"})
        for script in scripts:
            self.assertTrue((DSL / "scripts" / script).is_file(), script)

    def test_the_density_budget_matches_the_validator(self) -> None:
        self.assertIn("About 12 nodes and 16 wires", EXTRACTION)
        self.assertIn('DENSITY_DEFAULT = {"nodes": 12, "wires": 16}', VALIDATOR)
        self.assertIn("DENSITY_DEFAULT = { nodes: 12, wires: 16 }", BROWSER_VALIDATOR)

    def test_the_spec_brief_prints_a_clean_extraction(self) -> None:
        output = subprocess.run([sys.executable, str(DSL / "scripts" / "spec_brief.py")], check=True, capture_output=True, text=True).stdout
        example = yaml.safe_load(output.split("# Other sections")[0])
        self.assertEqual(example["meta"]["evidence"], "code")
        sys.path.insert(0, str(DSL / "scripts"))
        import validate_transition_diagram as validator
        findings = validator.validate_document(example, validator.load_schema(validator.DEFAULT_SCHEMA_PATH))
        self.assertEqual([(f.rule, f.path) for f in findings], [])

    def test_the_skill_routes_code_requests_to_extraction(self) -> None:
        frontmatter = SKILL.split("---", 2)[1]
        self.assertIn("from the code or a named document", frontmatter)
        self.assertIn("references/extraction.md", SKILL)
        self.assertIn("## Drawing from code or a document", SKILL)

    def test_the_readme_documents_the_one_command_install(self) -> None:
        self.assertIn("npx --yes github:bassemZohdy/diagram-skills", README)
        for flag in ("--project", "--target agents", "--dest <folder>", "--dry-run"):
            self.assertIn(flag, README)
        self.assertTrue((REPO / "scripts" / "install.mjs").is_file())
        self.assertIn('"archnime": "scripts/install.mjs"', (REPO / "package.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
