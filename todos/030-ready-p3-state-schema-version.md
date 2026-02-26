---
status: done
priority: p3
issue_id: "030"
tags: [state, schema, migration]
dependencies: []
---

# Add state schema version with migration hook

## Problem Statement

The state file has no version field. If the schema changes in a future update, there's no way to detect old-format state files or migrate them. This could cause silent data corruption or crashes.

## Findings

- State file is JSON with processed transaction IDs
- No `schemaVersion` or `version` field mentioned in plan
- Plan mentions "Schema-versioned JSON" (line 411) but no code example

**Source:** Architect review (Pass 1, Nice-to-have #2)

## Proposed Solutions

### Option 1: Add version field

**Approach:** Add `"schemaVersion": 1` to state JSON. On load, check version and migrate or fail with message.

**Effort:** 15 minutes | **Risk:** Low

## Acceptance Criteria

- [x] State JSON includes `schemaVersion` field
- [x] Load function checks version and warns if mismatched

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code
**Actions:** Filed from Architect review (Pass 1, Nice-to-have #2)

### 2026-02-26 - Resolved in MVP plan

**By:** Claude Code
**Actions:**
- Added `schemaVersion: 1` as first field in state JSON schema example (MVP plan, Idempotency section)
- Updated `state.ts` description in project structure to note schemaVersion check on load
- Updated `state.ts` description in Phase 2 files list to describe version mismatch warning behavior
- Updated `.xero-reconcile-state.json` comment to note schema-versioned
- Marked todo as done
