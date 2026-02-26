---
status: pending
priority: p2
issue_id: "052"
tags: [code-review, quality]
dependencies: []
---

# Remove Dead Code and Unused Exports (~114 LOC)

## Problem Statement

Several exports, functions, and an entire file are never imported or used.

## Findings

- **Source:** TypeScript Reviewer, Code Simplicity Reviewer
- **Items:**
  - `src/xero/export.ts` (entire file, 59 LOC) -- never imported
  - `src/xero/api.ts` `xeroPost()` (14 LOC) -- never imported
  - `src/xero/auth.ts` `deleteTokens()`, `loadTenantConfig()` -- never imported
  - `src/cli/command.ts` `_EXIT_NOT_FOUND`, `_EXIT_UNAUTHORIZED`, `_EXIT_CONFLICT` -- unused
  - `src/cli/command.ts` `GlobalFlags` interface -- identical to `OutputContext`
  - `src/cli/command.ts` duplicate JSDoc comment (lines 794-795)
  - `src/xero/auth.ts` redundant double-check on empty connections array (536-542)

## Acceptance Criteria

- [ ] All items above removed or consolidated
- [ ] All existing tests pass
- [ ] No unused exports remain

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | Simplicity Reviewer identified ~114 LOC |
