#!/usr/bin/env python3
"""Regression tests for editable and ship-mode HTML bundles."""

from __future__ import annotations

import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "architecture-diagram-renderer" / "scripts" / "build_bundle.py"
TEMPLATE = ROOT / "architecture-diagram-renderer" / "assets" / "template.html"
MODEL = ROOT / "architecture-diagram-renderer" / "tests" / "fixtures" / "checkout-flow.json"


spec = importlib.util.spec_from_file_location("build_bundle", SCRIPT)
assert spec and spec.loader
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class BuildBundleTests(unittest.TestCase):
    def test_multi_file_output_is_default(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output)
            html = output.read_text(encoding="utf-8")
            self.assertIn('<script src="./architecture-library.js"></script>', html)
            self.assertIn('<script src="./diagram-engine.js"></script>', html)
            self.assertTrue(output.with_name("architecture-library.js").is_file())
            self.assertTrue(output.with_name("diagram-engine.js").is_file())

    def test_inline_mode_has_no_sibling_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output, inline=True)
            html = output.read_text(encoding="utf-8")
            self.assertNotIn('<script src="./architecture-library.js"></script>', html)
            self.assertNotIn('<script src="./diagram-engine.js"></script>', html)
            self.assertIn("architecture-library.js (inlined)", html)
            self.assertIn("diagram-engine.js (inlined)", html)
            self.assertFalse(output.with_name("architecture-library.js").exists())
            self.assertFalse(output.with_name("diagram-engine.js").exists())

    def test_inline_delivery_documents_runtime_dependency_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output, inline=True)
            html = output.read_text(encoding="utf-8")
            self.assertIn("diagram-engine.js (inlined)", html)
            self.assertIn("https://", html)
            self.assertIn("not an offline guarantee", (ROOT / "architecture-diagram-renderer" / "references" / "distribution.md").read_text(encoding="utf-8"))

    def test_model_json_is_escaped_inside_application_json_script(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            model = Path(directory) / "model.json"
            payload = "</script><script>window.reviewSentinel=true</script>"
            model.write_text(json.dumps({
                "meta": {"title": payload},
                "canvas": {"w": 800, "h": 500},
                "catalog": {"a": {"label": "A"}},
                "stages": [{"nodes": ["a"], "wires": []}],
            }), encoding="utf-8")
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, model, output)
            html = output.read_text(encoding="utf-8")
            self.assertNotIn("</script><script>window.reviewSentinel=true</script>", html)
            self.assertIn("\\u003c/script\\u003e", html)
            self.assertEqual(html.count('<script type="application/json" id="diagram-model">'), 1)

    def test_missing_sidecars_fail_before_writing_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            template = Path(directory) / "template.html"
            template.write_text(TEMPLATE.read_text(encoding="utf-8"), encoding="utf-8")
            output = Path(directory) / "diagram.html"
            with self.assertRaises(FileNotFoundError):
                module.build_bundle(template, MODEL, output)
            self.assertFalse(output.exists())

    def test_sidecar_publish_failure_restores_existing_bundle(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output)
            original = {path.name: path.read_bytes() for path in (output, output.with_name("architecture-library.js"), output.with_name("diagram-engine.js"))}
            real_replace = module.os.replace

            def fail_engine(source, target):
                if Path(target).name == "diagram-engine.js":
                    raise OSError("simulated sidecar publish failure")
                return real_replace(source, target)

            with patch.object(module.os, "replace", side_effect=fail_engine):
                with self.assertRaises(OSError):
                    module.build_bundle(TEMPLATE, MODEL, output)
            self.assertEqual(output.read_bytes(), original["diagram.html"])
            self.assertEqual(output.with_name("architecture-library.js").read_bytes(), original["architecture-library.js"])
            self.assertEqual(output.with_name("diagram-engine.js").read_bytes(), original["diagram-engine.js"])

    def test_queue_visual_contract_uses_distinct_glyph_and_matching_radius(self) -> None:
        library = (ROOT / "architecture-diagram-renderer" / "assets" / "architecture-library.js").read_text(encoding="utf-8")
        template = TEMPLATE.read_text(encoding="utf-8")
        engine = (ROOT / "architecture-diagram-renderer" / "assets" / "diagram-engine.js").read_text(encoding="utf-8")

        self.assertIn('M5 5h12v4H5zM5 10h12v4H5zM5 15h8v4H5z', library)
        self.assertIn('d.shape === "queue" ? Math.min(12, d.h / 2) : 9', template)
        self.assertIn('n.shape === "queue" ? Math.min(12, hw, hh)', engine)

    def test_custom_icon_markup_is_sanitized_at_the_shared_render_layer(self) -> None:
        template = TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("SAFE_ICON_TAGS", template)
        self.assertIn("sanitizeIconMarkup", template)
        self.assertIn("child.remove()", template)
        self.assertIn("attribute.name.toLowerCase()", template)


if __name__ == "__main__":
    unittest.main()
