"""Build an interactive architecture HTML bundle from a template and JSON model.

The template loads two scripts by relative path — ``architecture-library.js``
(icons, visual tokens) and ``diagram-engine.js`` (layout, self-check). By
default this builder keeps those links and copies the sidecars beside the
output for an editable multi-file bundle. Pass ``--inline`` for single-file
delivery with no local sidecars. The canonical template still loads D3, dagre,
ELK, GIF, and the GIF worker from configured runtime URLs, so inline output is
not intrinsically offline. Pass ``--offline`` to use the vendored copies in
``<template dir>/vendor`` instead (each checked against its pinned hash), with the GIF
worker embedded in the page: nothing is then loaded from the network. ``--offline``
combines with ``--inline`` for one self-contained file.

Pass ``--geometry`` with the file ``store_geometry.mjs`` wrote for this model to
embed its layouts. The page then computes no placement and its dagre and ELK
script tags are left out. The geometry must have been computed from exactly this
model and this engine: a missing, unreadable or stale file fails the build, and
there is no fall-back to layout in the page.
"""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import re
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


GEOMETRY_FORMAT = "archnime-geometry/1"
# The libraries that only place nodes. A page with stored geometry does not load them.
LAYOUT_SCRIPT_RE = re.compile(r'<script src="https://[^"]*(?:dagre|elkjs)[^"]*"[^>]*></script>\r?\n?')
ENGINE_SOURCES = ("diagram-engine.js", "architecture-library.js")


class GeometryError(ValueError):
    """The geometry file is missing, unreadable, or was not computed from this model and engine."""


def _content_hash(*paths: Path) -> str:
    """sha256 of the files' text with line endings normalised, as store_geometry.mjs computes it."""
    digest = hashlib.sha256()
    for path in paths:
        digest.update(path.read_bytes().decode("utf-8").replace("\r\n", "\n").encode("utf-8"))
    return digest.hexdigest()


def _load_geometry(geometry_path: Path, model_path: Path, template_dir: Path) -> dict:
    again = f"run: node archnime-renderer/scripts/store_geometry.mjs {model_path} --output {geometry_path}"
    if not geometry_path.is_file():
        raise GeometryError(f"geometry file {geometry_path} is missing; layout is computed at build time, so {again}")
    try:
        geometry = json.loads(geometry_path.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise GeometryError(f"geometry file {geometry_path} is not readable JSON ({error}); {again}") from error
    if not isinstance(geometry, dict) or geometry.get("format") != GEOMETRY_FORMAT:
        raise GeometryError(f"geometry file {geometry_path} is not in the {GEOMETRY_FORMAT} format; {again}")
    # A plain model stores { states, layouts }; a multi-view bundle stores one of those per view id.
    parts = list(geometry["views"].values()) if isinstance(geometry.get("views"), dict) and geometry["views"] else [geometry]
    if any(not isinstance(part, dict) or not isinstance(part.get("states"), dict) or not isinstance(part.get("layouts"), list) or not part["layouts"] for part in parts):
        raise GeometryError(f"geometry file {geometry_path} holds no layouts; {again}")
    if geometry.get("modelSha256") != _content_hash(model_path):
        raise GeometryError(f"geometry file {geometry_path} is stale: it was computed from a different version of {model_path}; {again}")
    if geometry.get("engineSha256") != _content_hash(*(template_dir / name for name in ENGINE_SOURCES)):
        raise GeometryError(f"geometry file {geometry_path} is stale: the layout engine has changed since it was computed; {again}")
    if "views" in geometry:
        return {"views": {view_id: {"states": part["states"], "layouts": part["layouts"]} for view_id, part in geometry["views"].items()}}
    return {"states": geometry["states"], "layouts": geometry["layouts"]}


def _safe_compact_json(value: object) -> str:
    """Compact JSON for an application/json script without HTML breakouts."""
    return (
        json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        .replace("<", "\\u003c")
        .replace(">", "\\u003e")
        .replace("&", "\\u0026")
        .replace(" ", "\\u2028")
        .replace(" ", "\\u2029")
    )


CDN_SCRIPT_RE = re.compile(r'<script src="(https://[^"]+)"[^>]*></script>')
GIF_WORKER_URL_RE = re.compile(r'const GIF_WORKER_CDN_URL = "https://[^"]+";')


class OfflineBuildError(ValueError):
    """The offline build cannot find or trust the vendored libraries it needs."""


def _sha384(data: bytes) -> str:
    return "sha384-" + base64.b64encode(hashlib.sha384(data).digest()).decode("ascii")


def _script_safe(source: str) -> str:
    """JavaScript that is placed inside a <script> element must not contain its terminator."""
    return source.replace("</script", "<\\/script").replace("<!--", "<\\!--")


def _offline_prefix(prefix: str, template_dir: Path, inline: bool) -> tuple[str, list[tuple[Path, str]]]:
    """Point every CDN <script> at its vendored copy and embed the GIF worker.

    Each vendored file is checked against the hash pinned in vendor/manifest.json first, so an
    offline bundle never carries a library that differs from the one the CDN serves.
    """
    vendor = template_dir / "vendor"
    manifest_path = vendor / "manifest.json"
    if not manifest_path.is_file():
        raise OfflineBuildError(f"offline build failed: {manifest_path} is missing (run archnime-renderer/scripts/vendor_assets.mjs)")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    by_source = {file["source"]: file for library in manifest["libraries"] for file in library["files"]}

    def checked(entry: dict) -> tuple[Path, bytes]:
        path = vendor / entry["file"]
        if not path.is_file():
            raise OfflineBuildError(f"offline build failed: vendored file {path} is missing")
        data = path.read_bytes()
        if _sha384(data) != entry["sha384"]:
            raise OfflineBuildError(f"offline build failed: vendored file {path} does not match its pinned hash")
        return path, data

    used: list[tuple[Path, str]] = []

    def replace(match: re.Match) -> str:
        url = match.group(1)
        entry = by_source.get(url)
        if entry is None:
            raise OfflineBuildError(f"offline build failed: no vendored copy of {url} in {manifest_path}")
        path, data = checked(entry)
        if path not in [item[0] for item in used]:
            used.append((path, entry["file"]))
        if inline:
            return f"<script>\n/* vendor/{entry['file']} (inlined) */\n{_script_safe(data.decode('utf-8'))}\n</script>"
        return f'<script src="./vendor/{entry["file"]}"></script>'

    prefix = CDN_SCRIPT_RE.sub(replace, prefix)
    worker = by_source.get("https://cdn.jsdelivr.net/npm/gif.js@0.2.0/dist/gif.worker.js")
    if worker is None:
        raise OfflineBuildError(f"offline build failed: {manifest_path} has no gif.worker.js entry")
    _path, worker_bytes = checked(worker)
    prefix += f'\n<script type="text/plain" id="gif-worker-source">{_script_safe(worker_bytes.decode("utf-8"))}</script>\n'
    return prefix, ([] if inline else [item for item in used if not item[1].endswith("gif.worker.js")])


def build_bundle(template_path: Path, model_path: Path, output_path: Path, *, inline: bool = False, link: bool | None = None, offline: bool = False, geometry_path: Path | None = None) -> None:
    # ``link`` is retained as a small API compatibility shim for callers of the
    # pre-F3 builder. New callers should use the positive ``inline`` flag.
    if link is not None:
        inline = not link
    template = template_path.read_text(encoding="utf-8")
    model = json.loads(model_path.read_text(encoding="utf-8"))
    _validate_portable_model(model)
    geometry = _load_geometry(geometry_path, model_path, template_path.parent) if geometry_path is not None else None

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
    geometry_script = ""
    if geometry is not None:
        if not LAYOUT_SCRIPT_RE.search(prefix):
            raise GeometryError("template has no dagre or ELK script tag to leave out; is this the archnime-renderer template?")
        prefix = LAYOUT_SCRIPT_RE.sub("", prefix)
        geometry_script = f'<script type="application/json" id="diagram-geometry">{_safe_compact_json(geometry)}</script>\n'
    bundle = (
        f"{geometry_script}"
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
    vendor_files: list[tuple[Path, str]] = []
    if offline:
        prefix, vendor_files = _offline_prefix(prefix, template_path.parent, inline)
        # The embedded worker replaces the CDN fetch, so the constant must not name a CDN.
        bundle = GIF_WORKER_URL_RE.sub("const GIF_WORKER_CDN_URL = null; // offline build: the worker source is embedded in the page", bundle)

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
        for source, name in vendor_files:
            staged = staging / "vendor" / name
            staged.parent.mkdir(exist_ok=True)
            shutil.copyfile(source, staged)
            staged_sidecars.append((staged, output_path.parent / "vendor" / name))
        targets = [output_path, *(target for _staged, target in staged_sidecars)]
        for target in targets:
            if target.exists():
                backup = staging / f"backup-{len(backups)}"
                shutil.copyfile(target, backup)
                backups[target] = backup
        os.replace(staged_html, output_path)
        published.append(output_path)
        for staged, target in staged_sidecars:
            target.parent.mkdir(parents=True, exist_ok=True)
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
        print("build_bundle.py requires Python 3.10+. No pip package is required; install a newer Python interpreter. For the browser equivalent, use archnime-renderer/assets/translate.html.", file=sys.stderr)
        raise SystemExit(2)
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--template", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--inline", action="store_true", help="inline the engine and library into one self-contained HTML file")
    group.add_argument("--link", action="store_true", help="deprecated compatibility alias; linked sidecars are the default")
    parser.add_argument("--geometry", type=Path, help="embed the layouts store_geometry.mjs computed for this model; the page then loads no dagre or ELK and computes no placement. A missing or stale file fails the build")
    parser.add_argument("--offline", action="store_true", help="use the vendored libraries in <template dir>/vendor instead of CDN scripts, so the bundle needs no network (combine with --inline for one file)")
    args = parser.parse_args()
    try:
        build_bundle(args.template, args.model, args.output, inline=args.inline, offline=args.offline, geometry_path=args.geometry)
    except (OSError, ValueError, json.JSONDecodeError) as error:
        print(f"build failed: {error}", file=sys.stderr)
        raise SystemExit(2)
    print(f"built {args.output}")


if __name__ == "__main__":
    main()
