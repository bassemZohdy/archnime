"""FEAT-019.3/.4: refused replies, parts run by someone else, and the AI node types.

A refused step is a reply: it travels back along the wire of an earlier call, like `return`, and
the sequence export draws it with a cross. `variant: external` marks a part someone else runs
whatever its type. `llm`, `vector-store` and `tool` are built-in types with their own icons.
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

EXAMPLE = SKILL / "assets" / "examples" / "agent-refusal-flow.yaml"
LIBRARY = SKILL.parent / "archnime-renderer" / "assets" / "architecture-library.js"
TEMPLATE = SKILL.parent / "archnime-renderer" / "assets" / "template.html"


def load() -> dict:
    return yaml.safe_load(EXAMPLE.read_text(encoding="utf-8"))


def rules(document: dict) -> list[tuple[str, str]]:
    findings = validator.validate_document(document, validator.load_schema(validator.DEFAULT_SCHEMA_PATH))
    return [(finding.rule, finding.path) for finding in findings]


class AgentVocabulary(unittest.TestCase):
    def test_the_example_is_clean(self) -> None:
        self.assertEqual(rules(load()), [])

    def test_a_refused_reply_binds_to_the_forward_wire(self) -> None:
        model = translator.translate_document(load())
        last = model["flow"]["steps"][-1]["edges"][0]
        self.assertEqual((last["kind"], last["from"], last["to"]), ("refused", "guard", "agent"))
        self.assertEqual((last["wireFrom"], last["wireTo"]), ("agent", "guard"))

    def test_a_refused_reply_needs_an_earlier_call(self) -> None:
        document = load()
        steps = document["flow"]["steps"]
        document["flow"]["steps"] = [step for step in steps if step.get("edge") != "agent -> guard"]
        found = rules(document)
        self.assertIn("flow-return-no-forward", [rule for rule, _ in found])

    def test_the_sequence_export_draws_a_refusal_with_a_cross(self) -> None:
        text = translator.sequence_mermaid(translator.translate_document(load()))
        self.assertIn("guard--xagent: over limit", text)
        self.assertIn("model-->>agent", text)

    def test_variant_external_is_kept_and_only_external_is_allowed(self) -> None:
        model = translator.translate_document(load())
        self.assertEqual(model["catalog"]["model"]["variant"], "external")
        document = load()
        document["catalog"]["model"]["variant"] = "hosted"
        self.assertIn("schema", [rule for rule, _ in rules(document)])

    def test_variant_can_be_set_per_view_on_a_node_override(self) -> None:
        document = load()
        document["flow"]["nodes"] = [
            {"id": "index", "variant": "external"} if node == "index" else node for node in document["flow"]["nodes"]
        ]
        self.assertEqual(rules(document), [])

    def test_the_ai_types_are_built_in_with_icons(self) -> None:
        self.assertTrue({"llm", "vector-store", "tool"} <= validator.BUILTIN_NODE_TYPES)
        self.assertEqual(translator.SHAPE_BY_TYPE["vector-store"], "db")
        library = LIBRARY.read_text(encoding="utf-8")
        for icon in ("llm: { viewBox", '"vector-store": { viewBox', "tool: { viewBox"):
            self.assertIn(icon, library)
        document = copy.deepcopy(load())
        document["catalog"]["model"]["type"] = "large-model"
        self.assertNotEqual(rules(document), [])

    def test_the_renderer_styles_both(self) -> None:
        template = TEMPLATE.read_text(encoding="utf-8")
        for needle in (".node.variant-external .shape", ".wire.flow-refused", 'attr("id", "refused-cross")', 'd.variant === "external"'):
            self.assertIn(needle, template)


if __name__ == "__main__":
    unittest.main()
