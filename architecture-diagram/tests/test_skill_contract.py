#!/usr/bin/env python3
"""FEAT-021.2: the aggregator's SKILL.md routes every state the scanner can emit, once.

The scanner's STATES table is the source of truth for what can be reported; SKILL.md's routing
table is what an agent reads. If they drift, an agent is told to do something the scanner never
says, or is left without a rule for a state it is given.
"""

from __future__ import annotations

import re
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SKILL_DIR = ROOT / "architecture-diagram"
SKILL = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8") if (SKILL_DIR / "SKILL.md").is_file() else ""
sys.path.insert(0, str(SKILL_DIR / "scripts"))
import workspace_state  # noqa: E402

ROW = re.compile(r"^\| `([a-z-]+)` \| `(architecture-diagram-[a-z]+)` \|", re.MULTILINE)


class SkillContractTests(unittest.TestCase):
    def test_frontmatter_names_the_skill_and_its_licence(self) -> None:
        self.assertTrue(SKILL.startswith("---\n"), "SKILL.md is missing")
        frontmatter = SKILL.split("---", 2)[1]
        self.assertIn("name: architecture-diagram\n", frontmatter)
        self.assertIn("license: Apache-2.0", frontmatter)
        self.assertRegex(frontmatter, r"description: .{80,}")

    def test_every_scanner_state_is_routed_exactly_once_to_its_owner(self) -> None:
        rows = ROW.findall(SKILL)
        states = [state for state, _skill in rows]
        self.assertEqual(sorted(states), sorted(workspace_state.STATES), "SKILL.md's routing table and the scanner's STATES differ")
        self.assertEqual(len(states), len(set(states)), "a state is routed twice")
        for state, skill in rows:
            self.assertEqual(skill, workspace_state.STATES[state]["skill"], f"{state} is routed to {skill}, the scanner says {workspace_state.STATES[state]['skill']}")

    def test_the_skill_defers_to_all_four_domain_skills_and_runs_the_scanner(self) -> None:
        for name in workspace_state.SKILLS:
            self.assertIn(f"`{name}`", SKILL, f"{name} is not mentioned")
        self.assertIn("scripts/workspace_state.py", SKILL)
        self.assertRegex(SKILL, r"(?i)re-?run the scanner|scan again")

    def test_every_relative_link_resolves(self) -> None:
        for link in re.findall(r"\]\(([^)#]+)(?:#[^)]*)?\)", SKILL):
            if "://" in link:
                continue
            self.assertTrue((SKILL_DIR / link).resolve().exists(), f"broken link {link}")

    def test_the_state_machine_reference_lists_every_state(self) -> None:
        reference = (SKILL_DIR / "references" / "state-machine.md").read_text(encoding="utf-8") if (SKILL_DIR / "references" / "state-machine.md").is_file() else ""
        for state in workspace_state.STATES:
            self.assertIn(f"`{state}`", reference, f"{state} is missing from references/state-machine.md")

    def test_the_agent_metadata_follows_the_other_skills(self) -> None:
        metadata = (SKILL_DIR / "agents" / "openai.yaml").read_text(encoding="utf-8") if (SKILL_DIR / "agents" / "openai.yaml").is_file() else ""
        for key in ("interface:", "display_name:", "short_description:", "default_prompt:"):
            self.assertIn(key, metadata)
        self.assertIn("$architecture-diagram", metadata)


if __name__ == "__main__":
    unittest.main()
