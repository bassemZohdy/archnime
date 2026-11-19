# Architecture styles

Naming the style a system follows tells you which parts to look for, which
questions its readers bring, and what can be merged without losing meaning.
Find the style by what the code shows, draw from the matching row, and say in
the report which style you recognised (or that none fitted). A real system
often combines two: draw each at the level its reader needs, and prefer two
views of one catalog (`views:`) to one crowded picture.

The names follow the usual literature: layered and microservices as in
Richards and Ford, pipes and filters and the microkernel as in the POSA
books, ports and adapters as Cockburn described them, and the C4 levels for
how deep to go.

| Style | Signs in the code | Draw it in archnime |
| --- | --- | --- |
| Layered | folders named for a technical role (`controllers/`, `services/`, `repositories/`), each importing only the next one down | `system:` with one package per layer and wires that only go down; a wire that skips a layer is the finding the reader wants to see |
| Ports and adapters (hexagonal, clean, onion) | a core free of framework imports, interfaces the core owns (`ports/`), implementations outside it (`adapters/`, `infrastructure/`) | the core as one package, each adapter its own node outside it, a boundary around the core; label wires with the port they go through |
| Modular monolith | one deployable, several modules with their own folders and an explicit public surface | one package per module inside one deployable package; `views:` with a component view per module when a reader drills in |
| Client and API | a front end (`app/`, `pages/`, a mobile project) calling a server (`api/`, route handlers) over HTTP or a generated client | `actor` for the user, the client and the API as nodes, a trust boundary at the API; a `flow:` for the one request the README explains |
| Microservices | several deployables, each with its own manifest, container file or chart, usually its own store; compose files or cluster manifests | one node per service and its store inside a package per service; `mode: deployment` when the reader asks where they run; `security` wires for auth hops |
| Event-driven | producers and consumers of named events, a broker (Kafka, RabbitMQ, SQS, NATS, Redis streams), handlers registered by event name | the broker as a `queue` or `topic` node between them, `async` flow steps for publishes, one wire per event family rather than per event |
| CQRS and event sourcing | separate write and read models, an append-only event store, projections that rebuild read stores | two packages (commands, queries) joined only through the event store; a `flow:` showing one command becoming one projection update |
| Pipeline (pipes and filters) | stages that take data and pass it on: ETL jobs, DAGs (Airflow, Dagster, dbt), stream processors, a scheduler | stages left to right (`direction: LR`), stores between stages as `database` nodes; `control` wires from the scheduler |
| Serverless | functions as the unit of deployment (`functions/`, `serverless.yml`, SAM, SST, Workers) wired to triggers: HTTP, a queue, a bucket, a schedule | one node per function family, its trigger as the wire's source; merge functions that share trigger and store |
| Plugin host (microkernel) | a host that loads extensions from a manifest or registry, with an API the extensions call back | the host and its registry as one package, each extension a node outside it, two wires (load, call back) per extension kind, not per extension |
| CLI, compiler and build tool | a command that reads input, runs stages (parse, validate, transform, emit) and writes output; a `bin` entry, subcommands | a `flow:` through the stages for one command; `system:` with one node per stage when the reader asks what the parts are |
| Libraries in a monorepo | workspaces (`packages/`, `apps/`, `crates/`) each with its own manifest | one node per workspace, wires for dependencies only, apps on one side and libraries on the other |
| LLM, retrieval and agents | calls to a model API, embeddings, a vector store, prompt files, tool definitions, an agent loop | `agent`, `llm` (with `variant: external` when hosted), `vector-store` and `tool` types; a `flow:` with a `loop` fragment for the tool-calling loop and a `refused` reply where a guard says no |
| Strangler migration | an old system and a new one behind the same front door, traffic moving piece by piece | `transition:` (or `steps:`) with the same catalog ids in every state, `kind: new`, `retired` and `changed` carrying the migration story |

## Questions each style's reader brings

- **Layered, hexagonal, modular monolith:** where does a request cross from
  one layer or module to the next, and what is not allowed to depend on what?
- **Client and API, microservices:** what calls what, who owns the data, where
  is the trust boundary, and what happens to one request end to end?
- **Event-driven, CQRS, pipeline:** who produces each kind of event or data,
  who consumes it, and what is eventually consistent?
- **Serverless, plugin host:** what triggers each piece, and what may an
  extension or function touch?
- **LLM and agents:** what does the model see, what can it call, where does
  data leave the system, and where can the answer be refused?
- **Migration:** what changes at each step, and what stays the same?

Keep only the parts and wires those questions need, and record the rest in
`meta.reader.omitted`.
