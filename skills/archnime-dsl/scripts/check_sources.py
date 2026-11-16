#!/usr/bin/env python3
"""
Check that the code behind a diagram is still there.

Every catalog entry, node override, wire mapping and flow step may name a
`source`: the file that backs it, optionally a line and a few quoted words
from that line (`src/api.py:42#db.insert(order)` or
`{ path: src/api.py, line: 42, quote: db.insert(order) }`). This check reads
each named file under --root and reports:

  source-path-unsafe        the path is absolute, leaves the root (also through
                            a link), enters .git or names a file that commonly
                            holds secrets; the file is never opened
  source-missing            no file at that path
  source-line-out-of-range  the line is past the end of the file
  source-quote-missing      the quoted words are no longer in the file
                            (whitespace-insensitive)

It keeps only whether each file holds the words; nothing is printed from the
files themselves. The check cannot see what the code gained: walk the code
again for new parts.

Usage:
  python3 check_sources.py diagram.yaml [more.yaml ...] [--root DIR] [--format text|json]

Exit codes: 0 = every source holds, 1 = findings, 2 = usage/tooling error.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

import yaml  # noqa: E402

from validate_transition_diagram import (  # noqa: E402
    DuplicateKeyError,
    Finding,
    collect_sources,
    load_document,
    source_path_problem,
)

MAX_BYTES = 4 * 1024 * 1024


def _squash(text: str) -> str:
    return " ".join(text.split())


def check_source(entry: dict, root: Path) -> list[Finding]:
    path_text, line, quote, where = entry["path"], entry.get("line"), entry.get("quote"), entry["where"]
    problem = source_path_problem(path_text)
    if problem:
        return [Finding("source-path-unsafe", f"source {path_text!r} {problem}; it was not read", where)]
    root_resolved = root.resolve()
    target = (root / path_text.replace("\\", "/"))
    try:
        resolved = target.resolve()
    except OSError as error:
        return [Finding("source-missing", f"source {path_text!r} cannot be resolved: {error}", where)]
    if resolved != root_resolved and root_resolved not in resolved.parents:
        return [Finding("source-path-unsafe", f"source {path_text!r} leads outside the root through a link; it was not read", where)]
    relative = resolved.relative_to(root_resolved).as_posix() if resolved != root_resolved else ""
    if relative and source_path_problem(relative):
        return [Finding("source-path-unsafe", f"source {path_text!r} resolves to {relative!r}, which {source_path_problem(relative)}; it was not read", where)]
    if not resolved.is_file():
        return [Finding("source-missing", f"source file {path_text!r} is gone", where)]
    if line is None and quote is None:
        return []
    try:
        if resolved.stat().st_size > MAX_BYTES:
            return [Finding("source-quote-missing", f"source file {path_text!r} is over {MAX_BYTES // (1024 * 1024)} MB and was not searched", where, "warning")]
        text = resolved.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        return [Finding("source-missing", f"source file {path_text!r} cannot be read: {error}", where)]
    findings = []
    lines = text.splitlines()
    if line is not None and line > len(lines):
        findings.append(Finding("source-line-out-of-range", f"source {path_text!r} names line {line}, but the file has {len(lines)}", where))
    if quote is not None and _squash(quote) not in _squash(text):
        findings.append(Finding("source-quote-missing", f"source {path_text!r} no longer holds the words {quote!r}", where))
    return findings


def check_document(doc, root: Path) -> list[Finding]:
    findings = []
    for entry in collect_sources(doc):
        if entry.get("error"):
            findings.append(Finding("schema", entry["error"], entry["where"]))
            continue
        findings += check_source(entry, root)
    return findings


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check that every source a diagram names still holds its file and words.")
    parser.add_argument("files", nargs="+", help="YAML documents to check")
    parser.add_argument("--root", default=".", help="project folder the sources are relative to (default: current folder)")
    parser.add_argument("--format", choices=["text", "json"], default="text")
    args = parser.parse_args(argv)
    root = Path(args.root)
    if not root.is_dir():
        print(f"usage error: root {args.root!r} is not a folder", file=sys.stderr)
        return 2
    exit_code, results = 0, []
    for path in args.files:
        try:
            doc = load_document(path)
        except (DuplicateKeyError, yaml.YAMLError, OSError) as error:
            print(f"{path}: usage error: {error}", file=sys.stderr)
            exit_code = 2
            continue
        findings = check_document(doc, root)
        sources = len(collect_sources(doc))
        if any(f.severity == "error" for f in findings) and exit_code == 0:
            exit_code = 1
        if args.format == "json":
            results.append({"file": path, "sources": sources, "findings": [f.as_dict() for f in findings]})
        elif findings:
            print(f"{path}: {len(findings)} finding(s) in {sources} source(s)")
            for f in findings:
                print(f"  [{f.severity}] {f.rule}: {f.message} ({f.path})")
        else:
            print(f"{path}: OK ({sources} source(s) hold)")
    if args.format == "json":
        print(json.dumps(results, indent=2))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
