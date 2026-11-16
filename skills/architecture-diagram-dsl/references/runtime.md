# Runtime and language policy

Python is the canonical CLI runtime. Use one supported interpreter consistently;
the repository scripts accept `PYTHON=/path/to/python`. Node-based harnesses use
the shared platform-aware resolver (`python` on Windows and `python3` on
POSIX) unless `PYTHON` is set:

```bash
python -m pip install -r requirements-dev.txt
PYTHON=python3 npm test  # POSIX; use `$env:PYTHON = 'python'` in PowerShell
python architecture-diagram-dsl/scripts/validate_transition_diagram.py diagram.yaml
python architecture-diagram-dsl/scripts/translate_transition_diagram.py diagram.yaml --output diagram.model.json
python architecture-diagram-renderer/scripts/build_bundle.py --template architecture-diagram-renderer/assets/template.html --model diagram.model.json --output diagram.html
```

The validator and translator require Python 3.10 or newer. `pyyaml` parses
the YAML and `jsonschema>=4.18` validates Draft 2020-12. The browser mirror
is the zero-build `architecture-diagram-renderer/assets/translate.html`: it
uses pinned `js-yaml`, the browser validator/translator, and the shared
JavaScript engine, with no npm runtime in generated HTML.

Python remains canonical for CLI behavior. The JavaScript validator and
translator are maintained as browser mirrors; `tests/translate_check.mjs`
compares browser validation rule names with the Python validator across every
invalid fixture. New semantic rules must be added to the schema first and
then mirrored only where the browser workflow needs them.

Missing Python dependencies must produce an actionable message with the
exact install command and point browser users to `translate.html`; they must
not expose an import traceback. `build_bundle.py` uses only the Python
standard library and reports input/output errors directly.
