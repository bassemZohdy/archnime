#!/usr/bin/env python3
"""Translate a validated Transition Diagram DSL YAML document to renderer JSON.

The YAML remains the semantic source of truth. This command performs the
mechanical, renderer-specific mapping needed by ``build_bundle.py`` without
adding renderer fields back into the DSL.

Usage:
  python3 translate_transition_diagram.py diagram.yaml --output model.json
  python3 translate_transition_diagram.py diagram.yaml --sequence
  python3 translate_transition_diagram.py bundle.yaml --view checkout --sequence
"""

from __future__ import annotations

import argparse
import copy
import json
import re
import sys
from pathlib import Path
from typing import Any

try:
    from validate_transition_diagram import (
        DEFAULT_SCHEMA_PATH,
        DuplicateKeyError,
        load_document,
        load_schema,
        normalize_wires,
        parse_wire_shorthand,
        validate_document,
    )
except ModuleNotFoundError as error:
    print(f"Missing translator dependency ({error.name}). Install with: pip install pyyaml jsonschema (or python -m pip install pyyaml jsonschema). Browser equivalent: use archnime-renderer/assets/translate.html.", file=sys.stderr)
    raise SystemExit(2)


DEFAULT_CANVAS = {"w": 1600, "h": 900, "minWidth": 960}
SHAPE_BY_TYPE = {
    "actor": "actor",
    "database": "db",
    "cache": "db",
    "queue": "queue",
    "topic": "queue",
    "package": "package",
}


def _renderer_shape(node_type: str) -> str:
    """Return the existing renderer shape family for a DSL semantic type."""

    return SHAPE_BY_TYPE.get(node_type, node_type)


def _copy_meta(meta: dict[str, Any]) -> dict[str, Any]:
    result = {key: copy.deepcopy(value) for key, value in meta.items() if key != "flow"}
    flow = meta.get("flow") or {}
    if flow:
        presentation: dict[str, Any] = {}
        if "secondary" in flow:
            presentation["secondaryTypes"] = copy.deepcopy(flow["secondary"])
        for key in ("mode", "secondaryRoute"):
            if key in flow:
                presentation[key] = copy.deepcopy(flow[key])
        if presentation:
            result["flowPresentation"] = presentation
        flow_config = {key: copy.deepcopy(flow[key]) for key in ("intro", "render", "autoAdvanceMs", "loop") if key in flow}
        if flow_config:
            result["flow"] = flow_config
    return result


def _copy_catalog(catalog: dict[str, Any]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for ident, source in catalog.items():
        node = {
            "label": source["label"],
            "type": source["type"],
            "shape": _renderer_shape(source["type"]),
            "kind": source.get("kind", "existing"),
        }
        for key in ("detail", "level", "contains", "navigateTo", "ops", "source"):
            if key in source:
                node[key] = copy.deepcopy(source[key])
        if "size" in source:
            node["w"], node["h"] = source["size"]
        result[ident] = node
    return result


def _copy_packages(packages: dict[str, Any] | None) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for ident, source in (packages or {}).items():
        package = {"label": source["label"], "children": copy.deepcopy(source["children"])}
        for key in ("level", "detail", "kind", "ops"):
            if key in source:
                package[key] = copy.deepcopy(source[key])
        result[ident] = package
    return result


def _copy_node(entry: str | dict[str, Any]) -> str | dict[str, Any]:
    if isinstance(entry, str):
        return entry
    result = {"id": entry["id"]}
    for key in ("label", "detail", "kind", "navigateTo", "contains", "ops", "source"):
        if key in entry:
            result[key] = copy.deepcopy(entry[key])
    if "size" in entry:
        result["w"], result["h"] = entry["size"]
    return result


def _copy_stage(source: dict[str, Any], default_id: str | None = None) -> dict[str, Any]:
    stage: dict[str, Any] = {
        "id": source.get("id") or default_id or "only",
        "title": source.get("title") or source.get("id") or default_id or "Stage",
        "nodes": [_copy_node(entry) for entry in source.get("nodes", [])],
        "wires": normalize_wires(source.get("wires", [])),
    }
    for key in ("summary", "callout", "docs", "adr", "changes", "boundaries", "changed", "disclosure", "expandedPackages", "layout", "navigateTo", "comparison"):
        if key in source:
            stage[key] = copy.deepcopy(source[key])
    return stage


def _wire_key(value: str | dict[str, Any]) -> tuple[Any, Any, Any]:
    wire = parse_wire_shorthand(value) if isinstance(value, str) else value
    return wire.get("from"), wire.get("to"), wire.get("type", "data")


def _materialize_steps(source: dict[str, Any]) -> list[dict[str, Any]]:
    current = copy.deepcopy(source["base"])
    states = [copy.deepcopy(current)]
    for step in source.get("sequence", []):
        next_state = copy.deepcopy(current)
        add = step.get("add") if isinstance(step.get("add"), dict) else {}
        remove = step.get("remove") if isinstance(step.get("remove"), dict) else {}
        overrides = step.get("set") if isinstance(step.get("set"), dict) else {}
        removed_nodes = set(remove.get("nodes", []) or [])
        removed_wires = {_wire_key(wire) for wire in remove.get("wires", []) or []}
        next_state["nodes"] = [node for node in next_state.get("nodes", []) if (node if isinstance(node, str) else node.get("id")) not in removed_nodes]
        next_state["nodes"].extend(copy.deepcopy(add.get("nodes", []) or []))
        retained_wires = []
        for wire in normalize_wires(next_state.get("wires", []) or []):
            key = _wire_key(wire)
            if key in removed_wires or key[0] in removed_nodes or key[1] in removed_nodes:
                continue
            retained_wires.append(wire)
        retained_wires.extend(normalize_wires(copy.deepcopy(add.get("wires", []) or [])))
        next_state["wires"] = retained_wires
        for node_id, override in overrides.items():
            for node_index, node in enumerate(next_state["nodes"]):
                existing_id = node if isinstance(node, str) else node.get("id")
                if existing_id != node_id:
                    continue
                merged = copy.deepcopy(node) if isinstance(node, dict) else {"id": node_id}
                merged.update(copy.deepcopy(override or {}))
                next_state["nodes"][node_index] = merged
                break
        for key in ("id", "title", "summary", "changes", "callout", "docs", "adr", "boundaries", "changed", "disclosure", "expandedPackages", "layout", "navigateTo"):
            if key in step:
                next_state[key] = copy.deepcopy(step[key])
        states.append(next_state)
        current = next_state
    return states


def _copy_steps(source: dict[str, Any]) -> list[dict[str, Any]]:
    return [_copy_stage(state) for state in _materialize_steps(source)]


def _copy_scenarios(source: dict[str, Any]) -> list[dict[str, Any]]:
    base = copy.deepcopy(source.get("base") or {})
    base.setdefault("id", "base")
    stages = [_copy_stage(base)]
    for variant in source.get("variants", []):
        materialized = _materialize_steps({"base": base, "sequence": [variant]})[1]
        stages.append(_copy_stage(materialized))
    return stages


def _flow_edge(text: str) -> dict[str, Any]:
    edge = parse_wire_shorthand(text)
    return {"from": edge["from"], "to": edge["to"], "type": edge.get("type", "data")}


def _copy_flow_step(step: dict[str, Any], wires: list[dict[str, Any]], index: int) -> dict[str, Any]:
    known = {(wire["from"], wire["to"], wire.get("type", "data")): wire for wire in wires}
    reverse = {(to, source, wire.get("type", "data")): wire for (source, to, _), wire in known.items()}

    def normalize_edge(text: str, kind: str, repeat: Any = None) -> dict[str, Any]:
        edge = _flow_edge(text)
        key = (edge["from"], edge["to"], edge.get("type", "data"))
        target = known.get(key) or (reverse.get(key) if kind == "return" else None)
        result = {
            "from": edge["from"],
            "to": edge["to"],
            "kind": kind,
            "wireType": edge.get("type", "data"),
            "wireFrom": target["from"] if target else None,
            "wireTo": target["to"] if target else None,
        }
        if repeat is not None:
            result["repeat"] = copy.deepcopy(repeat)
        return result

    def normalize_node(value: dict[str, Any], inherited_kind: str) -> dict[str, Any]:
        kind = value.get("kind", inherited_kind)
        result: dict[str, Any] = {"kind": kind, "edges": []}
        for key in ("title", "note", "label", "repeat", "navigateTo", "source"):
            if key in value:
                result[key] = copy.deepcopy(value[key])
        if isinstance(value.get("edge"), str):
            result["edges"] = [normalize_edge(value["edge"], kind, value.get("repeat"))]
        elif isinstance(value.get("group"), list):
            result["group"] = True
            result["edges"] = [normalize_edge(edge, kind, value.get("repeat")) for edge in value["group"]]
        elif isinstance(value.get("parallel"), list):
            result["parallel"] = True
            children = [normalize_node(child, kind) for child in value["parallel"] if isinstance(child, dict)]
            result["steps"] = children
            result["edges"] = [edge for child in children for edge in child.get("edges", [])]
        return result

    result = normalize_node(step, step.get("kind", "call"))
    result["id"] = f"step-{index + 1}"
    return result


def _copy_flow(source: dict[str, Any], intro: bool = False) -> tuple[dict[str, Any], dict[str, Any]]:
    wires = normalize_wires(source.get("wires", []))
    steps = [_copy_flow_step(step, wires, index) for index, step in enumerate(source.get("steps", []))]
    if intro:
        titles = [step.get("title") or step.get("label") or f"Step {index + 1}" for index, step in enumerate(steps)]
        steps.insert(0, {"id": "flow-intro", "title": "Flow overview", "kind": "intro", "edges": [], "note": "Steps: " + " → ".join(titles)})
    flow = {
        "id": source.get("id") or "flow",
        "title": source["title"],
        "nodes": [_copy_node(entry) for entry in source.get("nodes", [])],
        "wires": copy.deepcopy(wires),
        "steps": steps,
    }
    stage = {
        "id": flow["id"],
        "title": flow["title"],
        "nodes": copy.deepcopy(flow["nodes"]),
        "wires": copy.deepcopy(flow["wires"]),
    }
    for key in ("summary", "callout", "docs", "adr", "boundaries", "expandedPackages", "layout"):
        if key in source:
            flow[key] = copy.deepcopy(source[key])
            stage[key] = copy.deepcopy(source[key])
    return flow, stage


def _canvas(doc: dict[str, Any]) -> dict[str, Any]:
    # The DSL intentionally leaves canvas optional. The renderer requires a
    # logical size, so use a deterministic presentation-sized fallback while
    # preserving any dimensions the author supplied.
    result = copy.deepcopy(DEFAULT_CANVAS)
    result.update(copy.deepcopy(doc.get("canvas") or {}))
    return result


def _deployment_instance_id(component: str, target: str, index: int) -> str:
    return f"{component}-{target}-{index + 1}"


def _copy_deployment_view(doc: dict[str, Any], view: dict[str, Any]) -> dict[str, Any]:
    catalog = _copy_catalog(doc["catalog"])
    infrastructure = copy.deepcopy((view.get("deployment") or {}).get("infrastructure") or {})
    infrastructure_ids = set(infrastructure)
    parent_of: dict[str, str] = {}
    for infra_id, infra in infrastructure.items():
        for child in (infra or {}).get("children", []) or []:
            if child in infrastructure_ids and child not in parent_of:
                parent_of[child] = infra_id
    placements: list[dict[str, Any]] = []
    component_instances: dict[str, list[str]] = {}
    used_instance_ids = set(catalog) | set(doc.get("packages", {}) or {})
    next_instance_index: dict[tuple[str, str], int] = {}

    def allocate_instance_id(component: str, target: str) -> str:
        pair = (component, target)
        index = next_instance_index.get(pair, 0)
        while True:
            candidate = _deployment_instance_id(component, target, index)
            index += 1
            if candidate not in used_instance_ids:
                next_instance_index[pair] = index
                used_instance_ids.add(candidate)
                return candidate
    for placement in (view.get("deployment") or {}).get("placements", []) or []:
        component, target = placement.get("component"), placement.get("target")
        replicas = int(placement.get("replicas", 1) or 1)
        instance_ids = [allocate_instance_id(component, target) for _ in range(replicas)]
        component_instances.setdefault(component, []).extend(instance_ids)
        placements.append({**copy.deepcopy(placement), "replicas": replicas, "instanceIds": instance_ids})
        source = catalog.get(component, {"label": component, "type": "service", "shape": "service"})
        override = next((node for node in view.get("nodes", []) or [] if isinstance(node, dict) and node.get("id") == component), {})
        for index, instance_id in enumerate(instance_ids):
            instance = copy.deepcopy(source)
            suffix = placement.get("label") or (f"replica {index + 1}" if replicas > 1 else target)
            instance["label"] = f"{source.get('label', component)} · {suffix}"
            instance["deploymentComponent"] = component
            instance["deploymentTarget"] = target
            for key in ("label", "detail", "kind", "navigateTo", "ops"):
                if key in override:
                    instance[key] = copy.deepcopy(override[key])
            if "size" in override:
                instance["w"], instance["h"] = override["size"]
            catalog[instance_id] = instance
    packages = _copy_packages(doc.get("packages"))
    package_ids: dict[str, str] = {infra_id: f"deployment_{infra_id}" for infra_id in infrastructure}
    for infra_id, infra in infrastructure.items():
        children = [package_ids[child] for child in (infra or {}).get("children", []) or [] if child in package_ids]
        children.extend(instance_id for placement in placements if placement["target"] == infra_id for instance_id in placement["instanceIds"])
        packages[package_ids[infra_id]] = {
            "label": (infra or {}).get("label", infra_id),
            **({"detail": infra["detail"]} if "detail" in infra else {}),
            "kind": "existing",
            "children": children,
            "deploymentKind": (infra or {}).get("kind"),
            **({"ops": bool(infra["ops"])} if "ops" in infra else {}),
        }
    roots = [infra_id for infra_id in infrastructure if infra_id not in parent_of]
    nodes = [instance_id for instance_ids in component_instances.values() for instance_id in instance_ids]
    wires: list[dict[str, Any]] = []
    for wire in normalize_wires(view.get("wires", []) or []):
        sources = component_instances.get(wire.get("from"), [])
        targets = component_instances.get(wire.get("to"), [])
        if not sources or not targets:
            continue
        # A logical relationship represents connectivity, not every possible
        # replica pair. Keep one deterministic representative route so a
        # 3x3 placement does not become nine visually identical wires.
        physical = copy.deepcopy(wire)
        physical["from"], physical["to"] = sources[0], targets[0]
        physical["logicalFrom"], physical["logicalTo"] = wire.get("from"), wire.get("to")
        physical["replicaFanout"] = "representative"
        wires.append(physical)
    stage = {
        "id": view.get("id") or "deployment",
        "title": view["title"],
        "nodes": nodes,
        "wires": wires,
        "expandedPackages": [package_ids[infra_id] for infra_id in infrastructure],
        "layout": view.get("layout") or "deployment",
    }
    for key in ("summary", "callout", "docs", "adr", "changed", "disclosure"):
        if key in view:
            stage[key] = copy.deepcopy(view[key])
    package_source = doc.get("packages", {}) or {}

    def leaf_components(logical_id: str, trail: tuple[str, ...] = ()) -> list[str]:
        if logical_id in trail:
            return []
        package = package_source.get(logical_id)
        if not isinstance(package, dict):
            return [logical_id] if logical_id in component_instances else []
        result: list[str] = []
        for child in package.get("children", []) or []:
            for component in leaf_components(child, trail + (logical_id,)):
                if component not in result:
                    result.append(component)
        return result

    stage["boundaries"] = []
    for boundary in view.get("boundaries", []) or []:
        contains: list[str] = []
        for logical_id in boundary.get("contains", []) or []:
            for component in leaf_components(logical_id):
                for instance_id in component_instances.get(component, []):
                    if instance_id not in contains:
                        contains.append(instance_id)
        stage["boundaries"].append({**copy.deepcopy(boundary), "contains": contains})
    normalized_infrastructure = []
    for infra_id, infra in infrastructure.items():
        normalized_infrastructure.append({
            "id": infra_id,
            "label": (infra or {}).get("label", infra_id),
            "kind": (infra or {}).get("kind"),
            "parent": parent_of.get(infra_id),
            "children": copy.deepcopy((infra or {}).get("children", []) or []),
            **({"detail": copy.deepcopy(infra["detail"])} if "detail" in infra else {}),
            **({"ops": bool(infra["ops"])} if "ops" in infra else {}),
        })
    return {
        "meta": _copy_meta(doc["meta"]),
        "canvas": _canvas(doc),
        "catalog": catalog,
        "packages": packages,
        "stages": [stage],
        "deployment": {"infrastructure": normalized_infrastructure, "roots": roots, "placements": placements},
    }


def _translate_view(doc: dict[str, Any], view: dict[str, Any]) -> dict[str, Any]:
    mode = view.get("mode")
    if mode == "deployment":
        result = _copy_deployment_view(doc, view)
    else:
        legacy = {key: copy.deepcopy(value) for key, value in doc.items() if key not in {"dsl", "views"}}
        payload = copy.deepcopy(view)
        payload.pop("mode", None)
        payload.pop("comparison", None)
        legacy[mode] = payload
        if mode == "scenarios":
            legacy["meta"]["composition"] = "scenarios"
        result = translate_document({**legacy, "dsl": "transition-diagram/1.0"})
    result["viewId"] = view.get("id")
    result["viewTitle"] = view.get("title")
    result["viewMode"] = mode
    if "comparison" in view:
        result["comparison"] = copy.deepcopy(view["comparison"])
    return result


def _delta_map(full: dict[str, Any], shared: dict[str, Any]) -> dict[str, Any]:
    return {
        key: copy.deepcopy(value)
        for key, value in full.items()
        if key not in shared or shared[key] != value
    }


def _compact_view(result: dict[str, Any], shared: dict[str, Any]) -> dict[str, Any]:
    compact = {
        key: copy.deepcopy(value)
        for key, value in result.items()
        if key not in {"meta", "canvas", "catalog", "packages"}
    }
    if result.get("meta") != shared["meta"]:
        compact["meta"] = copy.deepcopy(result["meta"])
    if result.get("canvas") != shared["canvas"]:
        compact["canvas"] = copy.deepcopy(result["canvas"])
    catalog = _delta_map(result.get("catalog", {}), shared["catalog"])
    packages = _delta_map(result.get("packages", {}), shared["packages"])
    if catalog:
        compact["catalog"] = catalog
    if packages:
        compact["packages"] = packages
    return compact


def translate_document(doc: dict[str, Any]) -> dict[str, Any]:
    """Translate a structurally valid DSL document into renderer MODEL JSON."""

    if doc.get("dsl") == "transition-diagram/2.0" and "views" in doc:
        shared = {
            "meta": _copy_meta(doc["meta"]),
            "canvas": _canvas(doc),
            "catalog": _copy_catalog(doc["catalog"]),
            "packages": _copy_packages(doc.get("packages")),
        }
        translated_views = [_compact_view(_translate_view(doc, view), shared) for view in doc.get("views", [])]
        if not translated_views:
            raise ValueError("views must contain at least one view")
        return {
            "meta": copy.deepcopy(shared["meta"]),
            "canvas": copy.deepcopy(shared["canvas"]),
            "shared": {
                "catalog": copy.deepcopy(shared["catalog"]),
                "packages": copy.deepcopy(shared["packages"]),
            },
            "views": translated_views,
        }

    flow = None
    if "flow" in doc:
        flow, flow_stage = _copy_flow(doc["flow"], bool((doc.get("meta", {}).get("flow") or {}).get("intro")))
        stages = [flow_stage]
    elif "steps" in doc:
        stages = _copy_steps(doc["steps"])
    elif "scenarios" in doc:
        stages = _copy_scenarios(doc["scenarios"])
    elif "system" in doc:
        stages = [_copy_stage(doc["system"], "only")]
    else:
        stages = [_copy_stage(state) for state in doc["transition"]["states"]]
    result = {
        "meta": _copy_meta(doc["meta"]),
        "canvas": _canvas(doc),
        "catalog": _copy_catalog(doc["catalog"]),
        "packages": _copy_packages(doc.get("packages")),
        "stages": stages,
    }
    if flow is not None:
        result["flow"] = flow
    return result


def _mermaid_identifier(value: str, used: set[str]) -> str:
    candidate = re.sub(r"[^A-Za-z0-9_]", "_", value)
    if not candidate or candidate[0].isdigit():
        candidate = f"p_{candidate}"
    base = candidate
    suffix = 2
    while candidate in used:
        candidate = f"{base}_{suffix}"
        suffix += 1
    used.add(candidate)
    return candidate


def sequence_mermaid(model: dict[str, Any]) -> str:
    """Emit a Mermaid sequence companion from a translated flow model."""

    flow = model.get("flow")
    if not flow:
        raise ValueError("--sequence requires a flow: document")
    catalog = model.get("catalog", {})
    participant_ids = [entry if isinstance(entry, str) else entry.get("id") for entry in flow.get("nodes", [])]
    used: set[str] = set()
    aliases = {ident: _mermaid_identifier(ident, used) for ident in participant_ids if ident}
    lines = ["sequenceDiagram"]
    for ident in participant_ids:
        if not ident:
            continue
        label = str(catalog.get(ident, {}).get("label", ident)).replace("\n", " ")
        lines.append(f"    participant {aliases[ident]} as {label}")

    wires = {(wire.get("from"), wire.get("to"), wire.get("type", "data")): wire for wire in flow.get("wires", [])}

    def edge_entries(step: dict[str, Any]) -> list[dict[str, Any]]:
        entries = []
        if isinstance(step.get("edge"), dict):
            entries.append(step["edge"])
        entries.extend(step.get("edges", []) if isinstance(step.get("edges"), list) else [])
        return entries

    def participants(step: dict[str, Any]) -> list[str]:
        result: list[str] = []
        for edge in edge_entries(step):
            for ident in (edge.get("from"), edge.get("to")):
                if ident and ident not in result:
                    result.append(ident)
        for child in step.get("parallel", []) if isinstance(step.get("parallel"), list) else []:
            for ident in participants(child):
                if ident not in result:
                    result.append(ident)
        return result

    def wire_label(edge: dict[str, Any], step: dict[str, Any]) -> str:
        wire_type = edge.get("wireType", edge.get("type", "data"))
        wire = wires.get((edge.get("from"), edge.get("to"), wire_type))
        if wire is None and (edge.get("kind") == "return"):
            wire = wires.get((edge.get("to"), edge.get("from"), wire_type))
        return str(step.get("label") or (wire or {}).get("label") or f"{edge.get('from')} → {edge.get('to')}").replace("\n", " ")

    def emit_edge(edge: dict[str, Any], step: dict[str, Any], indent: str) -> None:
        source, target = edge.get("from"), edge.get("to")
        if source not in aliases or target not in aliases:
            return
        kind = edge.get("kind") or step.get("kind") or "call"
        arrow = "-->>" if kind in {"async", "return"} else "->>"
        lines.append(f"{indent}{aliases[source]}{arrow}{aliases[target]}: {wire_label(edge, step)}")

    def emit_step(step: dict[str, Any], indent: str = "    ", nested: bool = False) -> None:
        kind = step.get("kind") or "call"
        if kind == "intro":
            return
        title = str(step.get("title") or step.get("label") or "parallel work").replace("\n", " ")
        if not nested and step.get("note") and participants(step):
            note = str(step["note"]).replace("\n", " ")
            named = [aliases[ident] for ident in participants(step) if ident in aliases]
            # Mermaid allows a note over one or two participants: keep the span's two ends.
            people = ",".join(named[:1] if len(named) < 2 else [named[0], named[-1]])
            if people:
                lines.append(f"{indent}Note over {people}: {note}")
        if step.get("parallel") is True:
            lines.append(f"{indent}par {title}")
            children = step.get("steps") if isinstance(step.get("steps"), list) and step["steps"] else None
            if children:
                # Keep each authored branch (its title or label and its own edges, groups and loops).
                for index, child in enumerate(children):
                    if index:
                        lines.append(f"{indent}and {str(child.get('title') or child.get('label') or 'parallel branch').replace(chr(10), ' ')}")
                    emit_step(child, indent + "    ", nested=True)
            else:
                for index, edge in enumerate(edge_entries(step)):
                    if index:
                        lines.append(f"{indent}and parallel branch")
                    child = {"kind": edge.get("kind") or "call", "edges": [edge], "repeat": edge.get("repeat") or step.get("repeat"), "label": step.get("label")}
                    emit_step(child, indent + "    ", nested=True)
            lines.append(f"{indent}end")
            return
        if isinstance(step.get("parallel"), list):
            lines.append(f"{indent}par {title}")
            for index, child in enumerate(step["parallel"]):
                if index:
                    child_title = str(child.get("title") or child.get("label") or "parallel branch").replace("\n", " ")
                    lines.append(f"{indent}and {child_title}")
                emit_step(child, indent + "    ", nested=True)
            lines.append(f"{indent}end")
            return
        edges = edge_entries(step)
        if kind == "loop":
            lines.append(f"{indent}loop {str(step.get('repeat') or 'repeat').replace(chr(10), ' ')}")
            for edge in edges:
                emit_edge(edge, step, indent + "    ")
            lines.append(f"{indent}end")
            return
        for edge in edges:
            emit_edge(edge, step, indent)

    for step in flow.get("steps", []):
        emit_step(step)
    return "\n".join(lines) + "\n"


MERMAID_ICON_BY_TYPE = {
    "actor": "internet",
    "service": "server",
    "gateway": "cloud",
    "agent": "server",
    "database": "database",
    "cache": "database",
    "queue": "server",
    "topic": "server",
    "external": "cloud",
    "security": "cloud",
    "package": "cloud",
}


def _mermaid_label(value: Any) -> str:
    """Keep a label safe inside Mermaid architecture-beta square brackets."""

    return str(value).replace("\\", "\\\\").replace("[", "(").replace("]", ")").replace("\r", " ").replace("\n", " ")


def architecture_mermaid(model: dict[str, Any]) -> str:
    """Emit a lossy Mermaid architecture-beta view of the first model state.

    Mermaid architecture diagrams have groups, services, and untyped edges but
    no equivalent for this renderer's boundaries, wire labels/types, or stage
    history. The first stage is therefore the deterministic snapshot exported
    by this command; callers that need the full semantic model should retain
    the JSON output as the source of truth.
    """

    stages = model.get("stages") or []
    if not stages:
        raise ValueError("--mermaid requires a translated model with at least one state")

    stage = stages[0]
    catalog = model.get("catalog") or {}
    packages = model.get("packages") or {}
    entries = stage.get("nodes") or list(catalog)
    stage_ids = [entry if isinstance(entry, str) else entry.get("id") for entry in entries]
    stage_ids = [ident for ident in stage_ids if ident]
    stage_nodes = {
        entry["id"]: entry for entry in entries if isinstance(entry, dict) and entry.get("id")
    }
    package_ids = set(packages)

    parent_of: dict[str, str] = {}
    for package_id, package in packages.items():
        for child in package.get("children", []) or []:
            parent_of.setdefault(child, package_id)

    def leaves(ident: str, seen: set[str] | None = None) -> list[str]:
        if ident not in package_ids:
            return [ident]
        seen = set() if seen is None else seen
        if ident in seen:
            return []
        seen.add(ident)
        result: list[str] = []
        for child in packages[ident].get("children", []) or []:
            result.extend(leaves(child, seen.copy()))
        return result

    visible_nodes: list[str] = []
    visible_packages: set[str] = set()
    for ident in stage_ids:
        if ident in package_ids:
            visible_packages.update(package_id for package_id in [ident] if package_id in packages)
        for leaf in leaves(ident):
            if leaf in catalog and leaf not in visible_nodes:
                visible_nodes.append(leaf)
            package_id = parent_of.get(leaf)
            while package_id:
                visible_packages.add(package_id)
                package_id = parent_of.get(package_id)
    if not visible_nodes:
        visible_nodes = [ident for ident in catalog if ident in stage_ids]

    # Mermaid identifiers share one namespace across groups and services.
    used: set[str] = set()
    aliases: dict[str, str] = {}
    for ident in packages:
        if ident in visible_packages:
            aliases[ident] = _mermaid_identifier(ident, used)
    for ident in visible_nodes:
        aliases[ident] = _mermaid_identifier(ident, used)

    lines = ["architecture-beta"]
    for package_id, package in packages.items():
        if package_id not in visible_packages:
            continue
        parent = parent_of.get(package_id)
        parent_suffix = f" in {aliases[parent]}" if parent in aliases else ""
        lines.append(
            f"    group {aliases[package_id]}(cloud)[{_mermaid_label(package.get('label', package_id))}]{parent_suffix}"
        )
    for ident in visible_nodes:
        node = {**catalog.get(ident, {}), **stage_nodes.get(ident, {})}
        parent = parent_of.get(ident)
        parent_suffix = f" in {aliases[parent]}" if parent in aliases else ""
        icon = MERMAID_ICON_BY_TYPE.get(node.get("type"), "server")
        lines.append(f"    service {aliases[ident]}({icon})[{_mermaid_label(node.get('label', ident))}]{parent_suffix}")

    direction = (model.get("meta") or {}).get("direction", "LR")
    source_port, target_port = ("R", "L") if direction == "LR" else ("B", "T")
    seen_edges: set[tuple[str, str, bool]] = set()
    for wire in stage.get("wires", []) or []:
        source, target = wire.get("from"), wire.get("to")
        # Package-to-package edges have no faithful architecture-beta form;
        # leaf endpoints remain useful and are emitted when available.
        if source not in aliases or target not in aliases or source in package_ids or target in package_ids:
            continue
        directed = bool(wire.get("flow", False))
        key = (source, target, directed)
        if key in seen_edges:
            continue
        seen_edges.add(key)
        arrow = "-->" if directed else "--"
        lines.append(f"    {aliases[source]}:{source_port} {arrow} {target_port}:{aliases[target]}")

    return "\n".join(lines) + "\n"


def materialize_view(model: dict[str, Any], view_id: str) -> dict[str, Any]:
    """Return one view of a translated v2 bundle as a standalone model.

    A bundle stores the shared catalog and packages once and each view only as a
    delta; the Mermaid emitters need the merged form.
    """

    views = model.get("views") or []
    for view in views:
        if view.get("viewId") == view_id:
            shared = model.get("shared") or {}
            return {
                **view,
                "meta": {**(model.get("meta") or {}), **(view.get("meta") or {})},
                "canvas": {**(model.get("canvas") or {}), **(view.get("canvas") or {})},
                "catalog": {**(shared.get("catalog") or {}), **(view.get("catalog") or {})},
                "packages": {**(shared.get("packages") or {}), **(view.get("packages") or {})},
            }
    available = ", ".join(str(view.get("viewId")) for view in views)
    raise ValueError(f"view {view_id!r} not found; available views: {available}")


def _format_findings(findings: list[Any]) -> str:
    return "\n".join(
        f"  [{finding.severity}] {finding.rule}: {finding.message} ({finding.path})"
        for finding in findings
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Transition Diagram DSL YAML file")
    parser.add_argument("--output", type=Path, help="renderer model JSON output path")
    parser.add_argument("--schema", type=Path, default=Path(DEFAULT_SCHEMA_PATH), help="path to the DSL schema")
    parser.add_argument("--show-expanded", action="store_true", help="print materialized stages for steps: documents")
    parser.add_argument("--sequence", action="store_true", help="emit a Mermaid sequenceDiagram companion for flow: documents")
    parser.add_argument("--mermaid", action="store_true", help="emit a lossy Mermaid architecture-beta snapshot")
    parser.add_argument("--view", metavar="ID", help="for a transition-diagram/2.0 bundle, the view that --sequence, --mermaid and --show-expanded use")
    args = parser.parse_args(argv)

    if args.sequence and args.mermaid:
        parser.error("--sequence and --mermaid are mutually exclusive")

    try:
        doc = load_document(str(args.source))
    except DuplicateKeyError as error:
        print(f"{args.source}: duplicate-yaml-key: {error}", file=sys.stderr)
        return 1
    except Exception as error:  # parser and file errors should be actionable
        print(f"{args.source}: could not read YAML: {error}", file=sys.stderr)
        return 2

    try:
        schema = load_schema(str(args.schema))
    except Exception as error:  # a missing or unreadable schema is a usage problem, not a crash
        print(f"{args.schema}: could not read schema: {error}", file=sys.stderr)
        return 2
    findings = validate_document(doc, schema)
    if findings:
        print(f"{args.source}: translation blocked by {len(findings)} validation finding(s)", file=sys.stderr)
        print(_format_findings(findings), file=sys.stderr)
        return 1

    model = translate_document(doc)
    is_bundle = isinstance(model.get("views"), list)
    selected = model
    if args.view is not None and not is_bundle:
        print(f"{args.source}: --view needs a transition-diagram/2.0 document with views", file=sys.stderr)
        return 2
    if is_bundle and (args.view is not None or args.sequence or args.mermaid or args.show_expanded):
        if args.view is None:
            ids = ", ".join(str(view.get("viewId")) for view in model["views"])
            print(f"{args.source}: this bundle has {len(model['views'])} views ({ids}); choose one with --view <id>", file=sys.stderr)
            return 2
        try:
            selected = materialize_view(model, args.view)
        except ValueError as error:
            print(f"{args.source}: {error}", file=sys.stderr)
            return 2
    if args.sequence:
        try:
            sys.stdout.buffer.write(sequence_mermaid(selected).encode("utf-8"))
        except ValueError as error:
            print(f"{args.source}: {error}", file=sys.stderr)
            return 1
        return 0
    if args.mermaid:
        try:
            sys.stdout.buffer.write(architecture_mermaid(selected).encode("utf-8"))
        except ValueError as error:
            print(f"{args.source}: {error}", file=sys.stderr)
            return 1
        return 0
    if args.output is None:
        parser.error("--output is required unless --sequence is used")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(model, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"translated {args.source} -> {args.output}")
    if args.show_expanded:
        print(json.dumps(selected["stages"], ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
