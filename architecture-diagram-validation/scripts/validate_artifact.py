#!/usr/bin/env python3
"""Validate an arbitrary architecture YAML, portable model JSON, or HTML bundle.

This is a semantic/structural gate.  It deliberately does not turn a missing
browser, ELK runtime, or visual review into a pass; those checks belong to the
renderer harness and are reported as explicit limitations there.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[2]
DSL_VALIDATOR = ROOT / "architecture-diagram-dsl" / "scripts" / "validate_transition_diagram.py"
BUILDER = ROOT / "architecture-diagram-renderer" / "scripts" / "build_bundle.py"
MODEL_SCRIPT_RE = re.compile(r"<script\b[^>]*\bid=[\"']diagram-model[\"'][^>]*>(.*?)</script>", re.IGNORECASE | re.DOTALL)


def _load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load validation module: {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def _base_report(path: Path, kind: str) -> dict[str, Any]:
    return {
        "status": "PASS",
        "input": str(path.resolve()),
        "kind": kind,
        "checks": [],
        "limitations": [],
    }


def _yaml_report(path: Path) -> dict[str, Any]:
    report = _base_report(path, "architecture-yaml")
    try:
        validator = _load_module(DSL_VALIDATOR, "architecture_diagram_dsl_validator")
        schema = validator.load_schema(validator.DEFAULT_SCHEMA_PATH)
        document = validator.load_document(path)
        findings = validator.validate_document(document, schema)
    except (ImportError, ModuleNotFoundError) as error:
        report["status"] = "SKIP"
        report["limitations"].append(f"canonical YAML validator unavailable: {error}")
        return report
    except SystemExit:
        # The DSL validator exits the process, after naming the install command, when
        # pyyaml or jsonschema is missing. That is an environment limitation, not a crash.
        report["status"] = "SKIP"
        report["limitations"].append("canonical YAML validator unavailable: a Python dependency is missing (pip install -r requirements-dev.txt)")
        return report
    except Exception as error:
        report["status"] = "FAIL"
        report["checks"].append({"name": "canonical-yaml-validation", "status": "FAIL", "message": str(error)})
        return report

    finding_data = [finding.as_dict() for finding in findings]
    report["checks"].append({
        "name": "canonical-yaml-validation",
        "status": "PASS" if not finding_data else "FAIL",
        "findings": finding_data,
    })
    if finding_data:
        report["status"] = "FAIL"
    return report


def _validate_model(model: object, source: Path) -> dict[str, Any]:
    report = _base_report(source, "portable-model-json")
    try:
        builder = _load_module(BUILDER, "architecture_diagram_bundle_builder")
        builder._validate_portable_model(model)
    except Exception as error:
        report["status"] = "FAIL"
        report["checks"].append({"name": "portable-model-validation", "status": "FAIL", "message": str(error)})
        return report
    report["checks"].append({"name": "portable-model-validation", "status": "PASS"})
    return report


def _json_report(path: Path) -> dict[str, Any]:
    try:
        model = json.loads(path.read_text(encoding="utf-8"))
    except Exception as error:
        report = _base_report(path, "portable-model-json")
        report["status"] = "FAIL"
        report["checks"].append({"name": "json-parse", "status": "FAIL", "message": str(error)})
        return report
    return _validate_model(model, path)


def _html_report(path: Path) -> dict[str, Any]:
    report = _base_report(path, "rendered-html")
    try:
        html = path.read_text(encoding="utf-8")
    except Exception as error:
        report["status"] = "FAIL"
        report["checks"].append({"name": "html-read", "status": "FAIL", "message": str(error)})
        return report
    match = MODEL_SCRIPT_RE.search(html)
    if not match:
        report["status"] = "UNSUPPORTED"
        report["limitations"].append("HTML does not contain the portable diagram-model JSON script")
        return report
    try:
        model = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        report["status"] = "FAIL"
        report["checks"].append({"name": "embedded-model-json", "status": "FAIL", "message": str(error)})
        return report
    report = _validate_model(model, path)
    report["kind"] = "rendered-html"
    report["limitations"].append("semantic HTML inspection only; browser geometry and interaction require the renderer harness")
    return report


def validate(path: Path) -> dict[str, Any]:
    if not path.exists():
        report = _base_report(path, "unknown")
        report["status"] = "FAIL"
        report["checks"].append({"name": "input-exists", "status": "FAIL", "message": "input does not exist"})
        return report
    suffix = path.suffix.lower()
    if suffix in {".yaml", ".yml"}:
        return _yaml_report(path)
    if suffix == ".json":
        return _json_report(path)
    if suffix in {".html", ".htm"}:
        return _html_report(path)
    report = _base_report(path, "unknown")
    report["status"] = "UNSUPPORTED"
    report["limitations"].append(f"unsupported input suffix: {suffix or '<none>'}")
    return report


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path, help="an arbitrary YAML, portable JSON model, or generated HTML bundle")
    parser.add_argument("--format", choices=["json", "text"], default="json")
    args = parser.parse_args(argv)
    report = validate(args.input)
    if args.format == "json":
        print(json.dumps(report, indent=2, ensure_ascii=False))
    else:
        print(f"{report['status']}: {report['input']} ({report['kind']})")
        for check in report["checks"]:
            print(f"  {check['status']}: {check['name']}")
            if check.get("message"):
                print(f"    {check['message']}")
            for finding in check.get("findings", []):
                print(f"    [{finding.get('severity', 'error')}] {finding['rule']}: {finding['message']} ({finding.get('path', '')})")
        for limitation in report["limitations"]:
            print(f"  LIMITATION: {limitation}")
    return {"PASS": 0, "FAIL": 1, "SKIP": 2, "UNSUPPORTED": 3}[report["status"]]


if __name__ == "__main__":
    raise SystemExit(main())
