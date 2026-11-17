#!/usr/bin/env python3
"""
Print the DSL format from the copy of the skill that will read it.

  python3 spec_brief.py                  one complete small spec, then one line per other section
  python3 spec_brief.py --section flow   that section of references/dsl-reference.md, whole
  python3 spec_brief.py --list           the section names

Read the brief before writing a spec instead of writing from memory: it is the
format of this very validator, so a field it does not mention is not read.
The brief's example validates clean (a test keeps it so).

Exit codes: 0 = printed, 2 = unknown section.
"""
from __future__ import annotations

import argparse
import os
import re
import sys

SKILL_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REFERENCE = os.path.join(SKILL_DIR, "references", "dsl-reference.md")

BRIEF_EXAMPLE = """\
dsl: transition-diagram/1.0
meta:
  title: Checkout request
  evidence: code                       # code | document | interview
  reader:
    audience: engineers new to the checkout service
    questions:
      - Where does an order enter the system?
      - Which service writes the order?
      - What is refused, and where?
    idea: The gateway authenticates before anything is written.
    omitted: [metrics pipeline]
catalog:
  web: { label: Browser, type: actor }
  gateway: { label: API gateway, type: gateway, source: src/gateway/app.py }
  orders: { label: Orders service, type: service, source: src/orders/service.py }
  ordersdb: { label: Orders DB, type: database, source: "src/orders/db.py#CREATE TABLE orders" }
flow:
  title: Place an order
  nodes: [web, gateway, orders, ordersdb]
  boundaries:
    - { id: internal, label: Internal network, contains: [orders, ordersdb] }
  wires:
    - { from: web, to: gateway, label: POST /orders, flow: true, source: "src/gateway/app.py:12#@app.post(\\"/orders\\")" }
    - { from: gateway, to: orders, label: create order, flow: true, source: "src/gateway/app.py:20#orders.create(" }
    - { from: orders, to: ordersdb, label: INSERT, flow: true, source: "src/orders/service.py:31#db.insert(order)" }
  steps:
    - { title: Request, edge: "web => gateway", note: The browser posts the order. }
    - { title: Forward, edge: "gateway => orders" }
    - { title: Write, edge: "orders => ordersdb" }
    - { title: Reply, edge: "orders -> gateway", kind: return }
"""


def sections() -> list[tuple[str, str, str]]:
    """(name, heading, body) for each `## ` section of the DSL reference."""
    with open(REFERENCE, encoding="utf-8") as handle:
        text = handle.read()
    found = []
    for match in re.finditer(r"^## ([^\n]+)\n(.*?)(?=^## |\Z)", text, flags=re.MULTILINE | re.DOTALL):
        heading, body = match.group(1).strip(), match.group(2).strip()
        ticked = re.search(r"`([A-Za-z][A-Za-z0-9.]*):?`", heading)
        name = (ticked.group(1) if ticked else heading.split()[0]).lower().rstrip(":")
        found.append((name, heading, body))
    return found


def first_sentence(body: str) -> str:
    outside_code = "\n".join(body.split("```")[0::2])
    prose = " ".join(line.strip() for line in outside_code.splitlines() if line.strip() and not line.startswith("|"))
    sentence = re.split(r"(?<=[.!?])\s", prose, maxsplit=1)[0] if prose else "fields only; print the section"
    return sentence if len(sentence) <= 140 else sentence[:137] + "..."


def brief() -> str:
    lines = ["# A complete spec that uses the fields most diagrams need", "", BRIEF_EXAMPLE.rstrip(), "",
             "# Other sections: print one with --section <name>", ""]
    lines += [f"{name:<12} {first_sentence(body)}" for name, _, body in sections()]
    return "\n".join(lines) + "\n"


def main(argv: list | None = None) -> int:
    parser = argparse.ArgumentParser(description="Print the DSL format this skill reads.")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--section", help="print one section of the DSL reference by name")
    group.add_argument("--list", action="store_true", help="print the section names")
    args = parser.parse_args(argv)
    if args.list:
        print("\n".join(name for name, _, _ in sections()))
        return 0
    if args.section:
        wanted = args.section.lower().strip("`:")
        for name, heading, body in sections():
            if name == wanted:
                print(f"## {heading}\n\n{body}")
                return 0
        print(f"unknown section {args.section!r}; sections: {', '.join(name for name, _, _ in sections())}", file=sys.stderr)
        return 2
    sys.stdout.write(brief())
    return 0


if __name__ == "__main__":
    sys.exit(main())
