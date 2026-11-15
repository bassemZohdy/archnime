#!/usr/bin/env python3
"""Regression tests for the DSL-to-renderer model translator."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
SKILL = ROOT / "architecture-diagram-dsl"
TRANSLATOR = SKILL / "scripts" / "translate_transition_diagram.py"
EXAMPLES = SKILL / "assets" / "examples"
sys.path.insert(0, str(TRANSLATOR.parent))
import translate_transition_diagram as module
from translate_transition_diagram import architecture_mermaid, sequence_mermaid


TITLED_PARALLEL_YAML = """\
dsl: transition-diagram/1.0
meta: { title: Titles }
catalog:
  a: { label: A, type: service }
  b: { label: B, type: service }
  c: { label: C, type: service }
flow:
  title: F
  nodes: [a, b, c]
  wires: ["a -> b: one", "a -> c: two"]
  steps:
    - title: Fan out
      parallel:
        - { title: Left, edge: "a -> b" }
        - { title: Right, edge: "a -> c" }
"""


class TranslatorTests(unittest.TestCase):
    def translate(self, source: Path) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "model.json"
            result = subprocess.run(
                [sys.executable, str(TRANSLATOR), str(source), "--output", str(output)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(output.read_text(encoding="utf-8"))

    def translate_text(self, text: str) -> dict:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "diagram.yaml"
            source.write_text(text, encoding="utf-8")
            return self.translate(source)

    def test_system_example_maps_shapes_and_shorthand(self) -> None:
        model = self.translate(EXAMPLES / "one-shot-checkout.yaml")
        self.assertEqual(len(model["stages"]), 1)
        self.assertEqual(model["stages"][0]["id"], "only")
        self.assertEqual(model["catalog"]["ordersdb"]["shape"], "db")
        self.assertEqual(model["catalog"]["client"]["shape"], "actor")
        self.assertEqual(model["stages"][0]["wires"][0], {"from": "client", "to": "gateway", "type": "data", "flow": True, "label": "HTTPS"})
        self.assertEqual(model["canvas"], {"w": 1600, "h": 900, "minWidth": 960})

    def test_documentation_and_adr_links_survive_translation(self) -> None:
        model = self.translate_text(
            """dsl: transition-diagram/1.0
meta:
  title: Linked view
catalog:
  gateway:
    label: Gateway
    type: gateway
system:
  title: Linked state
  docs: docs/linked-state.md
  adr: docs/adr/0001-linked-state.md
  nodes: [gateway]
  wires: []
"""
        )
        self.assertEqual(model["stages"][0]["docs"], "docs/linked-state.md")
        self.assertEqual(model["stages"][0]["adr"], "docs/adr/0001-linked-state.md")

    def test_v2_views_preserve_bundle_identity_and_materialize_deployment(self) -> None:
        model = self.translate(EXAMPLES / "commerce-views.yaml")
        self.assertEqual([view["viewId"] for view in model["views"]], ["context", "production", "checkout"])
        deployment = model["views"][1]
        self.assertEqual(deployment["viewMode"], "deployment")
        self.assertEqual(deployment["deployment"]["placements"][1]["instanceIds"], ["orders-orders-host-1", "orders-orders-host-2"])
        self.assertEqual(len(deployment["stages"][0]["wires"]), 2)
        self.assertIn("orders-orders-host-1", deployment["catalog"])
        self.assertNotIn("client", deployment["catalog"])
        self.assertNotIn("commerce", deployment["packages"])
        self.assertNotIn("packages", model["views"][0])
        self.assertEqual(model["shared"]["catalog"]["client"]["navigateTo"], "checkout")

    def test_deployment_overrides_scope_and_colliding_instance_ids_survive(self) -> None:
        document = yaml.safe_load((EXAMPLES / "commerce-views.yaml").read_text(encoding="utf-8"))
        document["catalog"]["gateway-orders-host-1"] = {"label": "Authored identifier", "type": "service"}
        production = next(view for view in document["views"] if view["id"] == "production")
        production["nodes"][0] = {"id": "gateway", "label": "Edge gateway", "kind": "new", "size": [210, 80]}
        production["boundaries"] = [{"id": "regulated", "label": "Regulated orders", "contains": ["commerce"]}]
        model = self.translate_text(yaml.safe_dump(document, sort_keys=False))
        deployment = next(view for view in model["views"] if view["viewId"] == "production")
        ids = deployment["deployment"]["placements"][0]["instanceIds"]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertNotIn("gateway-orders-host-1", ids)
        self.assertEqual(deployment["catalog"][ids[0]]["label"], "Edge gateway")
        self.assertEqual((deployment["catalog"][ids[0]]["w"], deployment["catalog"][ids[0]]["h"]), (210, 80))
        self.assertEqual(set(deployment["stages"][0]["boundaries"][0]["contains"]), {item for placement in deployment["deployment"]["placements"] for item in placement["instanceIds"]})

    def test_nested_parallel_steps_are_recursively_normalized(self) -> None:
        model = self.translate_text(
            """dsl: transition-diagram/1.0
meta:
  title: Nested parallel
catalog:
  a: {label: A, type: service}
  b: {label: B, type: service}
  c: {label: C, type: service}
flow:
  title: Nested parallel
  nodes: [a, b, c]
  wires:
    - "a => b: first"
    - "b => c: second"
  steps:
    - title: Parallel work
      parallel:
        - title: Nested branch
          parallel:
            - edge: "a => b"
        - title: Sibling branch
          edge: "b => c"
"""
        )
        step = model["flow"]["steps"][0]
        self.assertEqual(len(step["steps"]), 2)
        self.assertEqual(step["steps"][0]["steps"][0]["edges"][0]["wireType"], "data")
        self.assertEqual({(edge["from"], edge["to"]) for edge in step["edges"]}, {("a", "b"), ("b", "c")})

    def test_flow_edges_keep_wire_type_for_sequence_lookup(self) -> None:
        source = {
            "title": "Typed flow",
            "nodes": ["a", "b"],
            "wires": [
                {"from": "a", "to": "b", "type": "data", "label": "payload"},
                {"from": "a", "to": "b", "type": "security", "label": "token"},
            ],
            "steps": [{"title": "Token", "edge": "a -> b"}],
        }
        copied, _stage = module._copy_flow(source)
        self.assertEqual(copied["steps"][0]["edges"][0]["wireType"], "data")
        self.assertEqual({wire["type"] for wire in copied["wires"]}, {"data", "security"})

    def test_transition_preserves_identity_and_wire_metadata(self) -> None:
        model = self.translate(EXAMPLES / "strangler-migration.yaml")
        self.assertEqual(len(model["stages"]), 3)
        self.assertNotIn("flowPresentation", model["meta"])
        self.assertEqual(model["packages"]["commercePlatform"]["children"], ["domain", "dataLayer"])
        self.assertEqual(model["stages"][1]["wires"][-1]["type"], "compat")
        self.assertEqual(model["stages"][1]["wires"][-1]["flow"], False)

    def test_steps_mode_matches_equivalent_transition_model(self) -> None:
        transition = self.translate(EXAMPLES / "strangler-migration.yaml")
        steps = self.translate(EXAMPLES / "strangler-migration-steps.yaml")
        self.assertEqual(steps, transition)

    def test_steps_set_merges_accumulated_presentation_overrides(self) -> None:
        model = self.translate(EXAMPLES / "steps-refinement.yaml")
        gateway = model["stages"][2]["nodes"][1]
        self.assertEqual(gateway, {"id": "gateway", "kind": "mixed", "detail": "auth + routing"})

    def test_scenarios_materialize_each_variant_from_shared_base(self) -> None:
        model = self.translate(EXAMPLES / "orders-failover-scenarios.yaml")
        self.assertEqual(model["meta"]["composition"], "scenarios")
        self.assertEqual([stage["id"] for stage in model["stages"]], ["base", "primary-down", "region-down"])
        primary_down = model["stages"][1]
        self.assertIn(
            {"from": "orders", "to": "ordersdbReplica", "type": "data", "flow": False, "label": "RW (promoted)"},
            primary_down["wires"],
        )
        region_down = model["stages"][2]
        self.assertEqual(region_down["nodes"][3], "ordersdb")
        self.assertNotIn("RW (promoted)", [wire["label"] for wire in region_down["wires"]])

    def test_flow_policy_maps_to_renderer_metadata(self) -> None:
        source = (EXAMPLES / "strangler-migration.yaml").read_text(encoding="utf-8")
        source = source.replace(
            "  layout: auto\n",
            "  layout: auto\n  flow:\n    secondary: [control, neutral]\n    mode: bundle\n    secondaryRoute: bundle\n",
            1,
        )
        model = self.translate_text(source)
        self.assertEqual(
            model["meta"]["flowPresentation"],
            {"secondaryTypes": ["control", "neutral"], "mode": "bundle", "secondaryRoute": "bundle"},
        )

    def test_perspective_and_operations_metadata_survive_translation(self) -> None:
        model = self.translate_text(
            """dsl: transition-diagram/1.0
meta:
  title: Perspective metadata
  minWireLen: 96
  perspectives: [migration, zones, devops]
catalog:
  gateway:
    label: Gateway
    type: gateway
    ops: true
system:
  title: Perspective metadata
  nodes: [gateway]
  wires:
    - from: gateway
      to: gateway
      type: control
      ops: true
"""
        )
        self.assertEqual(model["meta"]["minWireLen"], 96)
        self.assertEqual(model["meta"]["perspectives"], ["migration", "zones", "devops"])
        self.assertTrue(model["catalog"]["gateway"]["ops"])
        self.assertTrue(model["stages"][0]["wires"][0]["ops"])

    def test_flow_walkthrough_normalizes_returns_groups_and_parallel_edges(self) -> None:
        model = self.translate(EXAMPLES / "checkout-flow.yaml")
        self.assertEqual(len(model["stages"]), 1)
        self.assertEqual(model["flow"]["steps"][0]["kind"], "intro")
        self.assertIn("Client request", model["flow"]["steps"][0]["note"])
        self.assertEqual(model["flow"]["steps"][3]["kind"], "return")
        self.assertEqual(model["flow"]["steps"][3]["edges"][0]["wireFrom"], "gateway")
        self.assertEqual(len(model["flow"]["steps"][5]["edges"]), 2)
        self.assertTrue(model["flow"]["steps"][5]["group"])
        self.assertTrue(model["flow"]["steps"][6]["parallel"])
        self.assertEqual(model["meta"]["flow"], {"intro": True, "autoAdvanceMs": 1200, "loop": False})

    def test_flow_render_modes_are_preserved(self) -> None:
        source = (EXAMPLES / "checkout-flow.yaml").read_text(encoding="utf-8")
        for mode in ("stepwise", "all-steps", "single"):
            rendered = source.replace("    intro: true\n", f"    intro: true\n    render: {mode}\n", 1)
            model = self.translate_text(rendered)
            self.assertEqual(model["meta"]["flow"]["render"], mode)

    def test_sequence_output_emits_mermaid_flow_constructs(self) -> None:
        result = subprocess.run(
            [sys.executable, str(TRANSLATOR), str(EXAMPLES / "checkout-flow.yaml"), "--sequence"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("sequenceDiagram", result.stdout)
        self.assertIn("participant client as Checkout web app", result.stdout)
        self.assertIn("gateway->>orders: POST /orders · authenticated", result.stdout)
        self.assertIn("events-->>notify", result.stdout)
        self.assertIn("par Deliver and retry", result.stdout)
        self.assertIn("loop until delivered", result.stdout)

    def test_sequence_notes_name_at_most_two_participants(self) -> None:
        """FIX-009.1: Mermaid rejects `Note over a,b,c`; keep the first and last participant."""
        output = sequence_mermaid(self.translate(EXAMPLES / "checkout-flow.yaml"))
        notes = [line.strip() for line in output.splitlines() if line.strip().startswith("Note over ")]
        self.assertTrue(notes)
        for line in notes:
            participants = line[len("Note over "):].split(":", 1)[0].split(",")
            self.assertLessEqual(len(participants), 2, line)
        self.assertIn("Note over orders,events: The order is persisted", output)

    def test_sequence_parallel_branches_keep_their_titles(self) -> None:
        """FIX-009.1: a titled parallel child must not collapse to `and parallel branch`."""
        model = self.translate_text(TITLED_PARALLEL_YAML)
        output = sequence_mermaid(model)
        self.assertIn("par Fan out", output)
        self.assertIn("and Right", output)
        self.assertNotIn("and parallel branch", output)

    def test_architecture_output_emits_lossy_single_state_projection(self) -> None:
        result = subprocess.run(
            [sys.executable, str(TRANSLATOR), str(EXAMPLES / "one-shot-checkout.yaml"), "--mermaid"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("architecture-beta", result.stdout)
        self.assertIn("service client(internet)[Checkout web app]", result.stdout)
        self.assertIn("service ordersdb(database)[Orders DB]", result.stdout)
        self.assertIn("client:R --> L:gateway", result.stdout)
        self.assertNotIn("boundar", result.stdout.lower())

    def test_architecture_output_declares_nested_groups_and_stage_override(self) -> None:
        model = self.translate(EXAMPLES / "strangler-migration.yaml")
        model["stages"] = [
            {
                **model["stages"][1],
                "nodes": [{"id": "gateway", "label": "Gateway override"}, "orders", "ordersdb"],
            }
        ]
        output = architecture_mermaid(model)
        self.assertIn("group commercePlatform(cloud)[Commerce platform]", output)
        self.assertIn("group domain(cloud)[Domain services] in commercePlatform", output)
        self.assertIn("service gateway(cloud)[Gateway override]", output)
        self.assertIn("service orders(server)[Orders service] in domain", output)

    def test_registered_icon_type_survives_translation(self) -> None:
        model = self.translate_text(
            """dsl: transition-diagram/1.0
meta:
  title: Custom icon test
  icons:
    worker: agent
    mobile:
      viewBox: 0 0 24 24
      markup: <path d='M12 2v20'/>
catalog:
  worker:
    label: Worker
    type: worker
  mobile:
    label: Mobile client
    type: mobile
system:
  title: Custom icons
  nodes: [worker, mobile]
  wires: ["mobile => worker: request"]
"""
        )
        self.assertEqual(model["meta"]["icons"]["worker"], "agent")
        self.assertEqual(model["catalog"]["mobile"]["type"], "mobile")

    def test_invalid_registered_icon_alias_is_blocked(self) -> None:
        source = """dsl: transition-diagram/1.0
meta:
  title: Invalid icon alias
  icons:
    worker: not-a-built-in
catalog:
  worker:
    label: Worker
    type: worker
system:
  title: Invalid icon alias
  nodes: [worker]
  wires: []
"""
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "invalid-icons.yaml"
            path.write_text(source, encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(TRANSLATOR), str(path), "--output", str(Path(directory) / "model.json")],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("schema", result.stderr)

    def test_invalid_dsl_is_not_translated(self) -> None:
        source = EXAMPLES / "strangler-migration.yaml"
        with tempfile.TemporaryDirectory() as directory:
            invalid = Path(directory) / "invalid.yaml"
            invalid.write_text(source.read_text(encoding="utf-8").replace("type: gateway", "type: not-a-type", 1), encoding="utf-8")
            output = Path(directory) / "model.json"
            result = subprocess.run(
                [sys.executable, str(TRANSLATOR), str(invalid), "--output", str(output)],
                cwd=ROOT,
                capture_output=True,
                text=True,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("schema", result.stderr)
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
