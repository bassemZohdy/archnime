"""FEAT-018: the reader contract, evidence-only drawing and the density budget, in both validators."""
from __future__ import annotations

import copy
import glob
import json
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
SKILLS = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(SCRIPTS))

import validate_transition_diagram as validator  # noqa: E402

SCHEMA = validator.load_schema(validator.DEFAULT_SCHEMA_PATH)
NODE = shutil.which("node")
EXTRACTION_RULES = {"reader-contract-incomplete", "evidence-source-missing", "density-budget"}

BASE = {
    "dsl": "transition-diagram/1.0",
    "meta": {
        "title": "Checkout",
        "evidence": "code",
        "reader": {
            "audience": "engineers new to checkout",
            "questions": ["Where does an order enter?", "Who writes it?", "What is refused?"],
            "idea": "The gateway authenticates before anything is written.",
        },
    },
    "catalog": {
        "web": {"label": "Browser", "type": "actor"},
        "stripe": {"label": "Stripe", "type": "external"},
        "api": {"label": "API", "type": "service", "source": "src/api.py"},
    },
    "system": {
        "title": "Checkout",
        "nodes": ["web", "api", "stripe"],
        "wires": [
            {"from": "web", "to": "api", "label": "POST /orders", "source": "src/api.py:9#@app.post"},
            {"from": "api", "to": "stripe", "label": "charge", "source": "src/pay.py#stripe.charge("},
        ],
    },
}


def variant(**changes) -> dict:
    doc = copy.deepcopy(BASE)
    for dotted, value in changes.items():
        target, *path, last = ["doc", *dotted.split("__")]
        node = doc
        for key in path:
            node = node[key]
        if value is None:
            node.pop(last, None)
        else:
            node[last] = value
    return doc


def python_findings(doc) -> list[tuple[str, str, str]]:
    return sorted((f.rule, f.path, f.severity) for f in validator.validate_document(doc, SCHEMA))


def browser_findings(docs: list) -> list[list[tuple[str, str, str]]]:
    script = textwrap.dedent("""
        const fs = require("fs"), vm = require("vm");
        const [validatorPath, docsPath] = process.argv.slice(2);
        const context = { console }; context.globalThis = context;
        vm.runInNewContext(fs.readFileSync(validatorPath, "utf8"), context);
        const docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
        process.stdout.write(JSON.stringify(docs.map(doc => context.TransitionDiagramValidator.validateDocument(doc).map(f => [f.rule, f.path, f.severity]))));
    """)
    with tempfile.TemporaryDirectory() as folder:
        docs_path, script_path = Path(folder) / "docs.json", Path(folder) / "run.cjs"
        docs_path.write_text(json.dumps(docs), encoding="utf-8")
        script_path.write_text(script, encoding="utf-8")
        output = subprocess.run([NODE, str(script_path), str(SCRIPTS / "validate_transition_diagram.js"), str(docs_path)],
                                check=True, capture_output=True, text=True).stdout
    return [sorted(tuple(item) for item in findings) for findings in json.loads(output)]


def dense(nodes: int, wires: int = 0, density=None) -> dict:
    ids = [f"n{i}" for i in range(nodes)]
    doc = {
        "dsl": "transition-diagram/1.0",
        "meta": {"title": "Dense"},
        "catalog": {node: {"label": node, "type": "service"} for node in ids},
        "system": {"title": "Dense", "nodes": ids, "wires": [f"n0 -> {ids[(i % (nodes - 1)) + 1]}: w{i}" for i in range(wires)]},
    }
    if density:
        doc["meta"]["density"] = density
    return doc


CASES = {
    "complete": BASE,
    "two-questions": variant(meta__reader__questions=["Where?", "Who?"]),
    "six-questions": variant(meta__reader__questions=[f"Q{i}?" for i in range(6)]),
    "no-idea": variant(meta__reader__idea=None),
    "part-without-source": variant(catalog__api__source=None),
    "shorthand-wire": variant(system__wires=["web => api: POST /orders"]),
    "document-evidence": variant(meta__evidence="document", catalog__api__source=None),
    "interview-evidence": variant(meta__evidence="interview", catalog__api__source=None, system__wires=["web -> api"]),
    "thirteen-nodes": dense(13),
    "seventeen-wires": dense(4, 17),
    "raised-budget": dense(13, 17, {"nodes": 13, "wires": 17}),
    "steps-removal-is-not-drawn": {
        "dsl": "transition-diagram/1.0",
        "meta": {"title": "Steps", "evidence": "code"},
        "catalog": {"a": {"label": "A", "type": "service", "source": "a.py"}, "b": {"label": "B", "type": "service", "source": "b.py"}},
        "steps": {
            "base": {"id": "now", "title": "Now", "nodes": ["a", "b"], "wires": [{"from": "a", "to": "b", "source": "a.py#b.call("}]},
            "sequence": [{"id": "later", "title": "Later", "remove": {"wires": ["a -> b"]}}],
        },
    },
}


class ExtractionLint(unittest.TestCase):
    def rules(self, name: str) -> list[tuple[str, str, str]]:
        return [finding for finding in python_findings(CASES[name]) if finding[0] in EXTRACTION_RULES or finding[0] == "schema"]

    def test_a_complete_extraction_is_clean(self) -> None:
        self.assertEqual(python_findings(BASE), [])

    def test_reader_needs_three_to_five_questions_and_an_idea(self) -> None:
        self.assertEqual(self.rules("two-questions"), [("reader-contract-incomplete", "$.meta.reader.questions", "warning")])
        self.assertEqual(self.rules("six-questions"), [("reader-contract-incomplete", "$.meta.reader.questions", "warning")])
        self.assertEqual(self.rules("no-idea"), [("reader-contract-incomplete", "$.meta.reader.idea", "warning")])

    def test_code_evidence_needs_a_source_on_parts_and_wires(self) -> None:
        self.assertEqual(self.rules("part-without-source"), [("evidence-source-missing", "$.catalog.api", "warning")])
        self.assertEqual(self.rules("shorthand-wire"), [("evidence-source-missing", "$.system.wires[0]", "warning")])
        self.assertEqual(self.rules("document-evidence"), [("evidence-source-missing", "$.catalog.api", "warning")])

    def test_people_and_outside_systems_need_no_file(self) -> None:
        self.assertNotIn("$.catalog.web", [path for _, path, _ in self.rules("part-without-source")])
        self.assertNotIn("$.catalog.stripe", [path for _, path, _ in self.rules("part-without-source")])

    def test_interview_evidence_asks_for_no_sources(self) -> None:
        self.assertEqual(self.rules("interview-evidence"), [])

    def test_removed_wires_need_no_source(self) -> None:
        self.assertEqual(self.rules("steps-removal-is-not-drawn"), [])

    def test_density_budget(self) -> None:
        self.assertEqual(self.rules("thirteen-nodes"), [("density-budget", "$.system.nodes", "warning")])
        self.assertEqual(self.rules("seventeen-wires"), [("density-budget", "$.system.wires", "warning")])
        self.assertEqual(self.rules("raised-budget"), [])

    def test_meta_fields_are_typed(self) -> None:
        for change in ({"meta__evidence": "rumour"}, {"meta__density": {"nodes": 0}}, {"meta__reader__audience": None}, {"meta__reader__extra": 1}):
            with self.subTest(change=change):
                self.assertIn("schema", [rule for rule, _, _ in python_findings(variant(**change))])

    def test_every_shipped_example_stays_within_budget(self) -> None:
        examples = glob.glob(str(SKILLS / "*" / "assets" / "examples" / "*.yaml")) + glob.glob(str(SKILLS / "*" / "examples" / "*.yaml"))
        self.assertGreater(len(examples), 5)
        for path in examples:
            with self.subTest(example=Path(path).name):
                findings = validator.validate_document(validator.load_document(path), SCHEMA)
                self.assertEqual([f.rule for f in findings if f.rule in EXTRACTION_RULES], [])

    @unittest.skipUnless(NODE, "node is not installed")
    def test_browser_validator_agrees(self) -> None:
        names = sorted(CASES)
        docs = [CASES[name] for name in names] + [variant(meta__evidence="rumour"), variant(meta__density={"nodes": 0})]
        expected = [sorted({(rule, path, severity) for rule, path, severity in python_findings(doc) if rule != "schema"}) for doc in docs]
        actual = [sorted({finding for finding in findings if finding[0] != "schema"}) for findings in browser_findings(docs)]
        self.assertEqual(actual, expected)
        schema_python = [any(rule == "schema" for rule, _, _ in python_findings(doc)) for doc in docs]
        schema_browser = [any(finding[0] == "schema" for finding in findings) for findings in browser_findings(docs)]
        self.assertEqual(schema_browser, schema_python)


if __name__ == "__main__":
    unittest.main()
