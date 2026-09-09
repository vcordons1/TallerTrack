# Active Task Handoff

> Temporary working memory for one unfinished task.
>
> This file is not an authoritative project source and must not replace
> `docs/project-state.md`, accepted decision records, requirements, code, or tests.
>
> Keep it concise. Do not copy full conversations, large diffs, logs, or documents.

## Task

State the single coherent task currently being worked on.

## Goal / done when

Describe the observable result required to consider this task complete.

## Current state

Describe only where this specific task currently stands.

Include completed work that matters for continuing, but not a chronological session log.

## Relevant context

### Requirements

List only the specification sections or requirement IDs relevant to this task.

### Decisions

List only accepted or proposed decision records relevant to this task.

### Files

List only the code, tests, configuration, or documentation currently relevant.

## Work completed

Summarize meaningful progress already made.

Do not reproduce diffs or implementation history that can be recovered from Git.

## Verification

Record only verification relevant to continuing the task:

- tests run
- builds or linting run
- important manual checks
- known verification still missing

## Open questions / risks

List unresolved questions, assumptions, blockers, or risks that still affect this task.

## Next exact step

State the next concrete action that should be performed when work resumes.

It should be specific enough that a new session can continue without reconstructing the previous conversation.

## Cleanup when complete

When the task is finished:

1. move durable current state to `docs/project-state.md` when appropriate
2. record significant accepted rationale under `docs/decisions/` when appropriate
3. ensure implementation truth is represented by code and tests
4. delete `.codex/task-handoff.md`
