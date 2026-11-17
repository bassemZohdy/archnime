"""Code-backed provenance: `source` on catalog entries, node overrides, wires and flow steps.

The unsafe-path rule runs in both validators (Python and the browser copy, compared through
Node when it is installed); check_sources.py adds the checks that read files.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))

import check_sources  # noqa: E402
import validate_transition_diagram as validator  # noqa: E402

SCHEMA = validator.load_schema(validator.DEFAULT_SCHEMA_PATH)
NODE = shutil.which("node")

UNSAFE = [
    "/etc/passwd",
    "C:/Windows/win.ini",
    "C:\\Users\\me\\notes.txt",
    "~/.bashrc",
    "../outside.py",
    "src/../../outside.py",
    ".git/config",
    "src/.git/HEAD",
    ".env",
    "config/.env.production",
    "deploy/server.pem",
    "keys/service.key",
    ".ssh/id_rsa",
    "home/id_ed25519.pub",
    ".npmrc",
    "aws/credentials",
    ".aws/config",
    "config/secrets.yaml",
    "https://example.com/api.py",
]
SAFE = [
    "src/orders/service.py",
    "./src/api.ts:42",
    "src/../src/api.ts#db.insert(order)",
    "docs/design.md#the worker takes each job",
    ".env.example",
    "src/keyboard.py",
]


def document(source, *, wire_source=None) -> dict:
    wire = {"from": "api", "to": "db", "label": "insert"}
    if wire_source is not None:
        wire["source"] = wire_source
    return {
        "dsl": "transition-diagram/1.0",
        "meta": {"title": "Sources"},
        "catalog": {
            "api": {"label": "API", "type": "service", "source": source},
            "db": {"label": "Orders", "type": "database"},
            # A catalog entry may itself be called "source": it is an id, not the field.
            "source": {"label": "Upstream", "type": "external"},
        },
        "system": {"title": "Sources", "nodes": ["api", "db", "source"], "wires": [wire]},
    }


def python_rules(doc) -> list[str]:
    return [f.rule for f in validator.validate_document(doc, SCHEMA)]


def browser_rules(docs: list) -> list[list[str]]:
    script = textwrap.dedent("""
        const fs = require("fs"), vm = require("vm");
        const [validatorPath, docsPath] = process.argv.slice(2);
        const context = { console }; context.globalThis = context;
        vm.runInNewContext(fs.readFileSync(validatorPath, "utf8"), context);
        const docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
        process.stdout.write(JSON.stringify(docs.map(doc => context.TransitionDiagramValidator.validateDocument(doc).map(f => f.rule))));
    """)
    with tempfile.TemporaryDirectory() as folder:
        docs_path, script_path = Path(folder) / "docs.json", Path(folder) / "run.cjs"
        docs_path.write_text(json.dumps(docs), encoding="utf-8")
        script_path.write_text(script, encoding="utf-8")
        output = subprocess.run([NODE, str(script_path), str(SCRIPTS / "validate_transition_diagram.js"), str(docs_path)],
                                check=True, capture_output=True, text=True).stdout
    return json.loads(output)


class SourcePathRule(unittest.TestCase):
    def test_safe_sources_are_clean(self) -> None:
        for source in SAFE:
            with self.subTest(source=source):
                self.assertEqual(python_rules(document(source)), [])

    def test_mapping_source_is_accepted(self) -> None:
        doc = document({"path": "src/api.py", "line": 3, "quote": "db.insert(order)"}, wire_source="src/api.py:3#db.insert(order)")
        self.assertEqual(python_rules(doc), [])

    def test_unsafe_sources_are_rejected(self) -> None:
        for source in UNSAFE:
            with self.subTest(source=source):
                self.assertIn("source-path-unsafe", python_rules(document(source)))

    def test_unsafe_wire_source_is_rejected(self) -> None:
        self.assertIn("source-path-unsafe", python_rules(document("src/api.py", wire_source="../secrets/x.py#key")))

    def test_malformed_sources_fail_the_schema(self) -> None:
        for source in ["", "#only words", "src/api.py#", {"line": 3}, {"path": "a.py", "line": 0}, {"path": "a.py", "extra": 1}, 42]:
            with self.subTest(source=source):
                self.assertIn("schema", python_rules(document(source)))

    def test_flow_steps_and_overrides_carry_sources(self) -> None:
        doc = {
            "dsl": "transition-diagram/1.0",
            "meta": {"title": "Flow"},
            "catalog": {"web": {"label": "Web", "type": "actor"}, "api": {"label": "API", "type": "service"}},
            "flow": {
                "title": "Flow",
                "nodes": ["web", {"id": "api", "source": ".env"}],
                "wires": ["web => api: POST /orders"],
                "steps": [{"edge": "web => api", "source": "src/routes.py:9#@app.post"}],
            },
        }
        findings = validator.validate_document(doc, SCHEMA)
        self.assertEqual([(f.rule, f.path) for f in findings], [("source-path-unsafe", "$.flow.nodes[1].source")])

    @unittest.skipUnless(NODE, "node is not installed")
    def test_browser_validator_agrees(self) -> None:
        docs = [document(source) for source in SAFE + UNSAFE] + [document(source) for source in ["", "#only words", {"line": 3}, 42]]
        expected = [sorted(set(python_rules(doc))) for doc in docs]
        actual = [sorted(set(rules)) for rules in browser_rules(docs)]
        self.assertEqual(actual, expected)


FLOW_WITH_SOURCES = {
    "dsl": "transition-diagram/1.0",
    "meta": {"title": "Sources in the model"},
    "catalog": {
        "web": {"label": "Web", "type": "actor"},
        "api": {"label": "API", "type": "service", "source": "src/api.py"},
    },
    "flow": {
        "title": "Flow",
        "nodes": ["web", {"id": "api", "detail": "handles orders", "source": {"path": "src/api.py", "line": 3}}],
        "wires": [{"from": "web", "to": "api", "label": "POST /orders", "flow": True, "source": "src/routes.py:9#@app.post"}],
        "steps": [{"edge": "web => api", "source": "src/routes.py:9"}],
    },
}


class SourcesReachTheModel(unittest.TestCase):
    """The renderer model keeps every source, and the browser translator writes the same model."""

    def test_python_translator_keeps_sources(self) -> None:
        import translate_transition_diagram as translator
        text = json.dumps(translator.translate_document(json.loads(json.dumps(FLOW_WITH_SOURCES))))
        for expected in ('"source": "src/api.py"', '"path": "src/api.py"', '"source": "src/routes.py:9#@app.post"', '"source": "src/routes.py:9"'):
            self.assertIn(expected, text)

    @unittest.skipUnless(NODE, "node is not installed")
    def test_browser_translator_agrees(self) -> None:
        import translate_transition_diagram as translator
        expected = translator.translate_document(json.loads(json.dumps(FLOW_WITH_SOURCES)))
        script = textwrap.dedent("""
            const fs = require("fs"), vm = require("vm");
            const [validatorPath, translatorPath, docPath] = process.argv.slice(2);
            const context = { console }; context.globalThis = context;
            vm.runInNewContext(fs.readFileSync(validatorPath, "utf8"), context);
            vm.runInNewContext(fs.readFileSync(translatorPath, "utf8"), context);
            const doc = JSON.parse(fs.readFileSync(docPath, "utf8"));
            process.stdout.write(JSON.stringify(context.TransitionDiagramTranslator.translateDocument(doc)));
        """)
        with tempfile.TemporaryDirectory() as folder:
            doc_path, script_path = Path(folder) / "doc.json", Path(folder) / "run.cjs"
            doc_path.write_text(json.dumps(FLOW_WITH_SOURCES), encoding="utf-8")
            script_path.write_text(script, encoding="utf-8")
            output = subprocess.run([NODE, str(script_path), str(SCRIPTS / "validate_transition_diagram.js"), str(SCRIPTS / "translate_transition_diagram.js"), str(doc_path)],
                                    check=True, capture_output=True, text=True).stdout
        self.assertEqual(json.loads(output), expected)


class CheckSourcesCli(unittest.TestCase):
    def setUp(self) -> None:
        self.folder = Path(tempfile.mkdtemp())
        (self.folder / "src").mkdir()
        (self.folder / "src" / "api.py").write_text("def create(order):\n    db.insert(order)\n    return order\n", encoding="utf-8")
        self.addCleanup(shutil.rmtree, self.folder, True)

    def run_check(self, doc: dict) -> tuple[int, list[dict]]:
        spec = self.folder / "diagram.yaml"
        spec.write_text(json.dumps(doc), encoding="utf-8")  # JSON is YAML
        from io import StringIO
        from contextlib import redirect_stdout
        out = StringIO()
        with redirect_stdout(out):
            code = check_sources.main([str(spec), "--root", str(self.folder), "--format", "json"])
        return code, json.loads(out.getvalue())[0]["findings"]

    def test_sources_that_hold_pass(self) -> None:
        # Words are matched with whitespace runs (indentation, line breaks) treated alike.
        code, findings = self.run_check(document("src/api.py", wire_source={"path": "src/api.py", "line": 2, "quote": "db.insert(order)   return order"}))
        self.assertEqual((code, findings), (0, []))
        code, findings = self.run_check(document("src/api.py:1#def create(order):"))
        self.assertEqual((code, findings), (0, []))

    def test_missing_file(self) -> None:
        code, findings = self.run_check(document("src/gone.py"))
        self.assertEqual(code, 1)
        self.assertEqual([(f["rule"], f["path"]) for f in findings], [("source-missing", "$.catalog.api.source")])

    def test_vanished_words(self) -> None:
        code, findings = self.run_check(document("src/api.py", wire_source="src/api.py#db.delete(order)"))
        self.assertEqual(code, 1)
        self.assertEqual([(f["rule"], f["path"]) for f in findings], [("source-quote-missing", "$.system.wires[0].source")])

    def test_line_past_the_end(self) -> None:
        code, findings = self.run_check(document({"path": "src/api.py", "line": 40}))
        self.assertEqual(code, 1)
        self.assertEqual([f["rule"] for f in findings], ["source-line-out-of-range"])

    def test_unsafe_path_is_not_read(self) -> None:
        (self.folder / ".env").write_text("TOKEN=hunter2\n", encoding="utf-8")
        code, findings = self.run_check(document(".env#TOKEN"))
        self.assertEqual(code, 1)
        self.assertEqual([f["rule"] for f in findings], ["source-path-unsafe"])
        self.assertNotIn("hunter2", json.dumps(findings))

    def test_link_escaping_the_root(self) -> None:
        outside = Path(tempfile.mkdtemp())
        self.addCleanup(shutil.rmtree, outside, True)
        (outside / "elsewhere.py").write_text("x = 1\n", encoding="utf-8")
        link = self.folder / "linked"
        try:
            os.symlink(outside, link, target_is_directory=True)
        except (OSError, NotImplementedError) as error:
            # Windows without the symlink privilege: a directory junction escapes the same way.
            made = sys.platform == "win32" and subprocess.run(["cmd", "/c", "mklink", "/J", str(link), str(outside)], capture_output=True).returncode == 0
            if not made:
                self.skipTest(f"cannot create a directory link here: {error}")
        code, findings = self.run_check(document("linked/elsewhere.py"))
        self.assertEqual(code, 1)
        self.assertEqual([f["rule"] for f in findings], ["source-path-unsafe"])


if __name__ == "__main__":
    unittest.main()
