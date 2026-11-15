#!/usr/bin/env python3
"""Regenerate or verify renderer fixtures derived from DSL examples."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
TRANSLATOR = ROOT / "architecture-diagram-dsl" / "scripts" / "translate_transition_diagram.py"
FIXTURES = ROOT / "architecture-diagram-renderer" / "tests" / "fixtures"
SHIPPED_EXAMPLES = ROOT / "architecture-diagram-renderer" / "assets" / "examples"

# Keep this list explicit: every generated fixture must have a named semantic
# source, while the remaining fixtures stay intentionally hand-authored.
GENERATED_PAIRS = (
    ("checkout-flow.yaml", FIXTURES, "checkout-flow.json"),
    ("commerce-views.yaml", FIXTURES, "commerce-views.json"),
    ("orders-failover-scenarios.yaml", FIXTURES, "orders-failover-scenarios.json"),
    # The shipped example models are what the renderer guide tells readers to copy,
    # so they must stay in step with the DSL examples they come from.
    ("commerce-views.yaml", SHIPPED_EXAMPLES, "commerce-views.json"),
    ("comparison-views.yaml", SHIPPED_EXAMPLES, "comparison-views.json"),
)


def translated_json(source: Path) -> str:
    with tempfile.TemporaryDirectory(prefix="architecture-fixture-") as directory:
        output = Path(directory) / "model.json"
        result = subprocess.run(
            [sys.executable, str(TRANSLATOR), str(source), "--output", str(output)],
            cwd=ROOT,
            capture_output=True,
            text=True,
        )
        if result.returncode:
            message = result.stderr.strip() or result.stdout.strip() or "translator failed"
            raise RuntimeError(f"{source.relative_to(ROOT)}: {message}")
        return json.dumps(json.loads(output.read_text(encoding="utf-8")), ensure_ascii=False, indent=2) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--write",
        action="store_true",
        help="rewrite generated fixtures from their YAML sources; default is drift checking",
    )
    args = parser.parse_args()

    failures = 0
    examples = ROOT / "architecture-diagram-dsl" / "assets" / "examples"
    for source_name, directory, fixture_name in GENERATED_PAIRS:
        source = examples / source_name
        fixture = directory / fixture_name
        try:
            expected = translated_json(source)
        except (OSError, RuntimeError, json.JSONDecodeError) as error:
            print(f"ERROR {error}", file=sys.stderr)
            failures += 1
            continue

        if args.write:
            with fixture.open("w", encoding="utf-8", newline="") as stream:
                stream.write(expected)
            print(f"wrote {fixture.relative_to(ROOT)} from {source.relative_to(ROOT)}")
        elif not fixture.is_file():
            print(f"DRIFT missing {fixture.relative_to(ROOT)} (source: {source.relative_to(ROOT)})")
            failures += 1
        elif fixture.read_text(encoding="utf-8") != expected:
            print(f"DRIFT stale {fixture.relative_to(ROOT)} (run npm run regen-fixtures)")
            failures += 1
        else:
            print(f"ok {fixture.relative_to(ROOT)}")

    if failures:
        print(f"fixture check failed: {failures} issue(s)", file=sys.stderr)
        return 1
    print("fixture check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
