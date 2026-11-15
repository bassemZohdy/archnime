#!/usr/bin/env python3
"""Minimal structural checks for the public diagram skills: four domain skills and their aggregator."""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
SKILLS = (
    "architecture-diagram",
    "architecture-diagram-interview",
    "architecture-diagram-dsl",
    "architecture-diagram-renderer",
    "architecture-diagram-validation",
)

def main():
    failures = []
    for name in SKILLS:
        skill_dir = ROOT / name
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
        if not agent.is_file():
            failures.append(f"{name}: missing agents/openai.yaml")
        for link in re.findall(r"\[[^\]]+\]\(([^)]+)\)", content):
            link = link.split("#", 1)[0].split("?", 1)[0]
            if not link or "://" in link or link.startswith(("mailto:", "#")):
                continue
            if not (skill_md.parent / link).resolve().is_file():
                failures.append(f"{name}: broken relative link {link}")
    actual = {p.parent.name for p in ROOT.glob("*/SKILL.md")}
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
