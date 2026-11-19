"""FEAT-024: alt, opt and loop fragments, and phases, in flows.

A fragment step holds branches, each with its guard (`when`) and its own steps. The translator
flattens them into the played order and tags each step with its frames, so the presenter plays
every branch in turn, the sequence SVG draws the frames, and the Mermaid sequence writes
`alt`/`else`/`opt`/`loop` blocks. Each branch of an `alt` starts from the calls made before it.
"""
from __future__ import annotations

import copy
import sys
import unittest
from pathlib import Path

import yaml

SKILL = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(SKILL / "scripts"))

import translate_transition_diagram as translator  # noqa: E402
import validate_transition_diagram as validator  # noqa: E402

EXAMPLE = SKILL / "assets" / "examples" / "sign-in-sequence.yaml"


def load() -> dict:
    return yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))


def rules(document: dict) -> list[tuple[str, str]]:
    findings = validator.validate_document(document, validator.load_schema(validator.DEFAULT_SCHEMA_PATH))
    return [(finding.rule, finding.path) for finding in findings]


class FlowFragments(unittest.TestCase):
    def test_the_example_is_clean(self) -> None:
        self.assertEqual(rules(load()), [])

    def test_fragments_flatten_into_the_played_order(self) -> None:
        steps = translator.translate_document(load())["flow"]["steps"]
        self.assertEqual([step["title"] for step in steps], ["Post the form", "Find the user", "User row", "Send", "Code accepted", "Session", "Refused", "Audit"])
        self.assertEqual([step["id"] for step in steps], [f"step-{n}" for n in range(1, 9)])
        send, accepted, session, refused = steps[3], steps[4], steps[5], steps[6]
        self.assertEqual([(frame["kind"], frame["when"]) for frame in send["fragments"]], [("opt", "account has MFA"), ("loop", "up to 3 tries")])
        self.assertEqual([(frame["kind"], frame["when"]) for frame in accepted["fragments"]], [("opt", "account has MFA")])
        self.assertEqual(send["fragments"][0]["id"], accepted["fragments"][0]["id"])
        self.assertEqual((session["fragments"][0]["branch"], refused["fragments"][0]["branch"]), (0, 1))
        self.assertEqual(session["fragments"][0]["id"], refused["fragments"][0]["id"])
        self.assertNotIn("fragments", steps[0])

    def test_a_phase_lasts_until_the_next(self) -> None:
        steps = translator.translate_document(load())["flow"]["steps"]
        self.assertEqual([step.get("phase") for step in steps], ["Sign in"] + ["Check the password"] * 6 + ["Record it"])

    def test_a_reply_in_one_branch_cannot_answer_another_branchs_call(self) -> None:
        document = load()
        alt = document["flow"]["steps"][4]["alt"]
        alt[0]["steps"].insert(0, {"title": "Ask again", "edge": "api => users"})
        alt[1]["steps"].insert(0, {"title": "Late row", "edge": "users => api", "kind": "return"})
        self.assertEqual(rules(document), [])  # the call before the alt is still waiting in both branches
        document = load()
        document["flow"]["steps"] = [step for step in document["flow"]["steps"] if step.get("title") != "Second factor"]
        alt = document["flow"]["steps"][3]["alt"]
        alt[0]["steps"].insert(0, {"title": "Send a code", "edge": "api => mfa"})
        alt[1]["steps"].insert(0, {"title": "Code back", "edge": "mfa => api", "kind": "return"})
        self.assertEqual(rules(document), [("flow-return-no-forward", "$.flow.steps[3].alt[1].steps[0].edge")])

    def test_a_call_made_in_a_fragment_can_be_answered_after_it(self) -> None:
        document = load()
        opt = document["flow"]["steps"][3]["opt"]
        reply = opt["steps"].pop()
        document["flow"]["steps"].insert(4, reply)
        self.assertEqual(rules(document), [])

    def test_guards_and_phases_have_their_place(self) -> None:
        document = load()
        document["flow"]["steps"][4]["alt"].reverse()
        self.assertIn(("flow-guard-else", "$.flow.steps[4].alt[0].when"), rules(document))
        document = load()
        document["flow"]["steps"][3]["opt"]["steps"][1]["phase"] = "Inside"
        self.assertIn(("flow-phase-nested", "$.flow.steps[3].opt.steps[1].phase"), rules(document))
        document = load()
        document["flow"]["steps"][4]["alt"] = document["flow"]["steps"][4]["alt"][:1]
        self.assertIn("schema", [rule for rule, _ in rules(document)])

    def test_the_mermaid_sequence_writes_the_frames(self) -> None:
        text = translator.sequence_mermaid(translator.translate_document(load()))
        self.assertTrue(text.startswith("sequenceDiagram\n    autonumber\n"))
        self.assertIn(
            "    opt account has MFA\n"
            "        loop up to 3 tries\n"
            "            api->>mfa: send code\n"
            "        end\n"
            "        mfa-->>api: accepted\n"
            "    end\n"
            "    alt password matches\n"
            "        api-->>browser: 200 · session\n"
            "    else\n"
            "        api--xbrowser: 401\n"
            "    end\n",
            text,
        )
        self.assertIn("    Note over browser,audit: Check the password\n", text)
        self.assertEqual(text.count(" end\n"), text.count("    opt ") + text.count("    loop ") + text.count("    alt "))

    def test_a_flow_without_fragments_is_unchanged(self) -> None:
        document = yaml.safe_load((SKILL / "assets" / "examples" / "checkout-flow.yaml").read_text(encoding="utf-8"))
        steps = translator.translate_document(copy.deepcopy(document))["flow"]["steps"]
        self.assertFalse(any("fragments" in step or "phase" in step for step in steps))


if __name__ == "__main__":
    unittest.main()
