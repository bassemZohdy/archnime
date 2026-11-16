# Composition and multi-view bundles

The current DSL 1.0 document has exactly one top-level composition mode. The
accepted design for multi-view documents is recorded in the source
repository's `docs/superpowers/specs/2026-09-06-views-composition-decision.md`
(a design record that is not shipped with the installed skill).

`transition-diagram/2.0` now accepts a `views:` array over one shared `catalog`
and `packages`. Each view has a stable `id`, a human-facing `title`, and a
`mode` of `system`, `transition`, `steps`, `scenarios`, `flow`, or `deployment`.
The current top-level modes stay valid for backwards compatibility and
normalize internally to the same view shape.

Use the modes for different questions:

- `system`: what exists in one snapshot;
- `transition`: how full, ordered architecture states change;
- `steps`: how a transition can be authored as cumulative deltas;
- `scenarios`: how named variants branch from one base;
- `flow`: how one fixed topology communicates a request or event path.
- `deployment`: where selected logical components run across nested physical
  infrastructure and replica targets.

Comparison is an intent layered on v2 `views:` rather than a new root mode.
Put weighted criteria and an optional recommendation in `meta.comparison`;
put each option's ratings/notes in that view's `comparison.tradeoffs`. This
reuses navigation and stable catalog identity while keeping alternatives
non-sequential.

Do not duplicate the catalog or packages merely to create another view. The
translator emits the shared semantic catalog/packages once and stores only
per-view materialization deltas in the renderer bundle. Keep view-specific
boundaries and wires local because abstraction levels and scenarios can
legitimately expose different relationships.

Deployment is a `views:` mode rather than a new DSL 1.0 root key. Its
infrastructure tree, deterministic instance IDs, placement rules, and rollout
boundary are specified in the source repository's
`docs/superpowers/specs/2026-09-06-deployment-view.md` design record.
Replica placement does not imply a wire between every possible replica pair:
each logical wire is translated to one representative physical route and keeps
`logicalFrom`/`logicalTo` metadata for traceability.

## Drill-down and navigation

Use `navigateTo: <viewId>` when a node or flow step should replace the current
view. Use `contains: <viewId|packageId>` when a catalog node represents a
contained view or structural package. View navigation updates the URL query
(`?view=<viewId>`), so links, reloads, and browser history preserve the chosen
view. The first view in the bundle is the root breadcrumb target.

For a package target, double-click or press Enter on the catalog node to expand
the package in place and zoom to its outline. Package drill-down is deliberately
zoom-only: it does not add a breadcrumb entry or a separate back action. Use the
view selector/root breadcrumb to move between views. A single click still means
highlight/focus for leaf nodes and expand/collapse for package blocks. Use a
separate view when the abstraction or layout question changes; use package
drill-down when the same view remains authoritative and only more structural
detail should be revealed.
