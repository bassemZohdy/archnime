#!/usr/bin/env python3
"""
Validate transition-diagram DSL documents.

Two passes:
  1. JSON Schema (Draft 2020-12) against the bundled schema.
  2. Referential lint: rules the schema can't express (dangling ids,
     duplicate ids across catalog/packages, wire-shorthand parsing,
     frozen-field overrides, transition-too-short, ...).

Usage:
  python3 validate_transition_diagram.py diagram.yaml [more.yaml ...]
  python3 validate_transition_diagram.py --format json --strict diagrams/*.yaml
  python3 validate_transition_diagram.py --schema path/to/schema.yaml diagram.yaml

Dependencies: pyyaml, jsonschema>=4.18 (Draft 2020-12 support).
  pip install pyyaml jsonschema

Exit codes: 0 = no errors, 1 = schema or lint errors (warnings too with
--strict), 2 = usage/tooling error.
"""
from __future__ import annotations

import re
import copy

WIRE_SHORTHAND_RE = re.compile(
    r'^(?:(security|control|compat|neutral):\s*)?(\S+)\s*(->|=>)\s*(\S+)(?:\s*:\s*(.+))?$'
)


def parse_wire_shorthand(text: str) -> dict:
    """Parse a wire shorthand string into a full wire mapping dict.

    Grammar: [<type>: ]<from> (->|=>) <to>[: <label>]
      - optional type prefix: security | control | compat | neutral
        (bare, no prefix, means type "data")
      - '->' means flow: False, '=>' means flow: True
      - an optional ': <label>' trails the target id

    Raises ValueError (message starts with "wire-shorthand-parse-error:")
    if the string does not match the grammar.
    """
    m = WIRE_SHORTHAND_RE.match(text.strip())
    if not m:
        raise ValueError(f"wire-shorthand-parse-error: could not parse wire {text!r}")
    wire_type, from_id, arrow, to_id, label = m.groups()
    wire = {"from": from_id, "to": to_id, "type": wire_type or "data", "flow": arrow == "=>"}
    if label:
        wire["label"] = label.strip()
    return wire


def normalize_wires(wires: list) -> list[dict]:
    """Expand every shorthand string in a wires list into a full mapping.
    A wire that's already a mapping (dict) passes through unchanged (copied);
    anything else is skipped (the schema pass reports it).
    Raises ValueError on the first unparsable shorthand string."""
    out = []
    for w in wires if isinstance(wires, list) else []:
        if isinstance(w, str):
            out.append(parse_wire_shorthand(w))
        elif isinstance(w, dict):
            out.append(dict(w))
    return out


import argparse
import json
import os
import sys
from dataclasses import dataclass
from typing import Any

try:
    import yaml
except ImportError:
    print("Missing dependency: pyyaml/jsonschema. Install with: pip install pyyaml jsonschema (or python -m pip install pyyaml jsonschema). Browser equivalent: use architecture-diagram-renderer/assets/translate.html.", file=sys.stderr)
    sys.exit(2)

try:
    import jsonschema
except ImportError:
    print("Missing dependency: jsonschema>=4.18. Install with: pip install pyyaml jsonschema (or python -m pip install pyyaml jsonschema). Browser equivalent: use architecture-diagram-renderer/assets/translate.html.", file=sys.stderr)
    sys.exit(2)

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_SCHEMA_PATH = os.path.join(
    os.path.dirname(SCRIPT_DIR), "assets", "schema", "transition-diagram.schema.yaml"
)

NODE_OVERRIDE_ALLOWED_FIELDS = {"id", "label", "detail", "kind", "size", "navigateTo", "ops"}
BUILTIN_NODE_TYPES = {"actor", "service", "gateway", "agent", "database", "cache", "queue", "topic", "external", "security", "package"}


class DuplicateKeyError(yaml.constructor.ConstructorError):
    """Raised when a YAML mapping repeats a key instead of silently replacing it."""


class UniqueKeySafeLoader(yaml.SafeLoader):
    """SafeLoader variant that rejects duplicate mapping keys."""


# The DSL follows YAML 1.2 semantics for scalar labels.  PyYAML's default
# YAML 1.1 resolver would turn labels such as ``yes`` and ``on`` into bools.
UniqueKeySafeLoader.yaml_implicit_resolvers = {
    key: [item for item in values if item[0] != "tag:yaml.org,2002:bool"]
    for key, values in UniqueKeySafeLoader.yaml_implicit_resolvers.items()
}
UniqueKeySafeLoader.add_implicit_resolver(
    "tag:yaml.org,2002:bool",
    re.compile(r"^(?:true|false|True|False|TRUE|FALSE)$"),
    list("tTfF"),
)


def _construct_unique_mapping(loader, node, deep=False):
    explicit_key_nodes = {
        id(key_node)
        for key_node, _ in node.value
        if key_node.tag != "tag:yaml.org,2002:merge"
    }
    loader.flatten_mapping(node)
    mapping = {}
    explicit_keys = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            is_explicit = id(key_node) in explicit_key_nodes
            if is_explicit and not explicit_keys[key]:
                mapping[key] = loader.construct_object(value_node, deep=deep)
                explicit_keys[key] = True
                continue
            if not is_explicit and not explicit_keys[key]:
                # Preserve PyYAML's normal first-merged-value behavior while
                # still rejecting repeated keys authored in the same mapping.
                continue
            raise DuplicateKeyError(
                "while constructing a mapping",
                node.start_mark,
                f"found duplicate key {key!r}",
                key_node.start_mark,
            )
        mapping[key] = loader.construct_object(value_node, deep=deep)
        explicit_keys[key] = id(key_node) in explicit_key_nodes
    return mapping


UniqueKeySafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG,
    _construct_unique_mapping,
)


def _map(value) -> dict:
    """The value when it is a mapping, else empty: the schema pass reports the wrong shape."""
    return value if isinstance(value, dict) else {}


def _seq(value) -> list:
    """The value when it is a list, else empty: the schema pass reports the wrong shape."""
    return value if isinstance(value, list) else []


def _ids(value) -> list:
    """Only the string entries of a list; hashable and safe to look up."""
    return [item for item in _seq(value) if isinstance(item, str)]


@dataclass
class Finding:
    rule: str
    message: str
    path: str = ""
    severity: str = "error"

    def as_dict(self) -> dict:
        return {"rule": self.rule, "message": self.message, "path": self.path, "severity": self.severity}


def load_document(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.load(f, Loader=UniqueKeySafeLoader)


def load_schema(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        return yaml.load(f, Loader=UniqueKeySafeLoader)


def run_schema_pass(doc: Any, schema: dict) -> list[Finding]:
    validator_cls = jsonschema.validators.validator_for(schema)
    validator_cls.check_schema(schema)
    validator = validator_cls(schema)
    findings = []
    for error in validator.iter_errors(doc):
        path = "$" + "".join(f"[{p!r}]" for p in error.absolute_path)
        findings.append(Finding(rule="schema", message=error.message, path=path))
    return findings


def _collect_known_ids(doc: dict) -> set:
    ids = set(_map(doc.get("catalog")))
    ids |= set(_map(doc.get("packages")))
    return ids


def _lint_duplicate_ids(doc: dict) -> list[Finding]:
    findings = []
    catalog_ids = set(_map(doc.get("catalog")))
    package_ids = set(_map(doc.get("packages")))
    for dup in sorted(catalog_ids & package_ids, key=str):
        findings.append(Finding("duplicate-id", f"id {dup!r} is defined in both catalog and packages", f"$.catalog.{dup}"))
    return findings


def _lint_icons_and_node_types(doc: dict) -> list[Finding]:
    findings = []
    registered = _map(_map(doc.get("meta")).get("icons"))
    for icon_type, definition in registered.items():
        if icon_type in BUILTIN_NODE_TYPES:
            findings.append(Finding("schema", f"meta.icons cannot replace built-in node type {icon_type!r}", f"$.meta.icons[{icon_type!r}]"))
            continue
        if isinstance(definition, str) and definition not in BUILTIN_NODE_TYPES:
            findings.append(Finding("schema", f"meta.icons alias must name a built-in node type, got {definition!r}", f"$.meta.icons[{icon_type!r}]"))
    known_types = BUILTIN_NODE_TYPES | set(registered)
    for ident, entry in _map(doc.get("catalog")).items():
        if isinstance(entry, dict) and isinstance(entry.get("type"), str) and entry.get("type") not in known_types:
            findings.append(Finding("schema", f"catalog type must be a built-in or registered meta.icons type, got {entry.get('type')!r}", f"$.catalog[{ident!r}].type"))
    return findings


def _node_id(entry) -> str | None:
    """A node entry's id, or None when the entry has none (the schema pass reports that)."""
    if isinstance(entry, str):
        return entry
    ident = entry.get("id") if isinstance(entry, dict) else None
    return ident if isinstance(ident, str) else None


def _node_ids(entries) -> set:
    return {ident for ident in (_node_id(entry) for entry in _seq(entries)) if ident is not None}


def _lint_frozen_field_overrides(entries: list, path_prefix: str) -> list[Finding]:
    findings = []
    for entry in entries:
        if isinstance(entry, dict):
            extra = set(entry.keys()) - NODE_OVERRIDE_ALLOWED_FIELDS
            if extra:
                allowed = sorted(NODE_OVERRIDE_ALLOWED_FIELDS - {"id"})
                findings.append(Finding(
                    "frozen-field-override",
                    f"node override for {entry.get('id', '?')!r} sets {sorted(extra)} -- "
                    f"only {allowed} may be overridden per state; type is identity, "
                    "fixed once in catalog",
                    f"{path_prefix}.nodes",
                ))
    return findings


def _looks_like_unquoted_shorthand(w: dict) -> str | None:
    """If `w` is a one-key mapping whose key contains an arrow, it's almost
    certainly a wire shorthand string the author forgot to quote -- YAML
    parsed 'from -> to: label' as the mapping {'from -> to': 'label'}
    instead of a string. Returns a suggested quoted form, or None."""
    if len(w) == 1:
        key, value = next(iter(w.items()))
        if isinstance(key, str) and ("->" in key or "=>" in key) and isinstance(value, str):
            return f'"{key}: {value}"'
    return None


def _lint_wires(wires: list, known_ids: set, state_node_ids: set, path_prefix: str) -> list[Finding]:
    findings = []
    for w in _seq(wires):
        if isinstance(w, str):
            try:
                nw = parse_wire_shorthand(w)
            except ValueError as e:
                findings.append(Finding("wire-shorthand-parse-error", str(e), f"{path_prefix}.wires"))
                continue
        elif isinstance(w, dict):
            nw = dict(w)
            suggestion = _looks_like_unquoted_shorthand(nw)
            if suggestion is not None:
                findings.append(Finding(
                    "wire-shorthand-needs-quoting",
                    f"wire entry {w!r} looks like an unquoted shorthand string that YAML "
                    f"parsed as a mapping -- quote the whole string, e.g. {suggestion}",
                    f"{path_prefix}.wires",
                ))
                continue
        else:
            continue  # neither shorthand nor mapping: the schema pass reports it
        for end in ("from", "to"):
            if not isinstance(nw.get(end), str):
                continue
            if nw.get(end) not in known_ids:
                findings.append(Finding("unknown-catalog-ref", f"wire {end} {nw.get(end)!r} is not a catalog or package id", f"{path_prefix}.wires"))
            elif nw.get(end) not in state_node_ids:
                findings.append(Finding(
                    "wire-endpoint-not-in-state",
                    f"wire {end} {nw.get(end)!r} is not present in this state's nodes",
                    f"{path_prefix}.wires",
                ))
    return findings


def _lint_duplicate_nodes(entries, path_prefix: str) -> list[Finding]:
    """A node listed twice in one state would be drawn twice; report each repeated id once."""
    findings, seen, reported = [], set(), set()
    for entry in _seq(entries):
        ident = _node_id(entry)
        if ident is None:
            continue
        if ident in seen and ident not in reported:
            reported.add(ident)
            findings.append(Finding("duplicate-state-node", f"node {ident!r} is listed more than once in this state", f"{path_prefix}.nodes"))
        seen.add(ident)
    return findings


def _wire_declaration_key(wire) -> str | None:
    """Everything that makes a wire a distinct declaration; `flow` (the animation flag) is not part of it."""
    try:
        normalized = parse_wire_shorthand(wire) if isinstance(wire, str) else wire
    except ValueError:
        return None
    if not isinstance(normalized, dict) or not isinstance(normalized.get("from"), str) or not isinstance(normalized.get("to"), str):
        return None
    parts = [normalized.get(key) for key in ("from", "to", "type", "label", "layer", "bundle", "offset", "priority", "ops")]
    if parts[2] is None:
        parts[2] = "data"
    return json.dumps(parts, sort_keys=True, default=str)


def _lint_duplicate_wires(wires, path_prefix: str) -> list[Finding]:
    """The same wire declared twice draws on top of itself; parallel wires differ in label or routing."""
    findings, seen, reported = [], set(), set()
    for wire in _seq(wires):
        key = _wire_declaration_key(wire)
        if key is None:
            continue
        if key in seen and key not in reported:
            reported.add(key)
            from_id, to_id = json.loads(key)[:2]
            findings.append(Finding("duplicate-wire", f"wire {from_id!r} -> {to_id!r} is declared more than once with the same type, label and routing options", f"{path_prefix}.wires"))
        seen.add(key)
    return findings


def _lint_duplicate_boundaries(boundaries, path_prefix: str) -> list[Finding]:
    """Boundary ids address a trust scope, so two scopes sharing one id are ambiguous."""
    findings, seen, reported = [], set(), set()
    for boundary in _seq(boundaries):
        ident = _map(boundary).get("id")
        if not isinstance(ident, str):
            continue
        if ident in seen and ident not in reported:
            reported.add(ident)
            findings.append(Finding("duplicate-boundary-id", f"boundary id {ident!r} is used more than once in this state", f"{path_prefix}.boundaries"))
        seen.add(ident)
    return findings


def _lint_state(state: dict, known_ids: set, package_ids: set, path_prefix: str, duplicates: bool = True) -> list[Finding]:
    findings = []
    if not isinstance(state, dict):
        return findings
    nodes = _seq(state.get("nodes"))
    node_ids = _node_ids(nodes)
    if duplicates:
        findings += _lint_duplicate_nodes(nodes, path_prefix)
        findings += _lint_duplicate_boundaries(state.get("boundaries"), path_prefix)
        findings += _lint_duplicate_wires(state.get("wires"), path_prefix)
    for nid in sorted(node_ids):
        if nid not in known_ids:
            findings.append(Finding("unknown-catalog-ref", f"node {nid!r} is not a catalog or package id", f"{path_prefix}.nodes"))
    findings += _lint_frozen_field_overrides(nodes, path_prefix)
    findings += _lint_wires(state.get("wires"), known_ids, node_ids, path_prefix)
    for changed_id in _ids(state.get("changed")):
        if changed_id not in node_ids:
            findings.append(Finding("bad-changed-ref", f"changed id {changed_id!r} is not in this state's nodes", f"{path_prefix}.changed"))
    for boundary in _seq(state.get("boundaries")):
        for member in _ids(_map(boundary).get("contains")):
            if member not in known_ids:
                findings.append(Finding("unknown-catalog-ref", f"boundary {_map(boundary).get('id')!r} contains unknown id {member!r}", f"{path_prefix}.boundaries"))
    for pkg_id in _ids(state.get("expandedPackages")):
        if pkg_id not in package_ids:
            findings.append(Finding(
                "expanded-package-not-package",
                f"expandedPackages id {pkg_id!r} is not a package id",
                f"{path_prefix}.expandedPackages",
            ))
    return findings


def _wire_identity(value) -> tuple | None:
    try:
        wire = parse_wire_shorthand(value) if isinstance(value, str) else value
    except (AttributeError, TypeError, ValueError):
        return None
    if not isinstance(wire, dict) or not isinstance(wire.get("from"), str) or not isinstance(wire.get("to"), str):
        return None
    wire_type = wire.get("type", "data")
    return wire.get("from"), wire.get("to"), wire_type if isinstance(wire_type, str) else "data"


def _lint_steps(steps_doc: dict, known_ids: set, package_ids: set, path_prefix: str) -> list[Finding]:
    findings = []
    if not isinstance(steps_doc, dict) or not isinstance(steps_doc.get("base"), dict):
        findings.append(Finding("step-base-required", "steps.base is required and must be a full state", f"{path_prefix}.base"))
        return findings
    base = copy.deepcopy(steps_doc["base"])
    sequence = _seq(steps_doc.get("sequence"))
    findings += _lint_state(base, known_ids, package_ids, f"{path_prefix}.base")
    if len(sequence) < 1:
        findings.append(Finding("step-sequence-too-short", "steps.sequence must contain at least one step", f"{path_prefix}.sequence"))
    current = base
    seen_step_ids = set()
    for index, step in enumerate(sequence):
        path = f"{path_prefix}.sequence[{index}]"
        if not isinstance(step, dict):
            continue
        step_id = step.get("id")
        if isinstance(step_id, str):
            if step_id in seen_step_ids:
                findings.append(Finding("duplicate-id", f"step id {step_id!r} appears more than once", f"{path}.id"))
            seen_step_ids.add(step_id)
        findings += _lint_duplicate_boundaries(step.get("boundaries"), path)
        current_nodes = _node_ids(current.get("nodes"))
        try:
            current_wires = normalize_wires(current.get("wires"))
        except ValueError:
            current_wires = []
        current_wire_keys = {_wire_identity(wire) for wire in current_wires}
        add = step.get("add") if isinstance(step.get("add"), dict) else {}
        remove = step.get("remove") if isinstance(step.get("remove"), dict) else {}
        overrides = step.get("set") if isinstance(step.get("set"), dict) else {}
        add_nodes = _seq(add.get("nodes"))
        add_wires = _seq(add.get("wires"))
        remove_nodes = set(_ids(remove.get("nodes")))
        remove_wires = _seq(remove.get("wires"))
        for node in add_nodes:
            node_id = _node_id(node)
            if node_id in current_nodes:
                findings.append(Finding("step-add-existing-node", f"step adds node {node_id!r}, but it already exists", f"{path}.add.nodes"))
        for node_id in remove_nodes:
            if node_id not in current_nodes:
                findings.append(Finding("step-remove-absent", f"step removes node {node_id!r}, but it is absent", f"{path}.remove.nodes"))
        for wire in remove_wires:
            identity = _wire_identity(wire)
            if identity is not None and identity not in current_wire_keys:
                findings.append(Finding("step-remove-absent", f"step removes wire {identity!r}, but it is absent", f"{path}.remove.wires"))
            if identity is not None and (identity[0] in remove_nodes or identity[1] in remove_nodes):
                findings.append(Finding("step-removes-connected-node", f"step removes a wire still connected to node(s) being removed", f"{path}.remove.wires"))
        for wire in add_wires:
            identity = _wire_identity(wire)
            if identity is not None and (identity[0] in remove_nodes or identity[1] in remove_nodes):
                findings.append(Finding("step-removes-connected-node", f"step adds a wire still connected to node(s) being removed", f"{path}.add.wires"))
        for node_id in _ids(step.get("changed")):
            if node_id in remove_nodes:
                findings.append(Finding("step-removes-connected-node", f"step marks removed node {node_id!r} as changed", f"{path}.changed"))
        for node_id in overrides:
            if node_id not in current_nodes:
                findings.append(Finding("step-set-unknown-node", f"step sets node {node_id!r}, but it is not present", f"{path}.set"))
            elif node_id in remove_nodes:
                findings.append(Finding("step-removes-connected-node", f"step sets node {node_id!r} while removing it", f"{path}.set"))

        current["nodes"] = [copy.deepcopy(node) for node in _seq(current.get("nodes")) if _node_id(node) not in remove_nodes]
        current["nodes"].extend(copy.deepcopy(add_nodes))
        remove_wire_keys = {_wire_identity(wire) for wire in remove_wires}
        retained_wires = []
        for wire in _seq(current.get("wires")):
            identity = _wire_identity(wire)
            if identity in remove_wire_keys or (identity is not None and (identity[0] in remove_nodes or identity[1] in remove_nodes)):
                continue
            retained_wires.append(copy.deepcopy(wire))
        retained_wires.extend(copy.deepcopy(add_wires))
        current["wires"] = retained_wires
        for node_id, override in overrides.items():
            for node_index, node in enumerate(current["nodes"]):
                if not isinstance(node_id, str) or _node_id(node) != node_id:
                    continue
                merged = {"id": node_id}
                merged.update(copy.deepcopy(override or {}))
                current["nodes"][node_index] = merged
                break
        for key in ("id", "title", "summary", "changes", "callout", "boundaries", "changed", "disclosure", "expandedPackages", "layout"):
            if key in step:
                current[key] = copy.deepcopy(step[key])
        findings += _lint_state(current, known_ids, package_ids, path, duplicates=False)
    return findings


def _lint_scenarios(scenarios_doc: dict, known_ids: set, package_ids: set, path_prefix: str) -> list[Finding]:
    findings = []
    if not isinstance(scenarios_doc, dict) or not isinstance(scenarios_doc.get("base"), dict):
        findings.append(Finding("scenario-base-required", "scenarios.base is required and must be a full state", f"{path_prefix}.base"))
        return findings
    variants = scenarios_doc.get("variants")
    if not isinstance(variants, list) or len(variants) < 1:
        findings.append(Finding("scenario-variants-too-short", "scenarios.variants must contain at least one variant", f"{path_prefix}.variants"))
        return findings
    base = copy.deepcopy(scenarios_doc["base"])
    base.setdefault("id", "base")
    findings += _lint_steps({"base": base, "sequence": variants}, known_ids, package_ids, path_prefix)
    return findings


def _flow_edge_key(edge: dict) -> tuple[str, str]:
    return edge.get("from"), edge.get("to")


def _lint_flow_step(step: dict, flow_wires: list[dict], flow_node_ids: set, seen_calls: set[tuple[str, str]], path: str) -> list[Finding]:
    findings = []
    if not isinstance(step, dict):
        return findings
    kind = step.get("kind", "call")

    def check_edge(text: str, edge_path: str) -> None:
        try:
            edge = parse_wire_shorthand(text)
        except (AttributeError, TypeError, ValueError):
            findings.append(Finding("flow-step-unknown-edge", f"flow step edge {text!r} is not a valid wire shorthand", edge_path))
            return
        key = _flow_edge_key(edge)
        known = {_flow_edge_key(wire) for wire in flow_wires if isinstance(wire.get("from"), str) and isinstance(wire.get("to"), str)}
        if key[0] not in flow_node_ids or key[1] not in flow_node_ids:
            findings.append(Finding("flow-step-unknown-edge", f"flow step edge {text!r} references a node not present in flow.nodes", edge_path))
            return
        reverse = (key[1], key[0])
        synthetic_loop = kind == "loop" and key[0] == key[1]
        pair_known = key in known or (kind == "return" and reverse in known)
        if not pair_known and not synthetic_loop:
            findings.append(Finding("flow-step-unknown-edge", f"flow step edge {text!r} is not present in flow.wires", edge_path))
        elif pair_known and not synthetic_loop:
            # The translator binds a step to a wire by endpoints *and* type; a typed wire
            # followed by an untyped step (or the reverse) leaves the step unbound.
            step_type = edge.get("type", "data")
            typed = {(w.get("from"), w.get("to"), w.get("type", "data")) for w in flow_wires if isinstance(w.get("from"), str) and isinstance(w.get("to"), str)}
            if (key[0], key[1], step_type) not in typed and not (kind == "return" and (reverse[0], reverse[1], step_type) in typed):
                findings.append(Finding("flow-step-wire-type-mismatch", f"flow step edge {text!r} has type {step_type!r} but the wire between those nodes has a different type; write the step with the wire's type prefix", edge_path))
        if kind == "return" and reverse not in seen_calls:
            findings.append(Finding("flow-return-no-forward", f"return edge {text!r} has no earlier forward call", edge_path))
        elif kind != "return" and key in known:
            seen_calls.add(key)

    if isinstance(step.get("edge"), str):
        check_edge(step["edge"], f"{path}.edge")
    elif isinstance(step.get("group"), list):
        for index, edge in enumerate(step["group"]):
            if isinstance(edge, str):
                check_edge(edge, f"{path}.group[{index}]")
    elif isinstance(step.get("parallel"), list):
        for index, child in enumerate(step["parallel"]):
            findings += _lint_flow_step(child, flow_wires, flow_node_ids, seen_calls, f"{path}.parallel[{index}]")
    else:
        findings.append(Finding("flow-step-empty", "flow step must contain edge, group, or parallel", path))
    return findings


def _lint_flow(flow: dict, known_ids: set, path_prefix: str) -> list[Finding]:
    findings = []
    if not isinstance(flow, dict):
        return findings
    node_ids = _node_ids(flow.get("nodes"))
    findings += _lint_duplicate_nodes(flow.get("nodes"), path_prefix)
    findings += _lint_duplicate_boundaries(flow.get("boundaries"), path_prefix)
    findings += _lint_duplicate_wires(flow.get("wires"), path_prefix)
    for node_id in sorted(node_ids):
        if node_id not in known_ids:
            findings.append(Finding("unknown-catalog-ref", f"node {node_id!r} is not a catalog or package id", f"{path_prefix}.nodes"))
    findings += _lint_frozen_field_overrides(_seq(flow.get("nodes")), path_prefix)
    try:
        wires = normalize_wires(flow.get("wires"))
    except ValueError as error:
        findings.append(Finding("wire-shorthand-parse-error", str(error), f"{path_prefix}.wires"))
        wires = []
    findings += _lint_wires(flow.get("wires"), known_ids, node_ids, path_prefix)
    for boundary in _seq(flow.get("boundaries")):
        for member in _ids(_map(boundary).get("contains")):
            if member not in known_ids:
                findings.append(Finding("unknown-catalog-ref", f"boundary {_map(boundary).get('id')!r} contains unknown id {member!r}", f"{path_prefix}.boundaries"))
    seen_calls: set[tuple[str, str]] = set()
    for index, step in enumerate(_seq(flow.get("steps"))):
        findings += _lint_flow_step(step, wires, node_ids, seen_calls, f"{path_prefix}.steps[{index}]")
    return findings


def _lint_deployment(view: dict, known_ids: set, path_prefix: str) -> list[Finding]:
    findings = []
    deployment = _map(view.get("deployment"))
    infrastructure = deployment.get("infrastructure")
    if not isinstance(infrastructure, dict) or not infrastructure:
        findings.append(Finding("deployment-infrastructure-empty", "deployment.infrastructure must be a non-empty map", f"{path_prefix}.deployment.infrastructure"))
        return findings
    parents: dict[str, list[str]] = {}
    for infra_id, infra in infrastructure.items():
        if not isinstance(infra, dict):
            continue
        for child in _ids(infra.get("children")):
            if child not in infrastructure:
                findings.append(Finding("deployment-unknown-infrastructure", f"infrastructure child {child!r} is not declared", f"{path_prefix}.deployment.infrastructure.{infra_id}.children"))
            else:
                parents.setdefault(child, []).append(infra_id)
    for child, infra_parents in parents.items():
        if len(infra_parents) > 1:
            findings.append(Finding("deployment-infrastructure-multiple-parents", f"infrastructure node {child!r} has multiple parents: {sorted(infra_parents)}", f"{path_prefix}.deployment.infrastructure.{child}"))
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(infra_id: str, trail: list[str]) -> None:
        if infra_id in visiting:
            cycle = trail[trail.index(infra_id):] if infra_id in trail else trail
            findings.append(Finding("deployment-infrastructure-cycle", f"infrastructure nesting contains a cycle: {' -> '.join(cycle)}", f"{path_prefix}.deployment.infrastructure.{infra_id}.children"))
            return
        if infra_id in visited or infra_id not in infrastructure:
            return
        visiting.add(infra_id)
        for child in _ids(_map(infrastructure.get(infra_id)).get("children")):
            visit(child, trail + [child])
        visiting.remove(infra_id)
        visited.add(infra_id)

    for infra_id in infrastructure:
        visit(infra_id, [infra_id])

    selected = _node_ids(view.get("nodes"))
    placements = _seq(deployment.get("placements"))
    placed: dict[str, int] = {}
    seen_placements: set[tuple[Any, Any]] = set()
    leaves = {infra_id for infra_id, infra in infrastructure.items() if not _map(infra).get("children")}
    for index, placement in enumerate(placements):
        if not isinstance(placement, dict):
            continue
        component, target = placement.get("component"), placement.get("target")
        if not isinstance(component, str) or not isinstance(target, str):
            continue  # the schema pass reports a placement without string ids
        path = f"{path_prefix}.deployment.placements[{index}]"
        placement_key = (component, target)
        if placement_key in seen_placements:
            findings.append(Finding("deployment-duplicate-placement", f"placement for component {component!r} on target {target!r} is repeated; combine replicas into one placement", path))
        seen_placements.add(placement_key)
        if component not in selected:
            findings.append(Finding("deployment-unknown-component", f"placement component {component!r} is not selected by the view", f"{path}.component"))
        if target not in infrastructure:
            findings.append(Finding("deployment-unknown-target", f"placement target {target!r} is not declared", f"{path}.target"))
        elif target not in leaves:
            findings.append(Finding("deployment-nonleaf-target", f"placement target {target!r} must be an infrastructure leaf", f"{path}.target"))
        replicas = placement.get("replicas", 1)
        if isinstance(replicas, bool) or not isinstance(replicas, int) or replicas < 1:
            findings.append(Finding("deployment-replica-invalid", "placement replicas must be a positive integer", f"{path}.replicas"))
        elif component in selected:
            placed[component] = placed.get(component, 0) + replicas
    for component in sorted(selected):
        if not placed.get(component):
            findings.append(Finding("deployment-unplaced-component", f"selected component {component!r} has no placement", f"{path_prefix}.deployment.placements"))
    return findings


def _lint_view(view: dict, known_ids: set, package_ids: set, path_prefix: str) -> list[Finding]:
    if not isinstance(view, dict):
        return [Finding("view-invalid", "view must be an object", path_prefix)]
    mode = view.get("mode")
    if mode == "system":
        state = copy.deepcopy(view)
        state.setdefault("id", view.get("id") or "only")
        return _lint_state(state, known_ids, package_ids, path_prefix)
    if mode == "transition":
        findings = []
        states = _seq(view.get("states"))
        if len(states) < 2:
            findings.append(Finding("transition-too-short", "view.states has fewer than 2 entries", f"{path_prefix}.states"))
        state_ids: set[Any] = set()
        for index, state in enumerate(states):
            state_id = state.get("id") if isinstance(state, dict) else None
            if isinstance(state_id, str) and state_id in state_ids:
                findings.append(Finding("duplicate-id", f"state id {state_id!r} appears more than once", f"{path_prefix}.states[{index}].id"))
            if isinstance(state_id, str):
                state_ids.add(state_id)
            findings += _lint_state(state, known_ids, package_ids, f"{path_prefix}.states[{index}]")
        return findings
    if mode == "steps":
        return _lint_steps(view, known_ids, package_ids, path_prefix)
    if mode == "scenarios":
        return _lint_scenarios(view, known_ids, package_ids, path_prefix)
    if mode == "flow":
        return _lint_flow(view, known_ids, path_prefix)
    if mode == "deployment":
        findings = _lint_state(view, known_ids, package_ids, path_prefix)
        findings += _lint_deployment(view, known_ids, path_prefix)
        return findings
    return [Finding("view-mode-required", "view.mode must be system, transition, steps, scenarios, flow, or deployment", f"{path_prefix}.mode")]


def _lint_comparison(doc: dict, view_ids: set[str]) -> list[Finding]:
    """Check cross-view comparison references that JSON Schema cannot express."""

    findings: list[Finding] = []
    comparison = (doc.get("meta") or {}).get("comparison") if isinstance(doc.get("meta"), dict) else None
    if comparison is None:
        return findings
    if not isinstance(doc.get("views"), list):
        findings.append(Finding("comparison-requires-views", "meta.comparison requires a v2 views bundle", "$.meta.comparison"))
        return findings
    criteria = comparison.get("criteria", []) if isinstance(comparison, dict) else []
    criterion_ids: set[str] = set()
    for index, criterion in enumerate(criteria if isinstance(criteria, list) else []):
        if not isinstance(criterion, dict):
            continue
        criterion_id = criterion.get("id")
        if isinstance(criterion_id, str) and criterion_id in criterion_ids:
            findings.append(Finding("comparison-duplicate-criterion", f"comparison criterion id {criterion_id!r} appears more than once", f"$.meta.comparison.criteria[{index}].id"))
        if isinstance(criterion_id, str):
            criterion_ids.add(criterion_id)
    recommended = comparison.get("recommended") if isinstance(comparison, dict) else None
    if isinstance(recommended, str) and recommended not in view_ids:
        findings.append(Finding("comparison-recommended-unknown", f"comparison recommended view {recommended!r} is not in views", "$.meta.comparison.recommended"))
    for index, view in enumerate(_seq(doc.get("views"))):
        if not isinstance(view, dict) or not isinstance(view.get("comparison"), dict):
            continue
        tradeoffs = view["comparison"].get("tradeoffs", {})
        if not isinstance(tradeoffs, dict):
            continue
        for criterion_id, tradeoff in tradeoffs.items():
            path = f"$.views[{index}].comparison.tradeoffs.{criterion_id}"
            if isinstance(criterion_id, str) and criterion_id not in criterion_ids:
                findings.append(Finding("comparison-criterion-unknown", f"view tradeoff refers to unknown comparison criterion {criterion_id!r}", path))
            if isinstance(tradeoff, dict) and "rating" in tradeoff:
                rating = tradeoff["rating"]
                if isinstance(rating, bool) or not isinstance(rating, (int, float)) or not 0 <= rating <= 5:
                    findings.append(Finding("comparison-rating-invalid", "comparison rating must be a number from 0 to 5", f"{path}.rating"))
    return findings


def _lint_navigation_targets(doc: dict, view_ids: set[str]) -> list[Finding]:
    """Validate v2 links against the bundle's stable view and package ids."""

    findings: list[Finding] = []
    package_ids = set(_map(doc.get("packages")))

    def check_catalog_entry(entry_id: str, entry: Any) -> None:
        if not isinstance(entry, dict):
            return
        path = f"$.catalog.{entry_id}"
        target = entry.get("navigateTo")
        if isinstance(target, str) and target not in view_ids:
            findings.append(Finding("navigation-target-unknown", f"catalog node {entry_id!r} navigates to unknown view {target!r}", f"{path}.navigateTo"))
        contained = entry.get("contains")
        if isinstance(contained, str) and contained not in package_ids and contained not in view_ids:
            findings.append(Finding("contains-target-unknown", f"catalog node {entry_id!r} contains unknown package or view {contained!r}", f"{path}.contains"))

    def check_node_entries(entries: Any, path: str) -> None:
        for index, entry in enumerate(_seq(entries)):
            if not isinstance(entry, dict):
                continue
            target = entry.get("navigateTo")
            if isinstance(target, str) and target not in view_ids:
                findings.append(Finding("navigation-target-unknown", f"node override navigates to unknown view {target!r}", f"{path}[{index}].navigateTo"))

    def check_step(step: Any, path: str) -> None:
        if not isinstance(step, dict):
            return
        target = step.get("navigateTo")
        if isinstance(target, str) and target not in view_ids:
            findings.append(Finding("navigation-target-unknown", f"step navigates to unknown view {target!r}", f"{path}.navigateTo"))
        for index, child in enumerate(_seq(step.get("parallel"))):
            check_step(child, f"{path}.parallel[{index}]")

    def check_state(state: Any, path: str) -> None:
        if not isinstance(state, dict):
            return
        target = state.get("navigateTo")
        if isinstance(target, str) and target not in view_ids:
            findings.append(Finding("navigation-target-unknown", f"state navigates to unknown view {target!r}", f"{path}.navigateTo"))
        check_node_entries(state.get("nodes"), f"{path}.nodes")

    def check_view(view: Any, path: str) -> None:
        if not isinstance(view, dict):
            return
        check_node_entries(view.get("nodes"), f"{path}.nodes")
        mode = view.get("mode")
        if mode == "transition":
            for index, state in enumerate(_seq(view.get("states"))):
                check_state(state, f"{path}.states[{index}]")
        elif mode == "steps":
            check_state(view.get("base"), f"{path}.base")
            for index, step in enumerate(_seq(view.get("sequence"))):
                check_step(step, f"{path}.sequence[{index}]")
        elif mode == "scenarios":
            check_state(view.get("base"), f"{path}.base")
            for index, step in enumerate(_seq(view.get("variants"))):
                check_step(step, f"{path}.variants[{index}]")
        elif mode == "flow":
            for index, step in enumerate(_seq(view.get("steps"))):
                check_step(step, f"{path}.steps[{index}]")

    for entry_id, entry in _map(doc.get("catalog")).items():
        check_catalog_entry(entry_id, entry)
    for index, view in enumerate(_seq(doc.get("views"))):
        check_view(view, f"$.views[{index}]")
    return findings


def _lint_package_graph(doc: dict) -> list[Finding]:
    findings = []
    packages = _map(doc.get("packages"))
    known_ids = _collect_known_ids(doc)
    parents = {}
    for package_id, package in packages.items():
        for child in _ids(_map(package).get("children")):
            if child in known_ids:
                parents.setdefault(child, []).append(package_id)

    for child, package_parents in parents.items():
        if len(package_parents) > 1:
            findings.append(Finding(
                "package-multiple-parents",
                f"package {child!r} is nested under multiple packages: {sorted(package_parents)}",
                f"$.packages.{child}",
            ))

    visiting = set()
    visited = set()

    def visit(package_id, trail):
        if package_id in visiting:
            cycle_start = trail.index(package_id)
            cycle = trail[cycle_start:]
            findings.append(Finding(
                "package-cycle",
                f"package nesting contains a cycle: {' -> '.join(cycle)}",
                f"$.packages.{package_id}.children",
            ))
            return
        if package_id in visited:
            return
        visiting.add(package_id)
        for child in _ids(_map(packages.get(package_id)).get("children")):
            if child in packages:
                visit(child, trail + [child])
        visiting.remove(package_id)
        visited.add(package_id)

    for package_id in packages:
        visit(package_id, [package_id])
    return findings


def run_lint_pass(doc: dict) -> list[Finding]:
    findings = []
    if not any(key in doc for key in ("system", "transition", "steps", "scenarios", "flow", "views")):
        findings.append(Finding("mode-required", "document has neither system:, transition:, steps:, scenarios:, flow:, nor views:", "$"))

    findings += _lint_duplicate_ids(doc)
    findings += _lint_icons_and_node_types(doc)
    findings += _lint_package_graph(doc)

    known_ids = _collect_known_ids(doc)
    package_ids = set(_map(doc.get("packages")))

    for pkg_id, pkg in _map(doc.get("packages")).items():
        for child in _ids(_map(pkg).get("children")):
            if child not in known_ids:
                findings.append(Finding("unknown-catalog-ref", f"package {pkg_id!r} child {child!r} is not a catalog or package id", f"$.packages.{pkg_id}.children"))

    if "views" in doc:
        views = doc.get("views") if isinstance(doc.get("views"), list) else []
        if not views:
            findings.append(Finding("views-required", "views must be a non-empty array", "$.views"))
        seen_view_ids = set()
        for index, view in enumerate(views):
            path = f"$.views[{index}]"
            view_id = view.get("id") if isinstance(view, dict) else None
            if isinstance(view_id, str):
                if view_id in seen_view_ids:
                    findings.append(Finding("duplicate-id", f"view id {view_id!r} appears more than once", f"{path}.id"))
                seen_view_ids.add(view_id)
            findings += _lint_view(view, known_ids, package_ids, path)
        findings += _lint_navigation_targets(doc, {view_id for view_id in seen_view_ids if isinstance(view_id, str)})
        findings += _lint_comparison(doc, {view_id for view_id in seen_view_ids if isinstance(view_id, str)})
        return findings

    if "system" in doc:
        findings += _lint_state(doc["system"], known_ids, package_ids, "$.system")

    if "transition" in doc:
        states = _seq(_map(doc["transition"]).get("states"))
        if len(states) < 2:
            findings.append(Finding("transition-too-short", "transition.states has fewer than 2 entries -- use system: instead", "$.transition.states"))
        seen_state_ids = set()
        for i, state in enumerate(states):
            sid = state.get("id") if isinstance(state, dict) else None
            if isinstance(sid, str) and sid in seen_state_ids:
                findings.append(Finding("duplicate-id", f"state id {sid!r} appears more than once", f"$.transition.states[{i}]"))
            if isinstance(sid, str):
                seen_state_ids.add(sid)
            findings += _lint_state(state, known_ids, package_ids, f"$.transition.states[{i}]")

    if "steps" in doc:
        findings += _lint_steps(doc["steps"], known_ids, package_ids, "$.steps")

    if "scenarios" in doc:
        findings += _lint_scenarios(doc["scenarios"], known_ids, package_ids, "$.scenarios")

    if "flow" in doc:
        findings += _lint_flow(doc["flow"], known_ids, "$.flow")

    return findings


def validate_document(doc: Any, schema: dict) -> list[Finding]:
    findings = run_schema_pass(doc, schema)
    if isinstance(doc, dict):
        try:
            findings += run_lint_pass(doc)
        except Exception as e:  # defensive: never let lint crash the CLI on malformed input
            findings.append(Finding("lint-internal-error", f"lint pass could not run: {e}", "$"))
    return findings


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Validate transition-diagram DSL documents.")
    parser.add_argument("files", nargs="+", help="YAML documents to validate")
    parser.add_argument("--schema", default=DEFAULT_SCHEMA_PATH, help="path to the JSON Schema file")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors")
    args = parser.parse_args(argv)

    try:
        schema = load_schema(args.schema)
        if not isinstance(schema, dict):
            raise ValueError("schema root must be an object")
        validator_cls = jsonschema.validators.validator_for(schema)
        validator_cls.check_schema(schema)
    except Exception as error:
        message = f"schema error: {error}"
        if args.format == "json":
            print(json.dumps({"tooling_error": message}, indent=2))
        else:
            print(message, file=sys.stderr)
        return 2
    exit_code = 0
    all_results = []

    for path in args.files:
        try:
            doc = load_document(path)
        except DuplicateKeyError as e:
            finding = Finding("duplicate-yaml-key", str(e), "$")
            exit_code = 1
            if args.format == "json":
                all_results.append({"file": path, "findings": [finding.as_dict()]})
            else:
                print(f"{path}: 1 error(s), 0 warning(s)")
                print(f"  [error] {finding.rule}: {finding.message} ({finding.path})")
            continue
        except yaml.YAMLError as error:
            finding = Finding("yaml-parse-error", str(error), "$")
            exit_code = 1
            if args.format == "json":
                all_results.append({"file": path, "findings": [finding.as_dict()]})
            else:
                print(f"{path}: 1 error(s), 0 warning(s)")
                print(f"  [error] {finding.rule}: {finding.message} ({finding.path})")
            continue
        except OSError as error:
            message = f"input error: {error}"
            exit_code = 2
            if args.format == "json":
                all_results.append({"file": path, "tooling_error": message, "findings": []})
            else:
                print(f"{path}: usage error: {error}", file=sys.stderr)
            continue

        try:
            findings = validate_document(doc, schema)
        except Exception as error:
            message = f"validation tooling error: {error}"
            exit_code = 2
            if args.format == "json":
                all_results.append({"file": path, "tooling_error": message, "findings": []})
            else:
                print(f"{path}: usage error: {message}", file=sys.stderr)
            continue
        errors = [f for f in findings if f.severity == "error"]
        warnings = [f for f in findings if f.severity == "warning"]

        if errors or (warnings and args.strict):
            exit_code = 1

        if args.format == "json":
            all_results.append({"file": path, "findings": [f.as_dict() for f in findings]})
        else:
            if findings:
                print(f"{path}: {len(errors)} error(s), {len(warnings)} warning(s)")
                for f in findings:
                    print(f"  [{f.severity}] {f.rule}: {f.message} ({f.path})")
            else:
                print(f"{path}: OK")

    if args.format == "json":
        print(json.dumps(all_results, indent=2))

    return exit_code


if __name__ == "__main__":
    sys.exit(main())
