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
SCRIPT = ROOT / "archnime-renderer" / "scripts" / "build_bundle.py"
TEMPLATE = ROOT / "archnime-renderer" / "assets" / "template.html"
MODEL = ROOT / "archnime-renderer" / "tests" / "fixtures" / "checkout-flow.json"


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
            self.assertIn("not an offline guarantee", (ROOT / "archnime-renderer" / "references" / "distribution.md").read_text(encoding="utf-8"))

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
        library = (ROOT / "archnime-renderer" / "assets" / "architecture-library.js").read_text(encoding="utf-8")
        template = TEMPLATE.read_text(encoding="utf-8")
        engine = (ROOT / "archnime-renderer" / "assets" / "diagram-engine.js").read_text(encoding="utf-8")

        self.assertIn('M5 5h12v4H5zM5 10h12v4H5zM5 15h8v4H5z', library)
        self.assertIn('d.shape === "queue" ? Math.min(12, d.h / 2) : 9', template)
        self.assertIn('n.shape === "queue" ? Math.min(12, hw, hh)', engine)

    # FEAT-038: stored geometry. The builder embeds a geometry computed from exactly this model and
    # engine, leaves the layout libraries out, and fails on a missing or stale file.
    def _geometry(self, directory: str, **changes: object) -> Path:
        geometry = {
            "format": module.GEOMETRY_FORMAT,
            "modelSha256": module._content_hash(MODEL),
            "engineSha256": module._content_hash(*(TEMPLATE.parent / name for name in module.ENGINE_SOURCES)),
            "states": {"flow": {"": 0}},
            "layouts": [{"nodes": [], "wires": [], "note": "</script><b>"}],
            **changes,
        }
        path = Path(directory) / "model.geometry.json"
        path.write_text(json.dumps(geometry), encoding="utf-8")
        return path

    def test_feat038_geometry_is_embedded_and_layout_libraries_are_left_out(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output, geometry_path=self._geometry(directory))
            html = output.read_text(encoding="utf-8")
            self.assertIn('<script type="application/json" id="diagram-geometry">', html)
            self.assertNotIn("dagre", html.split('id="diagram-geometry"')[0].lower().replace("window.dagre", ""))
            self.assertNotIn("elkjs", html)
            self.assertIn("d3.min.js", html)
            self.assertIn("gif.js", html)
            # The payload cannot close its script element.
            self.assertNotIn("</script><b>", html)
            self.assertIn("\\u003c/script\\u003e\\u003cb\\u003e", html)
            plain = Path(directory) / "plain.html"
            module.build_bundle(TEMPLATE, MODEL, plain)
            self.assertNotIn('id="diagram-geometry">', plain.read_text(encoding="utf-8"))
            self.assertIn("elkjs", plain.read_text(encoding="utf-8"))

    def test_feat038_missing_or_stale_geometry_fails_the_build(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            cases = {
                "is missing": Path(directory) / "absent.geometry.json",
                "different version of": self._geometry(directory, modelSha256="0" * 64),
            }
            for message, geometry in cases.items():
                with self.subTest(message), self.assertRaises(module.GeometryError) as raised:
                    module.build_bundle(TEMPLATE, MODEL, output, geometry_path=geometry)
                self.assertIn(message, str(raised.exception))
                self.assertIn("store_geometry.mjs", str(raised.exception))
                self.assertFalse(output.exists())
            for message, changes in {
                "layout engine has changed": {"engineSha256": "0" * 64},
                "format": {"format": "something-else/1"},
                "holds no layouts": {"layouts": []},
            }.items():
                with self.subTest(message), self.assertRaises(module.GeometryError) as raised:
                    module.build_bundle(TEMPLATE, MODEL, output, geometry_path=self._geometry(directory, **changes))
                self.assertIn(message, str(raised.exception))
                self.assertFalse(output.exists())
            unreadable = Path(directory) / "broken.geometry.json"
            unreadable.write_text("{not json", encoding="utf-8")
            with self.assertRaises(module.GeometryError):
                module.build_bundle(TEMPLATE, MODEL, output, geometry_path=unreadable)

    def test_feat038_model_hash_ignores_line_endings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            unix, windows = Path(directory) / "unix.json", Path(directory) / "windows.json"
            text = MODEL.read_text(encoding="utf-8").replace("\r\n", "\n")
            unix.write_bytes(text.encode("utf-8"))
            windows.write_bytes(text.replace("\n", "\r\n").encode("utf-8"))
            self.assertEqual(module._content_hash(unix), module._content_hash(windows))

    def test_custom_icon_markup_is_sanitized_at_the_shared_render_layer(self) -> None:
        template = TEMPLATE.read_text(encoding="utf-8")
        self.assertIn("SAFE_ICON_TAGS", template)
        self.assertIn("sanitizeIconMarkup", template)
        self.assertIn("child.remove()", template)
        self.assertIn("attribute.name.toLowerCase()", template)


if __name__ == "__main__":
    unittest.main()
