---
status: pending
priority: p2
issue_id: "061"
tags: [code-review, concurrency, coderabbit]
dependencies: []
---

# TOCTOU Race in acquireLock writeFile

## Problem Statement

`acquireLock` in `src/state/lock.ts` has a time-of-check-to-time-of-use race: between `readLock`/`unlink` and `writeFile`, a concurrent process can create the lock file. The `writeFile` then throws a generic error instead of a clear "another run in progress" message.

## Findings

- CodeRabbit flagged lines 39-56 in `src/state/lock.ts`
- Window exists between checking/removing stale lock and writing new lock
- If concurrent process creates lock in that window, `writeFile` throws EEXIST
- Error surfaces as generic rather than the expected "Another reconcile run is in progress"
- Related to todo 053 (consolidate lock implementations) but this is a distinct bug

## Proposed Solutions

### Option 1: Catch EEXIST on writeFile

**Approach:** Wrap `writeFile` in try/catch. If `error.code === 'EEXIST'`, re-read the lock to confirm it's valid, then throw `Error('Another reconcile run is in progress')`. Rethrow other errors as-is.

**Pros:**
- Minimal change, handles the race gracefully
- Clear error message for users/agents

**Cons:**
- Doesn't eliminate the race, just handles it cleanly

**Effort:** 30 min

**Risk:** Low

---

### Option 2: Use O_EXCL flag for atomic create

**Approach:** Use `fs.open` with `wx` flag (O_CREAT | O_EXCL) instead of `writeFile`. This atomically creates-or-fails, eliminating the race entirely.

**Pros:**
- Eliminates TOCTOU race at the OS level
- More correct solution

**Cons:**
- Slightly more code to write contents after open
- Need to handle the fd lifecycle

**Effort:** 1 hour

**Risk:** Low

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**
- `src/state/lock.ts:39-56` - acquireLock function

**Related todos:**
- 053 (consolidate lock implementations) - could address this during consolidation

## Acceptance Criteria

- [ ] Concurrent lock acquisition produces clear error message
- [ ] No generic/uncaught EEXIST errors surface to user
- [ ] Existing lock behavior (stale lock cleanup, PID check) preserved
- [ ] Tests cover concurrent lock scenario

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Claude Code (CodeRabbit review)

**Actions:**
- CodeRabbit flagged TOCTOU race between readLock/unlink and writeFile
- Confirmed the race window exists in the code

**Learnings:**
- Lock files should use O_EXCL for atomic creation where possible
- Could combine with todo 053 during lock consolidation
