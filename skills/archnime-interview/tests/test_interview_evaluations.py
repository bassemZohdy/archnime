from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
VALIDATOR_PATH = ROOT / "archnime-dsl" / "scripts" / "validate_transition_diagram.py"


def load_validator():
    spec = importlib.util.spec_from_file_location("interview_eval_validator", VALIDATOR_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


VALIDATOR = load_validator()


class InterviewContractEvaluations(unittest.TestCase):
    """Small contract cases for the interview's fact-ledger and handoff policy."""

    CASES = {
        "complete-flow": {
            "mode": "flow",
            "facts": {"topology": True, "ordered_steps": True, "returns": True, "authorization": True},
            "expected_questions": (),
            "source": ROOT / "archnime-interview" / ".." / "archnime-validation" / "examples" / "checkout-flow.yaml",
        },
        "incomplete-transition": {
            "mode": "transition",
            "facts": {"current": True, "target": False, "identity_mapping": False},
            "expected_questions": ("target", "identity mapping"),
        },
        "contradictory-ownership": {
            "mode": "system",
            "facts": {"component_owner": "team-a", "boundary_owner": "team-b", "ownership_agreement": False},
            "expected_questions": ("ownership",),
        },
        "deployment-with-placement": {
            "mode": "deployment",
            "facts": {"logical_components": True, "targets": True, "placements": True, "replicas": True},
            "expected_questions": (),
            "source": ROOT / "archnime-validation" / "examples" / "commerce-views.yaml",
        },
        "comparison-with-evidence": {
            "mode": "comparison",
            "facts": {"options": 2, "criteria": True, "weights": True, "ratings": True, "preferred_option": None},
            "expected_questions": (),
            "source": ROOT / "archnime-validation" / "examples" / "comparison-views.yaml",
        },
    }

    def test_complete_and_authorized_cases_do_not_require_redundant_confirmation(self) -> None:
        for name in ("complete-flow", "deployment-with-placement", "comparison-with-evidence"):
            case = self.CASES[name]
            with self.subTest(case=name):
                self.assertFalse(case["expected_questions"])
                document = VALIDATOR.load_document(case["source"].resolve())
                findings = VALIDATOR.validate_document(document, VALIDATOR.load_schema(VALIDATOR.DEFAULT_SCHEMA_PATH))
                self.assertFalse(findings, [(finding.rule, finding.path) for finding in findings])

    def test_consequential_gaps_remain_explicit_questions(self) -> None:
        for name in ("incomplete-transition", "contradictory-ownership"):
            case = self.CASES[name]
            with self.subTest(case=name):
                self.assertTrue(case["expected_questions"])
                self.assertFalse(case["facts"].get("target", True) and case["facts"].get("identity_mapping", True) if name == "incomplete-transition" else case["facts"].get("ownership_agreement"))

    def test_evaluation_cases_do_not_invent_comparison_recommendations(self) -> None:
        comparison = self.CASES["comparison-with-evidence"]
        self.assertIsNone(comparison["facts"]["preferred_option"])
        self.assertNotIn("recommended", comparison["facts"])


if __name__ == "__main__":
    unittest.main()
