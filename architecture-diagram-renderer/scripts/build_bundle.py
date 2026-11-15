"""Build an interactive architecture HTML bundle from a template and JSON model.

The template loads two scripts by relative path — ``architecture-library.js``
(icons, visual tokens) and ``diagram-engine.js`` (layout, self-check). By
default this builder keeps those links and copies the sidecars beside the
output for an editable multi-file bundle. Pass ``--inline`` for single-file
delivery with no local sidecars. The canonical template still loads D3, dagre,
ELK, GIF, and the GIF worker from configured runtime URLs, so inline output is
not intrinsically offline.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path


DATA_MARKER = "/* DATA"
RENDERER_START = "(function () {"
SIDECARS = ("architecture-library.js", "diagram-engine.js")


def _model_id(entry: object) -> str | None:
    return entry if isinstance(entry, str) else entry.get("id") if isinstance(entry, dict) else None


def _validate_portable_model(model: object) -> None:
    """Reject malformed renderer input before any output is published."""
    if not isinstance(model, dict):
        raise ValueError("model root must be a JSON object")
    if not isinstance(model.get("meta"), dict):
        raise ValueError("model.meta must be an object")
    if not isinstance(model.get("canvas"), dict):
        raise ValueError("model.canvas must be an object")
    if "catalog" in model and not isinstance(model.get("catalog"), dict):
        raise ValueError("model.catalog must be an object when provided")
    if "packages" in model and not isinstance(model.get("packages"), dict):
        raise ValueError("model.packages must be an object when provided")
    root_catalog = model.get("catalog") or {}
    root_packages = model.get("packages") or {}
    stages = model.get("stages")
    if stages is None and isinstance(model.get("views"), list):
        shared = model.get("shared") or {}
        if not isinstance(shared, dict) or not isinstance(shared.get("catalog", {}), dict) or not isinstance(shared.get("packages", {}), dict):
            raise ValueError("model.shared catalog and packages must be objects when provided")
        for index, view in enumerate(model["views"]):
            if not isinstance(view, dict) or not isinstance(view.get("stages"), list) or not view["stages"]:
                raise ValueError(f"model.views[{index}] must contain a non-empty stages array")
            catalog = {**root_catalog, **shared.get("catalog", {}), **(view.get("catalog") or {})}
            packages = {**root_packages, **shared.get("packages", {}), **(view.get("packages") or {})}
            _validate_stages(view["stages"], catalog, packages, f"model.views[{index}]")
        return
    if not isinstance(stages, list) or not stages:
        raise ValueError("model.stages must be a non-empty array")
    _validate_stages(stages, root_catalog, root_packages, "model")


def _validate_stages(stages: object, catalog: dict, packages: dict, path: str) -> None:
    known = set(catalog) | set(packages)
    for index, stage in enumerate(stages):
        if not isinstance(stage, dict) or not isinstance(stage.get("nodes"), list) or not isinstance(stage.get("wires"), list):
            raise ValueError(f"{path}.stages[{index}] must contain nodes and wires arrays")
        node_ids = {_model_id(entry) for entry in stage["nodes"]}
        if None in node_ids or not node_ids <= known:
            unknown = sorted(str(item) for item in node_ids - known if item is not None)
            raise ValueError(f"{path}.stages[{index}] contains undeclared node id(s): {', '.join(unknown) or 'invalid node'}")
        for wire_index, wire in enumerate(stage["wires"]):
            if not isinstance(wire, dict) or not isinstance(wire.get("from"), str) or not isinstance(wire.get("to"), str):
                raise ValueError(f"{path}.stages[{index}].wires[{wire_index}] must contain string from/to endpoints")
            if wire["from"] not in node_ids or wire["to"] not in node_ids:
                missing = [endpoint for endpoint in (wire["from"], wire["to"]) if endpoint not in node_ids]
                raise ValueError(
                    f"{path}.stages[{index}].wires[{wire_index}] references node id(s) not present in that stage: {', '.join(dict.fromkeys(missing))}"
                )


def _safe_json_payload(model: object) -> str:
    """Serialize JSON for an application/json script without HTML breakouts."""
    return (
        json.dumps(model, ensure_ascii=False, indent=2)
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace("\u2028", "\\u2028")
        .replace("\u2029", "\\u2029")
    )


def _inline_sidecars(prefix: str, template_dir: Path) -> str:
    for name in SIDECARS:
        tag = f'<script src="./{name}"></script>'
        if tag not in prefix:
            continue
        source = template_dir / name
        if not source.is_file():
            raise FileNotFoundError(f"cannot inline missing sidecar: {source}")
        body = source.read_text(encoding="utf-8")
        prefix = prefix.replace(tag, f"<script>\n/* {name} (inlined) */\n{body}\n</script>")
    return prefix


def build_bundle(template_path: Path, model_path: Path, output_path: Path, *, inline: bool = False, link: bool | None = None) -> None:
    # ``link`` is retained as a small API compatibility shim for callers of the
    # pre-F3 builder. New callers should use the positive ``inline`` flag.
    if link is not None:
        inline = not link
    template = template_path.read_text(encoding="utf-8")
    model = json.loads(model_path.read_text(encoding="utf-8"))
    _validate_portable_model(model)

    if template.count(DATA_MARKER) != 1 or template.count(RENDERER_START) != 1:
        raise ValueError("template must contain exactly one DATA marker and renderer start")
    missing_sidecars = [str(template_path.parent / name) for name in SIDECARS if not (template_path.parent / name).is_file()]
    if missing_sidecars:
        raise FileNotFoundError(f"cannot build bundle; missing required sidecar(s): {', '.join(missing_sidecars)}")
    marker_index = template.index(DATA_MARKER)
    data_script_index = template.rfind("<script>", 0, marker_index)
    renderer_index = template.index(RENDERER_START, data_script_index)
    renderer_end = template.index("</script>", renderer_index)

    prefix = template[:data_script_index]
    renderer = template[renderer_index:renderer_end]
    suffix = template[renderer_end:]
    payload = _safe_json_payload(model)
    bundle = (
        '<script type="application/json" id="diagram-model">\n'
        f"{payload}\n"
        "</script>\n"
        "<script>\n"
        "/* DATA — keep this identical to the portable JSON model beside the output. */\n"
        'const MODEL = JSON.parse(document.getElementById("diagram-model").textContent);\n'
        f"{renderer}"
        f"{suffix}"
    )

    if inline:
        prefix = _inline_sidecars(prefix, template_path.parent)

    output_path.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=f".{output_path.stem}-bundle-", dir=output_path.parent))
    published: list[Path] = []
    backups: dict[Path, Path] = {}
    try:
        staged_html = staging / output_path.name
        staged_html.write_text(prefix + bundle, encoding="utf-8", newline="")
        staged_sidecars: list[tuple[Path, Path]] = []
        if not inline:
            for name in SIDECARS:
                source = template_path.parent / name
                target = output_path.parent / name
                if source.resolve() != target.resolve():
                    staged = staging / name
                    shutil.copyfile(source, staged)
                    staged_sidecars.append((staged, target))
        targets = [output_path, *(target for _staged, target in staged_sidecars)]
        for target in targets:
            if target.exists():
                backup = staging / f"backup-{len(backups)}"
                shutil.copyfile(target, backup)
                backups[target] = backup
        os.replace(staged_html, output_path)
        published.append(output_path)
        for staged, target in staged_sidecars:
            os.replace(staged, target)
            published.append(target)
    except Exception:
        for target in reversed(published):
            backup = backups.get(target)
            try:
                if backup and backup.exists():
                    os.replace(backup, target)
                elif target.exists():
                    target.unlink()
            except OSError:
                pass
        raise
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def main() -> None:
    if sys.version_info < (3, 10):
        print("build_bundle.py requires Python 3.10+. No pip package is required; install a newer Python interpreter. For the browser equivalent, use architecture-diagram-renderer/assets/translate.html.", file=sys.stderr)
        raise SystemExit(2)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--inline", action="store_true", help="inline the engine and library into one self-contained HTML file")
    group.add_argument("--link", action="store_true", help="deprecated compatibility alias; linked sidecars are the default")
    args = parser.parse_args()
    try:
        build_bundle(args.template, args.model, args.output, inline=args.inline)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"build failed: {error}", file=sys.stderr)
        raise SystemExit(2)
    print(f"built {args.output}")


if __name__ == "__main__":
    main()
