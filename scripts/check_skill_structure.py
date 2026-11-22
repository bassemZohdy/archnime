#!/usr/bin/env python3
"""Minimal structural checks for the public diagram skills: four domain skills and their aggregator."""
from pathlib import Path
import json
import re
import sys

import yaml

ROOT = Path(__file__).resolve().parents[1]
SKILLS_DIR = ROOT / "skills"
SKILLS = (
    "archnime",
    "archnime-interview",
    "archnime-dsl",
    "archnime-renderer",
    "archnime-validation",
)

MANIFESTS = (
    ".claude-plugin/plugin.json",
    "plugin.json",
    "gemini-extension.json",
)


def check_plugin_manifests(failures):
    """One plugin named archnime, one version, in every tool's manifest and marketplace."""
    versions = {}
    for relative in MANIFESTS:
        path = ROOT / relative
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            failures.append(f"{relative}: cannot read manifest ({error})")
            continue
        if data.get("name") != "archnime":
            failures.append(f"{relative}: name must be archnime, found {data.get('name')!r}")
        versions[relative] = data.get("version")
    marketplaces = {
        ".claude-plugin/marketplace.json": lambda d: d.get("plugins", []),
        ".agents/plugins/marketplace.json": lambda d: d.get("plugins", []),
        ".github/plugin/marketplace.json": lambda d: d.get("plugins", []),
    }
    for relative, entries_of in marketplaces.items():
        try:
            data = json.loads((ROOT / relative).read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            failures.append(f"{relative}: cannot read marketplace ({error})")
            continue
        entries = [entry for entry in entries_of(data) if entry.get("name") == "archnime"]
        if len(entries) != 1:
            failures.append(f"{relative}: expected exactly one archnime entry, found {len(entries)}")
            continue
        if "version" in entries[0]:
            versions[relative] = entries[0]["version"]
        source = entries[0].get("source")
        path = source.get("path") if isinstance(source, dict) else source
        if path not in ("./", "."):
            failures.append(f"{relative}: the plugin lives at the repository root, source must be ./, found {path!r}")
    if len(set(versions.values())) > 1:
        failures.append(f"plugin versions differ between manifests: {versions}")
    elif not versions or None in versions.values():
        failures.append(f"every manifest needs a version: {versions}")


def main():
    failures = []
    check_plugin_manifests(failures)
    for name in SKILLS:
        skill_dir = SKILLS_DIR / name
        skill_md = skill_dir / "SKILL.md"
        agent = skill_dir / "agents" / "openai.yaml"
        if not skill_md.is_file():
            failures.append(f"{name}: missing SKILL.md")
            continue
        content = skill_md.read_text(encoding="utf-8")
        if not content.startswith("---\n") or content.count("\n---\n") < 1:
            failures.append(f"{name}: invalid frontmatter")
        else:
            frontmatter = content.split("---", 2)[1]
            if f"name: {name}" not in frontmatter:
                failures.append(f"{name}: frontmatter name mismatch")
            if "license: Apache-2.0" not in frontmatter:
                failures.append(f"{name}: missing Apache-2.0 license")
            # Hosts parse the frontmatter as YAML; an unquoted ": " in a description makes them drop every field.
            try:
                fields = yaml.safe_load(frontmatter)
            except yaml.YAMLError as error:
                failures.append(f"{name}: frontmatter is not valid YAML ({str(error).splitlines()[0]})")
            else:
                if not isinstance(fields, dict) or not all(isinstance(fields.get(key), str) and fields[key].strip() for key in ("name", "description")):
                    failures.append(f"{name}: frontmatter needs a name and a description as text")
        if not agent.is_file():
            failures.append(f"{name}: missing agents/openai.yaml")
        for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
            link = link.split("#", 1)[0].split("?", 1)[0]
            if not link or "://" in link or link.startswith(("mailto:", "#")):
                continue
            if not (skill_md.parent / link).resolve().is_file():
                failures.append(f"{name}: broken relative link {link}")
    actual = {p.parent.name for p in SKILLS_DIR.glob("*/SKILL.md")}
    if actual != set(SKILLS):
        failures.append(f"unexpected skill directories: {sorted(actual ^ set(SKILLS))}")
    for issue in failures:
        print("FAIL", issue, file=sys.stderr)
    if failures:
        return 1
    print(f"PASS {len(SKILLS)} diagram skill structures")
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
