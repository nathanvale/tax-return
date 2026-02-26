---
status: pending
priority: p3
issue_id: "060"
tags: [code-review, testing, coderabbit]
dependencies: []
---

# Move Test Config Cleanup into afterEach Hook

## Problem Statement

In `tests/xero/history.test.ts`, the temporary `.xero-config.json` file is cleaned up manually within the test body. If the test fails before reaching cleanup, the file persists and can leak into subsequent test runs.

## Findings

- CodeRabbit flagged lines 40-43 in `tests/xero/history.test.ts`
- Config file written with `Bun.write(..., mode: 0o600)` then deleted manually around line 86
- No `afterEach` hook ensures cleanup on test failure
- Leaked config files could cause flaky tests or false passes

## Proposed Solutions

### Option 1: Add afterEach cleanup hook

**Approach:** Create an `afterEach` that removes `.xero-config.json` via `fs.unlink` (swallowing ENOENT). Remove the manual cleanup from the test body.

**Pros:**
- Guarantees cleanup even on test failure
- Standard vitest pattern

**Cons:**
- None significant

**Effort:** 15 min

**Risk:** Low

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**
- `tests/xero/history.test.ts:40-43` - config write
- `tests/xero/history.test.ts:86` - manual cleanup

## Acceptance Criteria

- [ ] afterEach hook removes `.xero-config.json` safely
- [ ] Manual cleanup removed from test body
- [ ] Tests pass with and without prior config file
- [ ] Test failure leaves no leaked config file

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Claude Code (CodeRabbit review)

**Actions:**
- CodeRabbit flagged test cleanup pattern as potential_issue
- Confirmed finding is valid - no afterEach guard exists

**Learnings:**
- Standard pattern: always use afterEach for temp file cleanup in tests
