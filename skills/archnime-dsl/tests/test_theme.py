"""FEAT-025: meta.theme, the project's own light and dark colours, checked for contrast.

Run: python -m unittest discover -s skills/archnime-dsl/tests -p test_theme.py
"""
from __future__ import annotations

import copy
import json
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
TEMPLATE = Path(__file__).resolve().parents[2] / "archnime-renderer" / "assets" / "template.html"
sys.path.insert(0, str(SCRIPTS))

import validate_transition_diagram as validator  # noqa: E402

SCHEMA = validator.load_schema(validator.DEFAULT_SCHEMA_PATH)
NODE = shutil.which("node")

BASE = {
    "dsl": "transition-diagram/1.0",
    "meta": {"title": "Themed"},
    "catalog": {"api": {"label": "API", "type": "service"}, "db": {"label": "DB", "type": "database"}},
    "system": {"title": "Themed", "nodes": ["api", "db"], "wires": ["api -> db : reads"]},
}


def with_theme(theme) -> dict:
    doc = copy.deepcopy(BASE)
    doc["meta"]["theme"] = theme
    return doc


def python_findings(doc) -> list[tuple[str, str]]:
    return sorted((f.rule, f.path) for f in validator.validate_document(doc, SCHEMA))


def browser_run(expression: str, docs: list):
    script = textwrap.dedent("""
        const fs = require("fs"), vm = require("vm");
        const [validatorPath, docsPath] = process.argv.slice(2);
        const context = { console }; context.globalThis = context;
        vm.runInNewContext(fs.readFileSync(validatorPath, "utf8"), context);
        const V = context.TransitionDiagramValidator, docs = JSON.parse(fs.readFileSync(docsPath, "utf8"));
        process.stdout.write(JSON.stringify(EXPRESSION));
    """).replace("EXPRESSION", expression)
    with tempfile.TemporaryDirectory() as folder:
        docs_path, script_path = Path(folder) / "docs.json", Path(folder) / "run.cjs"
        docs_path.write_text(json.dumps(docs), encoding="utf-8")
        script_path.write_text(script, encoding="utf-8")
        output = subprocess.run([NODE, str(script_path), str(SCRIPTS / "validate_transition_diagram.js"), str(docs_path)],
                                check=True, capture_output=True, text=True).stdout
    return json.loads(output)


def browser_findings(docs: list) -> list[list[tuple[str, str]]]:
    raw = browser_run("docs.map(doc => V.validateDocument(doc).map(f => [f.rule, f.path]))", docs)
    return [sorted(tuple(item) for item in found) for found in raw]


def template_palettes() -> dict[str, dict[str, str]]:
    text = TEMPLATE.read_text(encoding="utf-8")
    start = text.index("<style>")
    style = text[start:text.index("</style>", start)]
    light_block = style[style.index(":root {"):style.index("@media (prefers-color-scheme: dark)")]
    dark_block = style[style.index("@media (prefers-color-scheme: dark)"):]
    dark_block = dark_block[:dark_block.index("}")]

    def parse(block: str) -> dict[str, str]:
        return dict(re.findall(r"--([a-z-]+):\s*(#[0-9a-fA-F]{3,6})\b", block))

    light = parse(light_block)
    return {"light": light, "dark": {**light, **parse(dark_block)}}


class ThemeDefaults(unittest.TestCase):
    def test_python_defaults_match_the_template(self) -> None:
        template = template_palettes()
        for scheme in ("light", "dark"):
            for role, value in validator.THEME_DEFAULTS[scheme].items():
                self.assertEqual(template[scheme].get(role), value, f"{scheme} {role}")

    def test_schema_roles_are_the_default_roles(self) -> None:
        roles = SCHEMA["$defs"]["themePalette"]["propertyNames"]["enum"]
        self.assertEqual(sorted(roles), sorted(validator.THEME_DEFAULTS["light"]))
        self.assertEqual(sorted(roles), sorted(validator.THEME_DEFAULTS["dark"]))

    def test_template_writes_only_the_schema_roles(self) -> None:
        text = TEMPLATE.read_text(encoding="utf-8")
        match = re.search(r"function applyTheme\(theme\) \{\s*const ROLES = (\[[^\]]*\]);", text)
        self.assertIsNotNone(match)
        self.assertEqual(json.loads(match.group(1)), SCHEMA["$defs"]["themePalette"]["propertyNames"]["enum"])

    def test_defaults_pass_every_checked_pair(self) -> None:
        for scheme, palette in validator.THEME_DEFAULTS.items():
            for fore, back, minimum in validator.THEME_CONTRAST_PAIRS:
                self.assertGreaterEqual(validator.contrast_ratio(palette[fore], palette[back]), minimum, f"{scheme} {fore} on {back}")

    @unittest.skipUnless(NODE, "node is not installed")
    def test_browser_defaults_and_ratio_match_python(self) -> None:
        defaults, ratios = browser_run("[V.THEME_DEFAULTS, [V.contrastRatio('#777', '#fff'), V.contrastRatio('#0b6e4f', '#fffdf7')]]", [])
        self.assertEqual(defaults, validator.THEME_DEFAULTS)
        self.assertAlmostEqual(ratios[0], validator.contrast_ratio("#777", "#fff"), places=12)
        self.assertAlmostEqual(ratios[1], validator.contrast_ratio("#0b6e4f", "#fffdf7"), places=12)


class ThemeRule(unittest.TestCase):
    GOOD = {"light": {"data": "#0b6e4f", "data-fill": "#e3f4ec", "panel": "#fffdf7"}, "dark": {"data": "#3fd08f", "panel": "#101914"}}

    def test_ratio_is_wcag(self) -> None:
        self.assertAlmostEqual(validator.contrast_ratio("#000", "#fff"), 21.0, places=6)
        self.assertAlmostEqual(validator.contrast_ratio("#fff", "#fff"), 1.0, places=6)
        self.assertAlmostEqual(validator.contrast_ratio("#777777", "#ffffff"), 4.478, places=3)

    def test_a_readable_theme_is_accepted(self) -> None:
        self.assertEqual(python_findings(with_theme(self.GOOD)), [])
        self.assertEqual(python_findings(with_theme({"dark": {"ink": "#ffffff"}})), [])

    def test_low_text_contrast_is_refused_against_the_default_it_meets(self) -> None:
        found = python_findings(with_theme({"light": {"ink": "#9aa4ba"}}))
        self.assertTrue(found)
        self.assertEqual({rule for rule, _ in found}, {"theme-contrast"})
        self.assertEqual({path for _, path in found}, {"$['meta']['theme']['light']['ink']"})

    def test_a_changed_background_is_blamed_when_it_is_the_override(self) -> None:
        found = python_findings(with_theme({"dark": {"panel": "#8b95ad"}}))
        self.assertIn(("theme-contrast", "$['meta']['theme']['dark']['panel']"), found)

    def test_low_line_contrast_is_refused_at_three_to_one(self) -> None:
        found = python_findings(with_theme({"dark": {"control": "#2a214d"}}))
        self.assertEqual(found, [("theme-contrast", "$['meta']['theme']['dark']['control']")])
        # #949494 on white is about 3.03:1: enough for a line, not for text.
        self.assertEqual(python_findings(with_theme({"light": {"data": "#949494"}})), [])
        self.assertTrue(python_findings(with_theme({"light": {"data-label": "#949494"}})))

    def test_each_scheme_is_checked_alone(self) -> None:
        # Black is fine as the dark panel; the light palette is untouched.
        self.assertEqual(python_findings(with_theme({"dark": {"panel": "#000000"}})), [])

    def test_unknown_role_and_bad_colour_are_schema_errors(self) -> None:
        for theme in ({"light": {"glow": "#ffffff"}}, {"light": {"ink": "black"}}, {"light": {"ink": "#12345"}},
                      {"light": {"ink": "#000;}body{x:y"}}, {"sepia": {"ink": "#000"}}, {}, {"light": {}}):
            with self.subTest(theme=theme):
                self.assertIn("schema", {rule for rule, _ in python_findings(with_theme(theme))})

    @unittest.skipUnless(NODE, "node is not installed")
    def test_browser_validator_agrees(self) -> None:
        themes = [self.GOOD, {"light": {"ink": "#9aa4ba"}}, {"dark": {"panel": "#8b95ad"}}, {"dark": {"control": "#2a214d"}},
                  {"light": {"data": "#949494"}}, {"light": {"data-label": "#949494"}}, {"dark": {"panel": "#000000"}}]
        docs = [with_theme(theme) for theme in themes]
        self.assertEqual(browser_findings(docs), [python_findings(doc) for doc in docs])
        bad = [with_theme(theme) for theme in ({"light": {"glow": "#ffffff"}}, {"light": {"ink": "black"}},
                                               {"light": {"ink": "#000;}body{x:y"}}, {"sepia": {"ink": "#000"}}, {}, {"light": {}})]
        for found in browser_findings(bad):
            self.assertIn("schema", {rule for rule, _ in found})


if __name__ == "__main__":
    unittest.main()
