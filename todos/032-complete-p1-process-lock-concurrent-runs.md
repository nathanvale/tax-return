---
status: complete
priority: p1
issue_id: "032"
tags: [safety, state, concurrency]
dependencies: []
---

# Add process lock to prevent concurrent reconciliation runs

## Problem Statement

Two simultaneous `xero-reconcile --execute` runs can both pass state pre-checks and create duplicate payments. Atomic file rename prevents torn writes but not concurrent logical races.

## Findings

- Architect review (Pass 1, Critical #3)
- YAGNI section says "single user, single process" but nothing prevents accidental double-runs (two terminals, or re-running while first is still processing)

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Lock file with exclusive open (recommended)

**Approach:** Before execute mode, create `.xero-reconcile-state.lock` with `Bun.file().writer()` using exclusive mode. Fail-fast with clear message if locked. Release on exit (including crash via process signal handler).

**Effort:** 20 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] Concurrent runs fail-fast with clear error message
- [ ] Lock is released on normal exit and crash (signal handler)
- [ ] Lock only applies to --execute mode (dry-run can run in parallel)

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Architect review (Pass 1, Critical #3)
