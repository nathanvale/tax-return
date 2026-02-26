---
status: done
priority: p1
issue_id: "021"
tags: [state, data-integrity, side-quest-core]
dependencies: []
---

# Verify @side-quest/core/fs atomicity for idempotency-critical state

## Problem Statement

The plan uses `loadJsonStateSync()`/`saveJsonStateSync()` from `@side-quest/core/fs` for reconciliation state (tracking processed transactions). The plan also mentions "atomic write -- write to temp file, then rename" (line 225). It's unclear whether `@side-quest/core/fs` implements atomic writes internally. If not, a crash during state save could corrupt the state file and lose idempotency guarantees.

## Findings

- Plan line 75: `loadJsonStateSync()`, `saveJsonStateSync()` from `@side-quest/core/fs`
- Plan line 225: "Atomic token writes -- write to temp file, then rename"
- State file tracks which transactions have been reconciled (prevents duplicate payments)
- If state is corrupted, re-run could create duplicate payments (real money)
- `@side-quest/core` catalog was analyzed but atomicity guarantees not verified

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Verify @side-quest/core implementation

**Approach:** Read the source of `saveJsonStateSync()` to confirm it uses temp-file + rename pattern.

**Pros:**
- No code changes if it already handles atomicity
- Quick verification

**Cons:**
- If it doesn't, need custom implementation

**Effort:** 15 minutes to verify

**Risk:** Low

### Option 2: Use writeJsonFileAtomic() from @side-quest/core/fs

**Approach:** The catalog also lists `writeJsonFileAtomic()` which explicitly promises atomicity. Use that instead of `saveJsonStateSync()`.

**Pros:**
- Atomicity guaranteed by name
- Already in the dependency

**Cons:**
- May have different API shape
- Need to check if it handles the state-specific logic

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

Option 1 confirmed - no code changes needed. `saveJsonStateSync()` already implements atomic writes internally.

## Acceptance Criteria

- [x] State writes verified as atomic (temp file + rename)
- [x] Plan references the correct @side-quest/core function
- [x] Crash during save cannot corrupt state file

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Identified atomicity assumption in state management
- Filed from Architect review (Pass 1, Critical #6)

**Learnings:**
- For idempotency-critical data, atomicity must be verified, not assumed

### 2026-02-26 - Verified atomicity in @side-quest/core source

**By:** Claude Code

**Actions:**
- Read `@side-quest/core/src/fs/json-state.ts` and `@side-quest/core/src/fs/index.ts`
- Confirmed the full call chain: `saveJsonStateSync()` -> `writeJsonFileSyncAtomic()` -> writes to temp file (`{path}.{uuid}.tmp`) then `renameSync()` to target path
- This is the standard atomic write pattern (temp file + rename) that guarantees crash safety on POSIX filesystems
- Updated MVP plan integration map to note verified atomicity
- Updated MVP plan idempotency section to reference the specific verified function
- No code changes needed - the plan's existing function references are correct

**Findings:**
- `saveJsonStateSync()` (json-state.ts:86-89) calls `ensureParentDirSync()` then `writeJsonFileSyncAtomic()`
- `writeJsonFileSyncAtomic()` (index.ts:696-702) calls `writeTextFileSyncAtomic()`
- `writeTextFileSyncAtomic()` (index.ts:680-687) does: `writeFileSync(tempPath)` then `fsRenameSync(tempPath, filePath)`
- The async variant `writeJsonFileAtomic()` uses the same pattern with `Bun.write()` + `fsRename()`
- `updateJsonFileAtomic()` adds file locking on top for concurrent read-modify-write cycles

**Learnings:**
- `saveJsonStateSync()` is the right choice for single-process state writes (atomic, no locking overhead)
- `updateJsonFileAtomic()` exists for concurrent access scenarios but is overkill for this single-user CLI tool
