#!/usr/bin/env python3
"""FEAT-021.1: the aggregator's workspace scanner reports state and the next skill to use.

Each test builds a small workspace in a temporary directory out of real artifacts (the DSL
examples, the real translator and bundle builder) and checks the state the scanner reports.
"""

from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "architecture-diagram" / "scripts" / "workspace_state.py"
DSL = ROOT / "architecture-diagram-dsl"
RENDERER = ROOT / "architecture-diagram-renderer"
EXAMPLE = DSL / "assets" / "examples" / "one-shot-checkout.yaml"
OTHER_EXAMPLE = DSL / "assets" / "examples" / "checkout-flow.yaml"
INVALID = DSL / "assets" / "fixtures" / "invalid" / "duplicate-id.yaml"
sys.path.insert(0, str(SCRIPT.parent))
import workspace_state  # noqa: E402


def scan(root: Path, *extra: str) -> dict:
    result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(root), "--format", "json", *extra], capture_output=True, text=True, encoding="utf-8")
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def translate(source: Path, output: Path) -> None:
    subprocess.run([sys.executable, str(DSL / "scripts" / "translate_transition_diagram.py"), str(source), "--output", str(output)], check=True, capture_output=True)


def build_bundle(model: Path, output: Path) -> None:
    subprocess.run([sys.executable, str(RENDERER / "scripts" / "build_bundle.py"), "--template", str(RENDERER / "assets" / "template.html"), "--model", str(model), "--output", str(output), "--inline"], check=True, capture_output=True)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def write_snapshots(directory: Path, model: Path) -> None:
    """A snapshot directory shaped like the exporter's, built by hand so no browser is needed."""
    directory.mkdir()
    svg = directory / "diagram--01-only.svg"
    svg.write_text('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>', encoding="utf-8")
    manifest = {
        "schema": "architecture-diagram-snapshots/1",
        "source": {"file": model.name, "sha256": sha256(model)},
        "renderer": {name: {"file": f"{name}.js", "sha256": "0" * 64} for name in ("template", "engine", "library", "font")},
        "snapshots": [{"view": None, "mode": None, "parameter": "stage", "state": {"index": 1, "id": "only", "title": "Only"}, "file": svg.name, "sha256": sha256(svg), "bytes": svg.stat().st_size}],
    }
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")


class WorkspaceStateTests(unittest.TestCase):
    def setUp(self) -> None:
        self._directory = tempfile.TemporaryDirectory()
        self.addCleanup(self._directory.cleanup)
        self.workspace = Path(self._directory.name)

    def single(self, report: dict) -> dict:
        self.assertEqual(len(report["items"]), 1, report["items"])
        return report["items"][0]

    def test_an_empty_workspace_goes_to_the_interview_skill(self) -> None:
        report = scan(self.workspace)
        self.assertEqual(report["next"]["state"], "empty")
        self.assertEqual(report["next"]["skill"], "architecture-diagram-interview")
        self.assertEqual(report["items"], [])

    def test_an_invalid_source_goes_to_the_dsl_skill_with_its_findings(self) -> None:
        shutil.copy(INVALID, self.workspace / "system.yaml")
        report = scan(self.workspace)
        item = self.single(report)
        self.assertEqual((item["state"], item["skill"]), ("source-invalid", "architecture-diagram-dsl"))
        self.assertIn("duplicate-id", [finding["rule"] for finding in item["findings"]])
        self.assertIn("validate_transition_diagram.py", item["command"])
        self.assertEqual(report["next"]["state"], "source-invalid")

    def test_a_valid_source_without_a_model_is_translated_next(self) -> None:
        shutil.copy(EXAMPLE, self.workspace / "checkout.yaml")
        item = self.single(scan(self.workspace))
        self.assertEqual((item["state"], item["skill"]), ("model-missing", "architecture-diagram-dsl"))
        self.assertIn("translate_transition_diagram.py", item["command"])
        self.assertIn("checkout.yaml", item["command"])

    def test_a_current_model_without_a_bundle_goes_to_the_renderer(self) -> None:
        source = self.workspace / "checkout.yaml"
        shutil.copy(EXAMPLE, source)
        translate(source, self.workspace / "checkout.model.json")
        item = self.single(scan(self.workspace))
        self.assertEqual((item["state"], item["skill"]), ("bundle-missing", "architecture-diagram-renderer"))
        self.assertIn("build_bundle.py", item["command"])
        self.assertEqual(item["artifacts"]["model"], "checkout.model.json")

    def test_a_model_that_no_longer_matches_its_source_is_stale(self) -> None:
        source = self.workspace / "checkout.yaml"
        shutil.copy(EXAMPLE, source)
        translate(source, self.workspace / "checkout.model.json")
        source.write_text(source.read_text(encoding="utf-8").replace("Checkout web app", "Checkout app v2"), encoding="utf-8")
        item = self.single(scan(self.workspace))
        self.assertEqual((item["state"], item["skill"]), ("model-stale", "architecture-diagram-dsl"))
        self.assertIn("translate_transition_diagram.py", item["command"])

    def test_a_bundle_built_from_an_old_model_is_stale(self) -> None:
        source = self.workspace / "checkout.yaml"
        shutil.copy(EXAMPLE, source)
        model = self.workspace / "checkout.model.json"
        translate(source, model)
        build_bundle(model, self.workspace / "checkout.html")
        source.write_text(source.read_text(encoding="utf-8").replace("Checkout web app", "Checkout app v2"), encoding="utf-8")
        translate(source, model)  # the model is current again, the bundle is not
        item = self.single(scan(self.workspace))
        self.assertEqual((item["state"], item["skill"]), ("bundle-stale", "architecture-diagram-renderer"))

    def test_a_current_bundle_without_snapshots_goes_to_batch_export(self) -> None:
        source = self.workspace / "checkout.yaml"
        shutil.copy(EXAMPLE, source)
        model = self.workspace / "checkout.model.json"
        translate(source, model)
        build_bundle(model, self.workspace / "checkout.html")
        item = self.single(scan(self.workspace))
        self.assertEqual((item["state"], item["skill"]), ("exports-missing", "architecture-diagram-renderer"))
        self.assertIn("export_snapshots.mjs", item["command"])
        self.assertEqual(item["artifacts"]["bundle"], "checkout.html")

    def test_snapshots_current_stale_and_tampered(self) -> None:
        source = self.workspace / "checkout.yaml"
        shutil.copy(EXAMPLE, source)
        model = self.workspace / "checkout.model.json"
        translate(source, model)
        build_bundle(model, self.workspace / "checkout.html")
        snapshots = self.workspace / "checkout-snapshots"
        write_snapshots(snapshots, model)

        done = self.single(scan(self.workspace))
        self.assertEqual((done["state"], done["skill"]), ("complete", "architecture-diagram-validation"))
        self.assertEqual(done["artifacts"]["snapshots"], "checkout-snapshots")

        (snapshots / "diagram--01-only.svg").write_text("<svg/>", encoding="utf-8")
        tampered = self.single(scan(self.workspace))
        self.assertEqual((tampered["state"], tampered["skill"]), ("snapshots-tampered", "architecture-diagram-validation"))
        self.assertTrue(any("sha256 mismatch" in problem for problem in tampered["problems"]))

        write_snapshots_again = snapshots / "manifest.json"
        shutil.rmtree(snapshots)
        write_snapshots(snapshots, model)
        source.write_text(source.read_text(encoding="utf-8").replace("Checkout web app", "Checkout app v2"), encoding="utf-8")
        translate(source, model)
        build_bundle(model, self.workspace / "checkout.html")
        stale = self.single(scan(self.workspace))
        self.assertEqual((stale["state"], stale["skill"]), ("snapshots-stale", "architecture-diagram-renderer"))
        self.assertTrue(write_snapshots_again.exists())

    def test_the_most_urgent_item_decides_the_next_step_across_several_sources(self) -> None:
        shutil.copy(INVALID, self.workspace / "broken.yaml")
        shutil.copy(OTHER_EXAMPLE, self.workspace / "flow.yaml")
        report = scan(self.workspace)
        self.assertEqual(sorted(item["state"] for item in report["items"]), ["model-missing", "source-invalid"])
        self.assertEqual(report["next"]["state"], "source-invalid")
        self.assertEqual(report["next"]["source"], "broken.yaml")

    def test_skill_folders_and_tool_folders_are_not_part_of_the_workspace(self) -> None:
        skill = self.workspace / "some-skill"
        skill.mkdir()
        (skill / "SKILL.md").write_text("---\nname: some-skill\n---\n", encoding="utf-8")
        shutil.copy(EXAMPLE, skill / "bundled-example.yaml")
        for ignored in ("node_modules", ".git", "dist"):
            (self.workspace / ignored).mkdir()
            shutil.copy(EXAMPLE, self.workspace / ignored / "ignored.yaml")
        self.assertEqual(scan(self.workspace)["next"]["state"], "empty")

    def test_non_diagram_yaml_and_json_are_ignored_without_errors(self) -> None:
        (self.workspace / "config.yaml").write_text("name: demo\nitems: [1, 2]\n", encoding="utf-8")
        (self.workspace / "data.json").write_text('{"a": 1}', encoding="utf-8")
        (self.workspace / "broken.yaml").write_text("dsl: transition-diagram/1.0\nmeta: [unclosed\n", encoding="utf-8")
        report = scan(self.workspace)
        self.assertEqual([item["source"] for item in report["items"]], ["broken.yaml"])
        self.assertEqual(report["items"][0]["state"], "source-invalid")
        self.assertIn("yaml-parse-error", [finding["rule"] for finding in report["items"][0]["findings"]])

    def test_the_report_names_the_tooling_it_found(self) -> None:
        tooling = scan(self.workspace)["tooling"]
        for key in ("python", "yaml", "jsonschema", "node", "skills"):
            self.assertIn(key, tooling)
        self.assertTrue(tooling["skills"]["dsl"] and tooling["skills"]["renderer"], tooling)

    def test_text_output_names_the_state_the_skill_and_the_command(self) -> None:
        shutil.copy(EXAMPLE, self.workspace / "checkout.yaml")
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.workspace), "--format", "text"], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 0, result.stderr)
        for expected in ("model-missing", "architecture-diagram-dsl", "translate_transition_diagram.py", "Next:"):
            self.assertIn(expected, result.stdout)

    def test_a_missing_root_is_a_usage_error(self) -> None:
        result = subprocess.run([sys.executable, str(SCRIPT), "--root", str(self.workspace / "nope")], capture_output=True, text=True, encoding="utf-8")
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("Traceback", result.stderr)

    def test_every_state_has_an_owner_skill_and_a_summary(self) -> None:
        for name, entry in workspace_state.STATES.items():
            with self.subTest(state=name):
                self.assertIn(entry["skill"], workspace_state.SKILLS)
                self.assertTrue(entry["summary"])
        self.assertEqual(workspace_state.STATES["empty"]["skill"], "architecture-diagram-interview")


if __name__ == "__main__":
    unittest.main()
