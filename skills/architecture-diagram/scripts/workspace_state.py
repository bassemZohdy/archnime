#!/usr/bin/env python3
"""Read a workspace and say which architecture-diagram skill should act next.

The aggregator skill uses this to decide instead of guessing. It walks a directory, finds the
artifacts of the diagram pipeline, links them by content, and reports one state per DSL source:

    DSL source -> renderer model (JSON) -> HTML bundle -> documentation snapshots

A model is "current" when it equals what the canonical translator produces from the source
today, a bundle when the model embedded in it does, and snapshots when their manifest was made
from that model and every file still matches its hash. Nothing is changed; it only reads, and it
runs the canonical validator and translator of the sibling skills rather than re-implementing them.

Usage:
  python workspace_state.py [--root DIR] [--format json|text] [--max-files N]

Exit codes: 0 report written, 2 usage error.
"""

from __future__ import annotations

import argparse
import copy
import hashlib
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

SKILLS_ROOT = Path(__file__).resolve().parents[2]
SKILLS = (
    "architecture-diagram-interview",
    "architecture-diagram-dsl",
    "architecture-diagram-renderer",
    "architecture-diagram-validation",
)
SHORT = {name.rsplit("-", 1)[-1]: name for name in SKILLS}

# The routing table. Every state the scanner can emit is here, owned by exactly one skill;
# test_skill_contract.py keeps SKILL.md's table in step with it.
STATES: dict[str, dict[str, str]] = {
    "empty": {"skill": SHORT["interview"], "summary": "No diagram source exists yet: elicit the architecture facts and choose a diagram type."},
    "tooling-missing": {"skill": SHORT["dsl"], "summary": "The validator's Python dependencies are missing, so no source can be checked."},
    "source-invalid": {"skill": SHORT["dsl"], "summary": "A DSL source has schema or lint findings: fix the source, never the rendering."},
    "model-missing": {"skill": SHORT["dsl"], "summary": "A valid source has no renderer model yet: translate it."},
    "model-stale": {"skill": SHORT["dsl"], "summary": "The renderer model no longer matches its source: translate again."},
    "bundle-missing": {"skill": SHORT["renderer"], "summary": "A current model has no HTML bundle: build the interactive presentation."},
    "bundle-stale": {"skill": SHORT["renderer"], "summary": "The HTML bundle embeds an older model than the current one: rebuild it."},
    "exports-missing": {"skill": SHORT["renderer"], "summary": "A current bundle has no documentation snapshots: batch-export every state."},
    "snapshots-stale": {"skill": SHORT["renderer"], "summary": "The snapshots were exported from an older model: export them again."},
    "snapshots-tampered": {"skill": SHORT["validation"], "summary": "A snapshot was edited, deleted or added after export: verify and report, then re-export."},
    "complete": {"skill": SHORT["validation"], "summary": "Source, model, bundle and snapshots are all current: review and report with evidence."},
}
# Most urgent first: the workspace's next step is the first state any source is in.
URGENCY = ["tooling-missing", "source-invalid", "model-missing", "model-stale", "bundle-missing", "bundle-stale", "exports-missing", "snapshots-stale", "snapshots-tampered", "complete"]

IGNORED_DIRECTORIES = {".git", ".hg", ".svn", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", "target", ".sandbox", ".tox", ".mypy_cache", ".pytest_cache", ".idea", ".vscode"}
SUFFIXES = {".yaml", ".yml", ".json", ".html", ".htm"}
MAX_FILE_BYTES = 24 * 1024 * 1024
SNAPSHOT_SCHEMA = "architecture-diagram-snapshots/1"
DSL_HEADER = re.compile(r"""^\s*["']?dsl["']?\s*:\s*["']?transition-diagram/\d""", re.MULTILINE)
EMBEDDED_MODEL = re.compile(r'<script type="application/json" id="diagram-model">\s*(.*?)\s*</script>', re.DOTALL)


def _posix(path: Path, root: Path) -> str:
    try:
        return path.resolve().relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.resolve().as_posix()


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _canonical(value: Any) -> Any:
    """Round-trip through JSON so a translated dict and a model read from disk compare equal."""
    return json.loads(json.dumps(value, ensure_ascii=False))


def _load_dsl_tools() -> tuple[Any, Any] | None:
    scripts = SKILLS_ROOT / SKILLS[1] / "scripts"
    if not scripts.is_dir():
        return None
    if str(scripts) not in sys.path:
        sys.path.insert(0, str(scripts))
    try:
        import translate_transition_diagram as translator  # noqa: PLC0415
        import validate_transition_diagram as validator  # noqa: PLC0415
    except (ImportError, SystemExit):  # the validator exits the process when pyyaml/jsonschema are missing
        return None
    return validator, translator


def tooling() -> dict[str, Any]:
    node = shutil.which("node")
    node_version = None
    if node:
        try:
            node_version = subprocess.run([node, "--version"], capture_output=True, text=True, timeout=15).stdout.strip() or None
        except (OSError, subprocess.SubprocessError):
            node_version = None
    return {
        "python": ".".join(map(str, sys.version_info[:3])),
        "yaml": importlib.util.find_spec("yaml") is not None,
        "jsonschema": importlib.util.find_spec("jsonschema") is not None,
        "node": node_version,
        "skills": {short: (SKILLS_ROOT / name).is_dir() for short, name in SHORT.items()},
    }


def _walk(root: Path, limit: int) -> tuple[list[Path], list[Path], bool]:
    """Candidate files and snapshot manifests under root; folders that hold a SKILL.md are skipped."""
    files: list[Path] = []
    manifests: list[Path] = []
    truncated = False
    stack = [root]
    while stack:
        directory = stack.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda entry: entry.name)
        except OSError:
            continue
        if directory != root and (directory / "SKILL.md").is_file():
            continue
        for entry in entries:
            if entry.is_symlink():
                continue
            if entry.is_dir():
                if entry.name not in IGNORED_DIRECTORIES:
                    stack.append(entry)
            elif entry.suffix.lower() in SUFFIXES:
                if len(files) >= limit:
                    truncated = True
                    continue
                if entry.name == "manifest.json":
                    manifests.append(entry)
                else:
                    files.append(entry)
    return files, manifests, truncated


def _read_text(path: Path) -> str | None:
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            return None
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError):
        return None


def verify_snapshots(directory: Path) -> list[str]:
    """The same contract as scripts/verify_snapshots.mjs, read-only: a list of problems."""
    try:
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        return [f"manifest.json could not be read: {error}"]
    problems: list[str] = []
    snapshots = manifest.get("snapshots")
    if not isinstance(snapshots, list) or not snapshots:
        return ["the manifest lists no snapshots"]
    listed: set[str] = set()
    for entry in snapshots:
        name = entry.get("file") if isinstance(entry, dict) else None
        if not isinstance(name, str) or not name or name != Path(name).name or "\\" in name or name in {".", "..", "manifest.json"}:
            problems.append(f"unsafe or missing file name {name!r}")
            continue
        listed.add(name)
        path = directory / name
        if not path.is_file():
            problems.append(f"{name}: missing")
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != entry.get("sha256"):
            problems.append(f"{name}: sha256 mismatch (the file was changed after export)")
        if len(data) != entry.get("bytes"):
            problems.append(f"{name}: size is {len(data)} bytes, the manifest says {entry.get('bytes')}")
    for path in sorted(directory.glob("*.svg")):
        if path.name not in listed:
            problems.append(f"{path.name}: not listed in the manifest")
    return problems


def _command(state: str, source: str, artifacts: dict[str, str | None], root: Path, plan: dict[str, str]) -> str | None:
    dsl, renderer, validation = (SKILLS_ROOT / SKILLS[1]).as_posix(), (SKILLS_ROOT / SKILLS[2]).as_posix(), (SKILLS_ROOT / SKILLS[3]).as_posix()
    model, bundle, snapshots = plan["model"], plan["bundle"], plan["snapshots"]
    if state == "source-invalid":
        return f"python {dsl}/scripts/validate_transition_diagram.py {source}"
    if state in {"model-missing", "model-stale"}:
        return f"python {dsl}/scripts/translate_transition_diagram.py {source} --output {model}"
    if state in {"bundle-missing", "bundle-stale"}:
        return f"python {renderer}/scripts/build_bundle.py --template {renderer}/assets/template.html --model {model} --output {bundle}"
    if state in {"exports-missing", "snapshots-stale"}:
        return f"node {renderer}/scripts/export_snapshots.mjs --model {model} --out {snapshots}"
    if state == "snapshots-tampered":
        return f"node {renderer}/scripts/verify_snapshots.mjs --dir {snapshots} --model {model}"
    if state == "complete":
        return f"python {validation}/scripts/validate_artifact.py {source} --format text"
    return None


def scan(root: Path, limit: int = 5000) -> dict[str, Any]:
    root = root.resolve()
    environment = tooling()
    files, manifests, truncated = _walk(root, limit)

    sources: list[Path] = []
    models: list[tuple[Path, Any]] = []
    bundles: list[tuple[Path, Any]] = []
    for path in files:
        text = _read_text(path)
        if text is None:
            continue
        suffix = path.suffix.lower()
        if suffix in {".yaml", ".yml", ".json"} and DSL_HEADER.search(text[:8192]):
            sources.append(path)
        elif suffix == ".json":
            try:
                data = json.loads(text)
            except ValueError:
                continue
            if isinstance(data, dict) and "meta" in data and "canvas" in data and ("stages" in data or "views" in data):
                models.append((path, _canonical(data)))
        elif suffix in {".html", ".htm"}:
            found = EMBEDDED_MODEL.search(text)
            if found:
                try:
                    bundles.append((path, _canonical(json.loads(found.group(1)))))
                except ValueError:
                    continue

    snapshot_directories: list[tuple[Path, dict[str, Any]]] = []
    for manifest_path in manifests:
        try:
            data = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if isinstance(data, dict) and data.get("schema") == SNAPSHOT_SCHEMA:
            snapshot_directories.append((manifest_path.parent, data))

    tools = _load_dsl_tools()
    schema = None
    if tools is not None:
        try:
            schema = tools[0].load_schema(tools[0].DEFAULT_SCHEMA_PATH)
        except Exception:  # noqa: BLE001 - a broken schema is reported as missing tooling
            tools = None

    items: list[dict[str, Any]] = []
    for path in sorted(sources):
        source = _posix(path, root)
        stem = path.stem
        plan = {
            "model": _posix(path.with_name(f"{stem}.model.json"), root),
            "bundle": _posix(path.with_name(f"{stem}.html"), root),
            "snapshots": _posix(path.with_name(f"{stem}-snapshots"), root),
        }
        item: dict[str, Any] = {"source": source, "artifacts": {"model": None, "bundle": None, "snapshots": None}}

        def finish(state: str, reason: str, **extra: Any) -> dict[str, Any]:
            item.update(state=state, skill=STATES[state]["skill"], summary=STATES[state]["summary"], reason=reason, command=_command(state, source, item["artifacts"], root, plan), **extra)
            return item

        if tools is None:
            items.append(finish("tooling-missing", "pyyaml and jsonschema (or the dsl skill's scripts) are not available to check this source", command_override=True))
            item["command"] = "python -m pip install -r requirements-dev.txt   # or: python -m pip install pyyaml jsonschema"
            continue
        validator, translator = tools
        try:
            document = validator.load_document(str(path))
            findings = validator.validate_document(document, schema)
            problems = [finding.as_dict() for finding in findings]
        except validator.DuplicateKeyError as error:
            document, problems = None, [{"rule": "duplicate-yaml-key", "message": str(error), "path": "$", "severity": "error"}]
        except Exception as error:  # noqa: BLE001 - YAML syntax errors and unreadable files are findings
            document, problems = None, [{"rule": "yaml-parse-error", "message": str(error).splitlines()[0] if str(error) else type(error).__name__, "path": "$", "severity": "error"}]
        if problems:
            items.append(finish("source-invalid", f"{len(problems)} finding(s); first: {problems[0]['rule']} at {problems[0]['path']}", findings=problems[:20]))
            continue

        translated = _canonical(translator.translate_document(copy.deepcopy(document)))
        fresh_model = next((model for model in models if model[1] == translated), None)
        if fresh_model is None:
            same_name = [model for model in models if model[0].parent == path.parent and model[0].name in {f"{stem}.model.json", f"{stem}-model.json", f"{stem}.json"}]
            if same_name:
                item["artifacts"]["model"] = _posix(same_name[0][0], root)
                plan["model"] = item["artifacts"]["model"]
                items.append(finish("model-stale", f"{item['artifacts']['model']} differs from what the translator produces from {source} today"))
            else:
                items.append(finish("model-missing", f"no renderer model equals the translation of {source}"))
            continue
        model_path = fresh_model[0]
        item["artifacts"]["model"] = plan["model"] = _posix(model_path, root)

        title = translated.get("meta", {}).get("title")
        fresh_bundle = next((bundle for bundle in bundles if bundle[1] == translated), None)
        if fresh_bundle is None:
            related = [bundle for bundle in bundles if bundle[0].stem == stem or bundle[1].get("meta", {}).get("title") == title]
            if related:
                item["artifacts"]["bundle"] = plan["bundle"] = _posix(related[0][0], root)
                items.append(finish("bundle-stale", f"{item['artifacts']['bundle']} embeds an older model than {item['artifacts']['model']}"))
            else:
                items.append(finish("bundle-missing", f"no HTML bundle embeds {item['artifacts']['model']}"))
            continue
        item["artifacts"]["bundle"] = plan["bundle"] = _posix(fresh_bundle[0], root)

        model_hash = _sha256(model_path)
        matching = [entry for entry in snapshot_directories if entry[1].get("source", {}).get("sha256") == model_hash]
        if matching:
            directory = matching[0][0]
            item["artifacts"]["snapshots"] = plan["snapshots"] = _posix(directory, root)
            problems_found = verify_snapshots(directory)
            if problems_found:
                items.append(finish("snapshots-tampered", f"{len(problems_found)} problem(s) in {item['artifacts']['snapshots']}", problems=problems_found))
            else:
                items.append(finish("complete", "source, model, bundle and snapshots are all current and verified"))
            continue
        older = [entry for entry in snapshot_directories if entry[1].get("source", {}).get("file") == model_path.name]
        if older:
            item["artifacts"]["snapshots"] = plan["snapshots"] = _posix(older[0][0], root)
            items.append(finish("snapshots-stale", f"{item['artifacts']['snapshots']} was exported from an older {model_path.name}"))
        else:
            items.append(finish("exports-missing", f"no snapshot directory was exported from {item['artifacts']['model']}"))

    if items:
        order = {state: index for index, state in enumerate(URGENCY)}
        first = min(items, key=lambda entry: (order[entry["state"]], entry["source"]))
        chosen = {"state": first["state"], "skill": first["skill"], "source": first["source"], "command": first["command"], "reason": first["reason"], "summary": first["summary"]}
    else:
        chosen = {"state": "empty", "skill": STATES["empty"]["skill"], "source": None, "command": None, "reason": f"no DSL source found under {root.as_posix()}", "summary": STATES["empty"]["summary"]}
    return {"root": root.as_posix(), "scanned": len(files) + len(manifests), "truncated": truncated, "tooling": environment, "items": items, "next": chosen}


def render_text(report: dict[str, Any]) -> str:
    lines = [f"Workspace: {report['root']} ({report['scanned']} candidate files{', truncated' if report['truncated'] else ''})"]
    tooling_info = report["tooling"]
    lines.append(f"Tooling: python {tooling_info['python']}, yaml={tooling_info['yaml']}, jsonschema={tooling_info['jsonschema']}, node={tooling_info['node'] or 'missing'}")
    for item in report["items"]:
        lines.append(f"- {item['source']}: {item['state']} -> {item['skill']}")
        lines.append(f"    {item['reason']}")
        if item.get("command"):
            lines.append(f"    $ {item['command']}")
    chosen = report["next"]
    lines.append(f"Next: {chosen['state']} -> {chosen['skill']}" + (f" ({chosen['source']})" if chosen["source"] else ""))
    lines.append(f"      {chosen['summary']}")
    if chosen.get("command"):
        lines.append(f"      $ {chosen['command']}")
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--root", type=Path, default=Path.cwd(), help="workspace folder to scan (default: the current folder)")
    parser.add_argument("--format", choices=["json", "text"], default="json")
    parser.add_argument("--max-files", type=int, default=5000, help="stop collecting candidate files after this many")
    args = parser.parse_args(argv)
    if not args.root.is_dir():
        print(f"workspace_state: {args.root} is not a folder", file=sys.stderr)
        return 2
    report = scan(args.root, args.max_files)
    sys.stdout.write(render_text(report) if args.format == "text" else json.dumps(report, indent=2, ensure_ascii=False) + "\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
