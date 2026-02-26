---
status: pending
priority: p2
issue_id: "053"
tags: [code-review, architecture, security]
dependencies: ["047"]
---

# Consolidate Duplicate Lock and Utility Implementations

## Problem Statement

Three utilities are duplicated across files:
1. `isProcessAlive()` -- identical in `src/xero/auth.ts` and `src/state/lock.ts`
2. `assertSecureFile()` -- identical in `src/xero/config.ts` and `src/state/state.ts`
3. Lock acquisition logic -- similar patterns in `withRefreshLock()` (auth.ts) and `acquireLock()`/`releaseLock()` (lock.ts)

Both lock implementations also have a TOCTOU race condition (Security Sentinel MEDIUM-3).

## Findings

- **Source:** TypeScript Reviewer, Architecture Strategist, Code Simplicity Reviewer, Security Sentinel
- **Impact:** Drift risk, ~60 LOC duplication, TOCTOU race in both lock implementations

## Proposed Solutions

### Option A: Shared utilities + unified lock
- Extract `isProcessAlive` and `assertSecureFile` to shared modules
- Create a generic `withFileLock(path, fn)` that both auth and reconcile use
- Consider `mkdir`-based locking for TOCTOU safety (Security Sentinel recommendation)
- Effort: Medium
- Risk: Low

## Acceptance Criteria

- [ ] Single `isProcessAlive` implementation
- [ ] Single `assertSecureFile` implementation
- [ ] Lock logic shared between auth refresh and reconcile

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | 4 agents flagged duplication; Security flagged TOCTOU |
