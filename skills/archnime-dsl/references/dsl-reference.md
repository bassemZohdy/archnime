# DSL reference

Every field in a `transition-diagram/1.0` or `transition-diagram/2.0` document.
`catalog` entries share one shape across every composition mode.

## Document root

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `dsl` | string | yes | `transition-diagram/1.0` for one root mode, or `transition-diagram/2.0` for a `views:` bundle |
| `meta` | object | yes | see below |
| `canvas` | object | no | `{ w, h, minWidth }`, logical SVG space |
| `catalog` | object | yes | at least one entry |
| `packages` | object | no | |
| `system` | object | one of `system`/`transition`/`steps`/`flow` | one-shot mode |
| `transition` | object | one of `system`/`transition`/`steps`/`flow` | staged mode |
| `steps` | object | one of `system`/`transition`/`steps`/`flow` | delta-authored staged mode |
| `scenarios` | object | one of `system`/`transition`/`steps`/`scenarios`/`flow` | named non-sequential variants |
| `flow` | object | one of `system`/`transition`/`steps`/`flow` | fixed-topology walkthrough mode |
| `views` | array | v2 only | ordered multi-view bundle over the shared catalog and packages |

`system`, `transition`, `steps`, `scenarios`, and `flow` are mutually exclusive
-- a document has exactly one of them.

## `views:` -- DSL 2.0 multi-view bundle

Use `views:` when one semantic document needs context, transition, flow, or
deployment perspectives over the same identities. DSL 2.0 requires a
non-empty array and forbids the legacy root modes in the same document:

```yaml
dsl: transition-diagram/2.0
meta: { title: Commerce architecture }
catalog:
  client: { label: Checkout web app, type: actor, navigateTo: checkout }
  orders: { label: Orders service, type: service }
views:
  - id: context
    mode: system
    title: Commerce context
    nodes: [client]
    wires: []
  - id: checkout
    mode: flow
    title: Checkout request
    nodes: [client, orders]
    wires: ["client => orders: HTTPS"]
    steps: [{ title: Request, edge: "client => orders" }]
```

Each view has a unique `id`, a `title`, and exactly one `mode`: `system`,
`transition`, `steps`, `scenarios`, `flow`, or `deployment`. View-local nodes
and wires follow the corresponding sections below. `navigateTo` on a catalog
node, node override, or flow/transition step targets another view ID. The
renderer preserves the target in the URL as `?view=<viewId>`.

The schema requires each mode's fields up front, so a view that would draw an
empty diagram is rejected rather than translated:

| `mode` | Required fields |
| --- | --- |
| `system` | `nodes` (at least one), `wires` |
| `flow` | `nodes` (at least one), `wires`, `steps` |
| `deployment` | `nodes` (at least one), `wires`, `deployment` |
| `transition` | `states` (at least two) |
| `steps` | `base`, `sequence` |
| `scenarios` | `base`, `variants` |

Deployment is only a v2 view mode. It uses normal `nodes` and logical `wires`,
plus a nested infrastructure map and placements:

```yaml
  - id: production
    mode: deployment
    title: Production deployment
    nodes: [orders]
    wires: []
    deployment:
      infrastructure:
        region: { label: US East, kind: region, children: [host] }
        host: { label: Orders host, kind: host }
      placements:
        - { component: orders, target: host, replicas: 2 }
```

Placement targets must be infrastructure leaves. The translator derives stable
physical instance IDs as `${component}-${target}-${index}` and the renderer
shows the infrastructure as nested region/cluster/host outlines. Each logical
wire becomes one deterministic representative physical route; replica count
does not multiply identical lines. Use a
deployment view for runtime placement questions; use packages for logical
structure and `contains` drill-down when the same view should expand in place.

## `meta`

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | string | -- | required |
| `subtitle` | string | -- | optional |
| `layout` | `auto`\|`dagre`\|`elk`\|`force`\|`manual` | `auto` | renderer `auto` selects asynchronous ELK for deeply nested compound derivatives; explicit ELK callers must await preparation |
| `minWireLen` | positive number | `72` | minimum visible wire length in logical pixels; scales with density |
| `perspectives` | list of perspective IDs | `all`, `data`, `security`, `migration`, `devops` | authoritative perspective dropdown options in order; `All` is always added as the reset; `control`, `compat`, `neutral`, and `zones` remain advanced IDs |
| `direction` | `LR`\|`TB` | `LR` | layered direction for dagre and ELK |
| `routing` | `curved`\|`orthogonal`\|`direct` | `curved` | wire drawing style; the viewer can switch it live in the toolbar. `orthogonal` = H/V polyline routed around nodes/packages/boundaries; `direct` = straight endpoint-to-endpoint |
| `wireJumps` | `arc`\|`gap`\|`none` | `arc` | hop style where two `orthogonal` wires cross without connecting; ignored in `curved` mode |
| `focusHops` | non-negative integer | `1` | node-selection focus radius; hides nodes and wires beyond this many hops without relayout |
| `levels` | list of string | -- | breadcrumb levels, e.g. `[Context, Container, Component]` |
| `icons` | map of type → alias or SVG definition | -- | project-registered catalog types; aliases name one of the built-ins |
| `theme` | `light` and/or `dark` map of colour role → hex colour | built-in palette | the project's own colours; see [Theme](#theme) |
| `flow.secondary` | list of wire type | -- | which types count as secondary |
| `flow.mode` | `deemphasize`\|`bundle`\|`hide` | -- | |
| `flow.secondaryRoute` | `direct`\|`bundle` | -- | |
| `flow.intro` | boolean | -- | show an introductory pre-step before the first active step |
| `flow.render` | `stepwise`\|`all-steps`\|`single` | `stepwise` | interactive timeline, printable all-step overview, or one slide-friendly step |
| `flow.autoAdvanceMs` | positive number | -- | playback interval for flow steps |
| `flow.loop` | boolean | `false` | restart playback after the final step |
| `gif.fps` | number, ≤ 12 | -- | |
| `gif.maxDurationMs` | number, ≤ 10000 | -- | |

### Theme

`meta.theme` gives the diagram the project's own colours. Each scheme is a map
from a colour role to a hex colour (`#rgb` or `#rrggbb`); a role left out keeps
the built-in colour, and a scheme left out keeps the built-in scheme:

```yaml
meta:
  theme:
    light: { panel: "#fffdf7", data: "#0b6e4f", data-fill: "#e3f4ec" }
    dark:  { panel: "#101914", data: "#3fd08f" }
```

| Roles | What they paint |
| --- | --- |
| `bg`, `panel`, `line` | the page, the drawing surface, and the rules between them |
| `ink`, `muted` | labels and secondary text (node details, captions) |
| `data`, `security`, `control`, `existing`, `retired`, `neutral` | wire and node outline colour of that type or kind |
| `data-fill`, `security-fill`, `control-fill`, `existing-fill`, `retired-fill` | node fills |
| `data-label`, `security-label`, `control-label`, `existing-label`, `neutral-label` | wire and package labels |
| `boundary` | trust-boundary outlines |

The presenter, the documentation SVG and the sequence SVG all use the theme,
each scheme under its own `prefers-color-scheme`. Both validators check the
palette the reader will see, the built-in colours with the theme on top, and
report `theme-contrast` when a colour you set leaves text under 4.5:1 (`ink`
and `muted` on `panel`, `bg` and every fill; each label colour on `panel`) or
a wire or boundary line under 3:1 (`data`, `security`, `control`, `boundary`
on `panel`), the WCAG 2.1 text and non-text thresholds. `theme` is set once,
on the top-level `meta`.

## `canvas`

`{ w, h, minWidth }` -- all optional numbers. Omit entirely if a downstream
renderer should choose the canvas size.

## `catalog`

```yaml
catalog:
  orders:
    label: Orders service
    type: service          # required, see enum below
    kind: new                # default: existing
    detail: owns order lifecycle
    ops: true                 # optional Operations perspective signal
    size: [170, 64]            # optional [w, h]
    level: Component             # optional, advisory only
    contains: commerce           # optional package or v2 view target
    navigateTo: orders-flow      # optional v2 view target
    source: src/orders/service.py  # optional, the file behind it (see Sources)
    variant: external            # optional, someone else runs it
```

`type` enum: `actor`, `service`, `gateway`, `agent`, `database`, `cache`,
`queue`, `topic`, `external`, `security`, `package`, and for AI systems
`llm` (a model you call), `vector-store` (an embedding index, drawn as a
store) and `tool` (a function an agent may call). There is no `shape`
field -- the icon is always derived from `type`.

`variant: external` marks a part that someone else runs (a hosted model, a
SaaS API, a managed store) without giving up its type: an external `llm`
keeps the model icon and gets a dashed outline. Use `type: external` only
for a system whose kind does not matter to the reader. A node override
(`{id, variant: external}`) sets it for one view or stage.

Projects may register additional catalog types under `meta.icons` without
changing the built-in set:

```yaml
meta:
  icons:
    worker: agent                         # alias an existing icon
    mobile:
      viewBox: "0 0 24 24"
      markup: '<path d="M12 2v20"/>'      # inline SVG fragment
catalog:
  worker: { label: Worker, type: worker }
  mobile: { label: Mobile client, type: mobile }
```

An alias must name a built-in node type. An inline definition must contain a
non-empty `viewBox` and SVG `markup`; the renderer inserts it as a symbol and
uses the registered type as its icon name. `kind` continues to control fill
and stroke, and the validator rejects attempts to replace a built-in type.

`kind` enum: `existing`, `new`, `mixed`, `security`, `retired`.

## `packages`

```yaml
packages:
  domain:
    label: Domain services
    level: Component
    children: [orders, inventory]   # required, >= 1 -- catalog or package ids
```

Packages may nest (a `children` entry can itself be a package id).

## `system:` -- one-shot mode

```yaml
system:
  id: only                  # optional, defaults to "only"
  title: Checkout request path
  summary: ...
  callout: ...
  docs: docs/orders-extraction.md
  adr: docs/adr/0042-orders-extraction.md
  boundaries: [ { id, label, tone?, contains: [ids] } ]
  nodes: [ id, ... ]          # or { id, label?, detail?, kind?, size?, ops? }
  wires: [ ... ]                # shorthand strings or full mappings
  disclosure: { mode: progressive, initialStep: 0, intervalMs: 900,
                layers: [ { id, label } ], auto: true }
```

A node override may only set `label`, `detail`, `kind`, `size`, `ops`, `source`, and (in a v2
bundle) `navigateTo` -- never `type`. Type is identity, fixed once in
`catalog`.

## `transition:` -- staged mode

```yaml
transition:
  states:                     # required, >= 2 entries
    - id: current               # required, unique within the document
      title: Current state
      summary: ...
      changes: [ "narrative bullet", ... ]
      callout: ...
      boundaries: [ ... ]
      nodes: [ ... ]              # required, same shape as system.nodes
      wires: [ ... ]               # required
      changed: [ ids ]              # ids introduced/repurposed/retired here
      disclosure: { ... }
      expandedPackages: [ ids ]
      layout: dagre|elk|force|manual
    - id: target
      ...
```

Each state is a full, self-contained description -- never a diff against
the previous state. `docs` and `adr` are optional relative or absolute URLs
shown as safe links in the renderer's state panel; they keep evidence and the
decision record close to the view without affecting geometry.

## `steps:` -- delta-authored staged mode

Use `steps:` when the states are sequential but repeating every node and wire
would make the source noisy. `base` is a full state; each `sequence` entry
applies cumulative changes and is materialized into the same renderer `stages`
array as `transition:`:

```yaml
steps:
  base:
    id: current
    title: Current state
    nodes: [client, gateway]
    wires: ["client -> gateway: HTTPS"]
  sequence:
    - id: target
      title: Target state
      add:
        nodes: [orders]
        wires: ["gateway => orders: /orders"]
      remove:
        wires: ["client -> gateway: HTTPS"]
      set:
        gateway: { detail: routes to Orders }
      changed: [gateway, orders]
```

`add.nodes` and `add.wires` append new entries. `remove.nodes` also removes
every attached wire; `remove.wires` matches `(from, to, type)` after shorthand
parsing. `set` merges the listed `label`, `detail`, `kind`, and/or `size` fields
over the node's accumulated presentation override. A node that has no prior
override starts from its catalog defaults; omitted fields remain unchanged
until a later override supplies a new value. A step may also replace state-level
`summary`, `changes`, `callout`, `boundaries`, `changed`, `disclosure`,
`expandedPackages`, or `layout` by specifying that field directly.

The translator emits `base` plus one stage per sequence entry. The CLI's
materialized output can be compared with an ordinary `transition:` source for
continuity review.

For a `flow:` document, `translate_transition_diagram.py --sequence` emits a
companion Mermaid `sequenceDiagram` to stdout. Participant order follows
`flow.nodes`; messages are numbered (`autonumber`); async edges use `-->>`,
parallel work uses `par`/`and`, a loop with `repeat` becomes a Mermaid `loop`
block, `alt`/`opt`/`loop` fragments become `alt`/`else`/`opt`/`loop` blocks with
their guards, and each `phase` is a note across every participant. The normal
`--output` renderer-model path remains available separately.

For a static architecture snapshot, `translate_transition_diagram.py --mermaid`
emits Mermaid `architecture-beta` syntax to stdout. It uses the first translated
state only, maps catalog types onto Mermaid's built-in cloud/database/internet/
server icons, and retains nested packages as groups. This is intentionally a
lossy interchange view: Mermaid has no equivalent for this DSL's boundaries,
wire labels/types, or staged history. Keep the validated YAML or renderer JSON
when those semantics matter. The renderer's **Mermaid** button exports the
currently selected state using the same projection.

The export follows Mermaid's [architecture diagram syntax](https://mermaid.js.org/syntax/architecture).

## `scenarios:` -- named non-sequential variants

Use `scenarios:` when one base architecture has independent alternatives such
as failover, degraded mode, or regional outage. The base is a full snapshot;
each named variant applies the same `add`/`remove`/`set` overlay vocabulary as
`steps:`:

```yaml
meta:
  title: Orders failover scenarios
  composition: scenarios

scenarios:
  base:
    title: Steady state
    nodes: [gateway, orders, ordersdb, ordersdbReplica]
    wires: ["gateway => orders: /orders", "orders -> ordersdb: RW"]
  variants:
    - id: primary-down
      title: Primary database failover
      set:
        ordersdb: { kind: retired, detail: unreachable }
        ordersdbReplica: { kind: new, detail: promoted to primary }
      remove:
        wires: ["orders -> ordersdb: RW"]
      add:
        wires: ["orders -> ordersdbReplica: RW (promoted)"]
```

`meta.composition: scenarios` makes the generated renderer controls a variant
selector: Prev/Next/Play are hidden, while each variant remains a keyed,
self-checkable materialized stage. Variants are not a temporal sequence, so do
not describe one as Current → Target or rely on autoplay to convey order.

## `flow:` -- fixed-topology walkthrough mode

Use `flow:` when the architecture should be laid out once and the viewer
should follow a request or event path step by step. The flow reuses catalog,
package, boundary, and wire semantics, but has one stable node topology and
an ordered `steps` list instead of multiple states:

```yaml
flow:
  title: Checkout request path
  summary: Follow one request through authentication and persistence.
  callout: The topology stays fixed while the active step moves.
  docs: docs/checkout-request.md
  adr: docs/adr/0042-checkout-boundary.md
  nodes: [client, gateway, orders]
  wires:
    - "client => gateway: HTTPS"
    - "gateway => orders: POST /orders"
  steps:
    - edge: "client => gateway"
      note: The browser sends the request.
    - edge: "gateway => orders"
      note: The gateway forwards the authenticated command.
    - edge: "orders -> gateway"
      kind: return
      note: The service returns the result.
```

Each step may set a short `title` for the timeline and introductory summary.
Flow-level and step-level `docs` / `adr` links are carried into the renderer
panel for the active view.
It contains exactly one of `edge`, `group`, `parallel`, `alt`, `opt`, or
`loop`. An optional
step-level `label` replaces the permanent label on the active wire while that
step is selected; this is useful when the same wire carries different
operations at different moments. An `edge`
references a wire by its endpoint shorthand; `kind: return` may reference the
reverse direction of an earlier call, and so may `kind: refused`. `group` activates several edges in one
step, while `parallel` contains child edge steps. `kind` is `call`, `return`,
`refused`, `async`, or `loop`; `refused` is a reply that says no (a policy
check, a rate limit, a guardrail) and needs an earlier call like `return`; a loop may use a synthetic self-edge such as
`notify -> notify`. Use `label` and `repeat` for compact timeline metadata.
The renderer draws `return` edges with dashed arrows and `refused` edges
with short dashes ending in a cross (the sequence export writes `--x`), marks `parallel` work
with fork/join glyphs, and displays a `loop` badge with its `repeat` condition.
Use `meta.flow.render: all-steps` for a static, printable view with every
flow-mapped wire numbered; `single` hides walkthrough chrome for slide use.

### Branches, options, loops and phases

A step can hold a fragment instead of an edge: the branches of a choice, steps
that run only sometimes, or steps that repeat. Each branch has a guard,
`when`, in the reader's words, and its own `steps`, which may hold fragments
of their own:

```yaml
steps:
  - phase: Check the password
    title: Find the user
    edge: "api => users"
  - title: User row
    edge: "users => api"
    kind: return
  - title: Second factor
    opt:
      when: account has MFA
      steps:
        - title: Send the code
          loop:
            when: up to 3 tries
            steps:
              - { title: Send, edge: "api => mfa" }
        - { title: Code accepted, edge: "mfa => api", kind: return }
  - title: Answer
    alt:
      - when: password matches
        steps:
          - { title: Session, edge: "api => browser", kind: return, label: 200 · session }
      - when: else
        steps:
          - { title: Refused, edge: "api => browser", kind: refused, label: "401" }
```

| Key | Means | Branches |
|---|---|---|
| `alt` | one of the branches runs | a list of two or more; only the last may be `when: else` |
| `opt` | the steps run only when the guard holds | one |
| `loop` | the steps repeat; the guard says over what (`for each page`) | one |

Each branch of an `alt` starts from the calls made before it, so a reply in
the `else` branch cannot answer a call only the first branch made; after the
fragment, a call made in any branch may be answered. `phase` names a part of
the conversation, `Check the password`, and lasts until the next `phase`; it
goes on a top-level step only. A single step with `kind: loop` and `repeat`
remains the short form of a one-step loop.

The translator plays every branch in turn, in the order written: each step
inside a fragment carries `fragments`, its enclosing frames (id, kind, guard,
branch), and a step after a `phase` carries it. The presenter puts the guards
before the step title and the phase in the eyebrow; the sequence SVG
(`export_svg.mjs --sequence`) draws each fragment as a frame with its guard,
an `else` branch below a dashed divider, and each phase as a heading; the
Mermaid sequence writes `alt`/`else`/`opt`/`loop` blocks. Example:
`assets/examples/sign-in-sequence.yaml`.

## Wires -- full form

```yaml
{ from: orders, to: ordersdb, type: data, label: SQL, flow: false,
  layer: primary, bundle: null, offset: null, priority: null }
```

`type` enum: `data`, `security`, `control`, `compat`, `neutral` (default
`data`). See `wire-shorthand.md` for the terser string form.

A wire mapping may also carry `source` (see Sources); shorthand strings cannot,
so write a wire as a mapping when it needs one.

## `source:` -- the code behind a part, line or step

`source` is optional on a catalog entry, a node override, a wire mapping and a
flow step. It names, relative to the project root, the file that backs it:

| Form | Example |
| --- | --- |
| file | `source: src/orders/service.py` |
| file and line | `source: "src/api.ts:42"` |
| file and quoted words | `source: "src/api.ts#db.insert(order)"` |
| all three | `source: "src/api.ts:42#db.insert(order)"` |
| mapping | `source: { path: src/api.ts, line: 42, quote: db.insert(order) }` |

For a part, name the file that decides what it is, found by following the
imports. For a wire or step, name the line that makes the call and a few words
of it, enough to find it again. When drawing from a document instead of code,
name the document and quote the sentence that states the part or the call:
`docs/design.md#the worker takes each job from the queue`.

The validator refuses a path that is absolute, a URL, leaves the root, enters
`.git` or a credentials folder, or names a file that commonly holds secrets
(`source-path-unsafe`). `scripts/check_sources.py` reads the files and reports a
source whose file, line or words are gone (see `validation-and-review.md`).
The translator keeps `source` in the renderer model.

## Boundaries

```yaml
{ id: regulated, label: Cardholder + PII scope, tone: security,
  contains: [orders, ordersdb] }
```

Expresses ownership/trust/compliance, never structure -- that's what
packages are for.

## Disclosure

```yaml
{ mode: progressive, initialStep: 0, intervalMs: 900,
  layers: [ { id: primary, label: primary }, { id: secondary, label: supporting } ],
  auto: true }
```

For a dense single state with a primary/supporting reveal sequence.
