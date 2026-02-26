---
status: pending
priority: p3
issue_id: "059"
tags: [code-review, quality]
dependencies: ["047"]
---

# Minor Type Safety and Code Quality Fixes

## Problem Statement

Several small type safety issues and code quality items across the codebase.

## Findings

- **Source:** TypeScript Reviewer
- **Items:**
  1. Replace `as` casts with type guards in filter/map chains (reconcile.ts lines 475, 691)
  2. Replace `ReturnType<typeof import(...)>` with direct `EventsConfig` import (all command files)
  3. Fix `mapHttpError` in api.ts -- throws for 401/403 but return type says `XeroApiError` (misleading)
  4. Fix misplaced JSDoc on `revokeToken` in auth.ts (line 487)
  5. Cache `loadEnvConfig()` result (Performance Oracle OPT-4)
  6. Single-pass summary instead of 4x `.filter()` in reconcile.ts (Performance Oracle OPT-6)

## Acceptance Criteria

- [ ] No `as string[]` casts where type guards work
- [ ] `EventsConfig` imported directly, not via `ReturnType<typeof import(...)>`
- [ ] `mapHttpError` return type is accurate
- [ ] All JSDoc comments match their functions

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | TypeScript Reviewer + Performance Oracle |
