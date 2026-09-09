# TallerTrack project instructions

## Project identity

TallerTrack is a greenfield mobile system for the integral management and operational traceability of automotive repair shops.

Current planned stack:

- React Native + Expo + JavaScript
- Node.js + Express REST API
- Oracle Database XE

Domain discovery and clarification are complete. The canonical specification, database design, software architecture, and HTTP API contract exist. Implementation has not started and may now begin with the Foundation / Walking Skeleton.

## Canonical project sources

Use these canonical documents:

- `docs/project-specification.md` — requirements and business rules, v2.0
- `docs/software-architecture.md` — software architecture, v1.0
- `docs/TallerTrack_Arquitectura_Base_de_Datos.md` — database design, v2.0
- `docs/api-contract.md` — HTTP API contract, v1.0

The original source is preserved at:

`docs/project-specification.pdf`

Use the Markdown version by default. Search and read only the sections relevant to the current task.

Consult the PDF only when visual material matters, the Markdown appears incomplete or ambiguous, or fidelity to the original source must be verified.

The domain has already been clarified. Implementation must follow the canonical documents and must not silently reinterpret requirements, business rules, data rules, architectural decisions, API contracts, or explicit implementation gates. Surface meaningful conflicts or gaps before coding them.

The design documents express intended design and contracts. Code, migrations, and tests provide implementation evidence.

## Source precedence

When project sources conflict, use this precedence:

1. `docs/project-specification.md`
2. `docs/software-architecture.md` and `docs/TallerTrack_Arquitectura_Base_de_Datos.md`, interpreted together
3. `docs/api-contract.md`
4. implementation

Repository instructions govern how work is performed; accepted decision records preserve rationale and must remain consistent with the canonical sources. Use `docs/project-specification.pdf` only to verify the original source when needed.

Do not silently reconcile meaningful conflicts. Surface them before implementation.

## Current state and context recovery

The compact current-state snapshot is:

`docs/project-state.md`

For a new substantial task or when context may have been lost:

1. read the applicable `AGENTS.md`
2. read `docs/project-state.md`
3. retrieve only the specification sections, decision records, code, tests, or history relevant to the task

Do not load the complete project documentation by default.

Treat repository context as the durable memory of TallerTrack. Do not use long conversation history or global memory files as the authoritative source of current project state when the repository provides the answer.

Update `docs/project-state.md` only when the project materially changes, such as when:

- a significant decision becomes accepted
- an important open area is resolved
- the project enters a new phase
- a meaningful capability becomes completed
- the current main work or next milestone changes
- an important constraint changes

Keep it compact and current, not chronological.

## Significant project decisions

Durable rationale for significant decisions lives under:

`docs/decisions/`

Do not read every decision record by default. Search for and load only decisions relevant to the current task.

Follow `docs/decisions/README.md` when creating, accepting, superseding, or indexing decision records.

Product or business semantics must not be marked as accepted without deliberate user/project-owner agreement.

When a significant decision becomes accepted:

- preserve its rationale in the relevant decision record
- summarize the resulting current fact in `docs/project-state.md`
- remove stale unresolved-state entries when appropriate

## Session context discipline

Treat a Codex session as working memory for one coherent task or closely related sequence of tasks.

Resume a session when continuing the same unresolved problem and its recent reasoning remains relevant.

Prefer a new session when the next task has a substantially different goal.

Before ending significant work, persist durable consequences in the repository:

- current state → `docs/project-state.md`
- significant rationale → `docs/decisions/`
- requirements → `docs/project-specification.md`
- implementation truth → code and tests

Prefer targeted search and partial file reads over loading large files or unrelated history in full.

## Current architectural direction

Current intended direction and next technical objective:

mobile application
→ REST API
→ Oracle Database XE

Build the Foundation / Walking Skeleton first: the smallest end-to-end path that validates the stack before product functionality is added or dependency versions are fixed.

Keep presentation, application/domain logic, and persistence appropriately separated.

Do not create a new architecture, generic layers, microservices, CQRS, event sourcing, brokers, speculative abstractions, or future-facing module structure. Implement only what the current verified increment needs.

## Connectivity

The current MVP requires active connectivity to the backend through the Internet or a local network.

Offline-first operation and offline synchronization are outside the current MVP.

Do not introduce synchronization engines, offline write queues, conflict-resolution mechanisms, or a local database acting as an independent source of truth without a new explicit project decision.

Local caching is acceptable only when it improves UX without changing the system's source of truth or consistency model.

## Database status

The canonical database design v2.0 is documentarily complete, but no schema, migration, package, or Oracle runtime test exists yet. Implement it only through deliberately scoped, testable migrations; do not create all 44 proposed tables as Foundation work.

## Scope

Prioritize the academic MVP.

Do not silently introduce features outside the documented MVP or speculative future requirements.

## Greenfield repository discipline

Do not assume missing structure is accidental.

Before each change, read the canonical sections relevant to that increment and inspect the relevant repository files.

Prefer the smallest structure required by the currently approved capability.

Do not generate speculative structure for future features.

Work in small, verifiable increments. Codex focuses on analysis, implementation, file changes, and the technical verification required by the task.

The user performs the Git review manually. Unless the user explicitly requests it, Codex must not run or print `git status`, `git diff`, `git diff --staged`, or equivalent Git review commands.

Unless the user explicitly requests it, Codex must not run `git add`, commit, push, rebase, merge, or any other operation that modifies the Git index or history.

At the end of a task, Codex must summarize the files modified, what changed, the technical verifications run and their results, and any pending problems or decisions. Codex must then stop so the user can perform the Git review.
