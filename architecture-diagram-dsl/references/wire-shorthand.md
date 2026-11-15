# Wire shorthand

The full mapping form (`{ from, to, type, label, flow, layer, bundle,
offset, priority }`) is always available. For the common case, a compact
string form covers everything except `layer`, `bundle`, `offset`, and
`priority`.

## Grammar

```
[<type>: ]<from> (->|=>) <to>[: <label>]
```

As one regex (this is exactly what the validator uses):

```
^(?:(security|control|compat|neutral):\s*)?(\S+)\s*(->|=>)\s*(\S+)(?:\s*:\s*(.+))?$
```

- **Type prefix** (`security:`, `control:`, `compat:`, `neutral:`) is
  optional. Bare, with no prefix, means `type: data` -- the common case.
- **Arrow**: `->` means `flow: false`; `=>` means `flow: true` (the
  animated "active flow" overlay). Combine a type prefix with `=>` freely.
- **`from`/`to`** are catalog or package ids -- a single token, no spaces.
- **Label** is everything after the first `: ` following the arrow, and is
  optional.

## Examples

```yaml
wires:
  - "orders -> ordersdb: SQL"                 # data, not animated
  - "orders => events: publish"               # data, animated
  - "security: gateway -> idp: token check"
  - "control: gateway -> monolith: route config"
  - "compat: orders -> monolith: legacy lookups"
  - "neutral: svc -> cache: read config"
  - "security: gateway => idp: token check"   # type + animated, combined
  - a -> b                                    # label is optional too
```

**Always quote a wire shorthand string that carries a label.** YAML
itself -- not this DSL -- treats any unquoted `something: something-else`
as a mapping. `client -> gateway: HTTPS` with no quotes parses as the
one-entry mapping `{"client -> gateway": "HTTPS"}`, not the string
`"client -> gateway: HTTPS"`, and the validator never even gets a chance
to apply the shorthand grammar to it -- it reports a confusing mix of a
schema error and `unknown-catalog-ref` (`from`/`to` both `None`) instead
of the clear `wire-shorthand-parse-error` you'd expect. The validator
also specifically detects this exact mistake (a one-key mapping whose key
contains `->` or `=>`) and reports it as `wire-shorthand-needs-quoting`
with the fix spelled out, precisely because it's this easy to hit. The
only shorthand safe to leave unquoted is one with no label at all (`a ->
b`), since there is then no colon for YAML to misread.

## Reusing an identical wire

This DSL adds no special syntax for repetition -- use standard YAML
anchors and aliases, which work anywhere a wire (or any other value) can
appear:

```yaml
transition:
  states:
    - id: current
      wires:
        - &auth_check "security: gateway -> idp: token check"
        - ...
    - id: target
      wires:
        - *auth_check
        - ...
```
