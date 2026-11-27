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
            self.assertIn('<script src="./diagram-runtime.js"></script>', html)
            self.assertTrue(output.with_name("architecture-library.js").is_file())
            self.assertTrue(output.with_name("diagram-runtime.js").is_file())

    def test_inline_mode_has_no_sibling_sidecars(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output, inline=True)
            html = output.read_text(encoding="utf-8")
            self.assertNotIn('<script src="./architecture-library.js"></script>', html)
            self.assertNotIn('<script src="./diagram-runtime.js"></script>', html)
            self.assertIn("architecture-library.js (inlined)", html)
            self.assertIn("diagram-runtime.js (inlined)", html)
            self.assertFalse(output.with_name("architecture-library.js").exists())
            self.assertFalse(output.with_name("diagram-runtime.js").exists())

    def test_inline_delivery_documents_runtime_dependency_boundary(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            module.build_bundle(TEMPLATE, MODEL, output, inline=True)
            html = output.read_text(encoding="utf-8")
            self.assertIn("diagram-runtime.js (inlined)", html)
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
            original = {path.name: path.read_bytes() for path in (output, output.with_name("architecture-library.js"), output.with_name("diagram-runtime.js"))}
            real_replace = module.os.replace

            def fail_engine(source, target):
                if Path(target).name == "diagram-runtime.js":
                    raise OSError("simulated sidecar publish failure")
                return real_replace(source, target)

            with patch.object(module.os, "replace", side_effect=fail_engine):
                with self.assertRaises(OSError):
                    module.build_bundle(TEMPLATE, MODEL, output)
            self.assertEqual(output.read_bytes(), original["diagram.html"])
            self.assertEqual(output.with_name("architecture-library.js").read_bytes(), original["architecture-library.js"])
            self.assertEqual(output.with_name("diagram-runtime.js").read_bytes(), original["diagram-runtime.js"])

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
            # TASK-039: without --geometry the builder computes the layout itself, and the page is the same kind of page.
            computed = Path(directory) / "computed.html"
            module.build_bundle(TEMPLATE, MODEL, computed, inline=True)
            page = computed.read_text(encoding="utf-8")
            embedded = json.loads(page.split('id="diagram-geometry">')[1].split("</script>")[0])
            self.assertTrue(embedded["layouts"] and embedded["states"])
            for placement in ("elkjs", "dagre.min.js", "function dagreLayout", "function forceLayout", "function retryElk", "function computeLayout", "btn-retry-elk"):
                self.assertNotIn(placement, page)
            self.assertIn("diagram-runtime.js (inlined)", page)
            self.assertIn("function storedLayout", page)

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

    def test_task039_builder_needs_node_or_a_geometry_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"ARCHNIME_GEOMETRY_CACHE": "0"}), patch.object(module.shutil, "which", return_value=None):
            output = Path(directory) / "diagram.html"
            with self.assertRaises(module.GeometryError) as raised:
                module.build_bundle(TEMPLATE, MODEL, output)
            self.assertIn("Node.js 24", str(raised.exception))
            self.assertIn("--geometry", str(raised.exception))
            self.assertFalse(output.exists())
            # A geometry file needs no Node.
            module.build_bundle(TEMPLATE, MODEL, output, geometry_path=self._geometry(directory))
            self.assertTrue(output.is_file())
            with self.assertRaises(module.GeometryError):
                module.build_bundle(TEMPLATE, MODEL, output, geometry_path=self._geometry(directory), tune=True)

    def test_task039_computed_geometry_is_cached_by_model_and_engine(self) -> None:
        with tempfile.TemporaryDirectory() as directory, patch.dict("os.environ", {"ARCHNIME_GEOMETRY_CACHE": str(Path(directory) / "cache")}):
            first = module._compute_geometry(MODEL, TEMPLATE.parent, False)
            with patch.object(module.subprocess, "run", side_effect=AssertionError("the cached geometry was not reused")):
                self.assertEqual(module._compute_geometry(MODEL, TEMPLATE.parent, False), first)
            changed = Path(directory) / "changed.json"
            changed.write_text(MODEL.read_text(encoding="utf-8").replace("Checkout", "Check-out"), encoding="utf-8")
            self.assertNotEqual(module._compute_geometry(changed, TEMPLATE.parent, False), first)
            self.assertNotEqual(module._compute_geometry(MODEL, TEMPLATE.parent, True), first)

    def test_feat038_bundle_geometry_is_embedded_per_view(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "diagram.html"
            layout = {"nodes": [], "wires": []}
            views = {"context": {"states": {"s": {"": 0}}, "layouts": [layout]}, "flow": {"states": {"f": {"": 0}}, "layouts": [layout]}}
            module.build_bundle(TEMPLATE, MODEL, output, geometry_path=self._geometry(directory, views=views))
            embedded = output.read_text(encoding="utf-8").split('id="diagram-geometry">')[1].split("</script>")[0]
            self.assertEqual(set(json.loads(embedded)), {"views"})
            self.assertEqual(set(json.loads(embedded)["views"]), {"context", "flow"})
            with self.assertRaises(module.GeometryError) as raised:
                module.build_bundle(TEMPLATE, MODEL, output, geometry_path=self._geometry(directory, views={"context": {"states": {}, "layouts": []}}))
            self.assertIn("holds no layouts", str(raised.exception))

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
