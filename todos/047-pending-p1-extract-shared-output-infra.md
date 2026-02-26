---
status: pending
priority: p1
issue_id: "047"
tags: [code-review, architecture, quality]
dependencies: []
---

# Extract Shared Output Infrastructure (~400 LOC Duplicated)

## Problem Statement

The following types, functions, and constants are copy-pasted identically across 7 command files plus command.ts (8 total copies): `OutputContext`, `ExitCode`, exit constants, `ERROR_CODE_ACTIONS`, `writeSuccess`, `writeError`, `projectFields`, and the error catch block pattern. This is ~400 lines of pure duplication.

The `ERROR_CODE_ACTIONS` map in command.ts has 12 entries while command modules only have 4 -- meaning agent error metadata is already inconsistent (rate-limit errors get `ESCALATE` instead of `WAIT_AND_RETRY` at the command level).

Error messages in command-level catches also lack the `sanitizeErrorMessage` treatment that command.ts applies.

## Findings

- **Source:** TypeScript Reviewer, Architecture Strategist, Code Simplicity Reviewer, Agent-Native Reviewer (unanimous across all 4)
- **Files:** All 7 command files + command.ts
- **Evidence:** Byte-for-byte identical implementations; ERROR_CODE_ACTIONS drift already observable
- **Impact:** Maintenance trap + inconsistent agent error metadata + missing sanitization in command catches

## Proposed Solutions

### Option A: Create `src/cli/output.ts` shared module
Extract `OutputContext`, `ExitCode`, exit constants, `ERROR_CODE_ACTIONS` (full 12-entry version), `writeSuccess`, `writeError`, `projectFields`, and a `handleCommandError` utility.
- Pros: ~350-400 LOC removed, single source of truth, fixes ERROR_CODE_ACTIONS drift AND missing sanitization
- Cons: One more import per command file
- Effort: Medium
- Risk: Low (pure refactor, no behavior change)

## Acceptance Criteria

- [ ] Single definition of `writeSuccess`, `writeError`, `projectFields`
- [ ] Single `ERROR_CODE_ACTIONS` map with all 12 entries
- [ ] All command error catches use `sanitizeErrorMessage`
- [ ] All existing tests pass unchanged

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | Unanimous finding across 4 review agents |
