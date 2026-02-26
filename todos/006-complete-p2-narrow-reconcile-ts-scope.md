---
status: complete
priority: p2
issue_id: "006"
tags: [code-review, architecture]
dependencies: []
---

# reconcile.ts has three responsibilities -- narrow to orchestration only

## Problem Statement

`reconcile.ts` is described as handling "categorise, execute, manage state" -- that is three distinct responsibilities. The Architecture Strategist recommends narrowing it to pure orchestration: it calls matcher, api, and state but owns none of their logic.

## Findings

- Architecture Strategist: "Orchestrators work best when they do exactly one: coordinate"
- State query logic (e.g., "should I skip this transaction?") should live in `state.ts`, not reconcile.ts
- API execution (creating payments) should live in `api.ts`, not reconcile.ts
- reconcile.ts should wire them together: get data -> match -> filter -> execute -> update state

## Proposed Solutions

### Option 1: Move state decisions to state.ts, payment execution to api.ts

**Approach:**
- `state.ts` owns `isProcessed()`, `shouldSkip()`, and all state query logic
- `api.ts` owns `createPaymentsBatched()` and all API execution
- `reconcile.ts` orchestrates: calls matcher.findPotentialMatches -> state.filterAlreadyProcessed -> api.createPaymentsBatched -> state.markProcessed

**Pros:**
- Clear single responsibility per module
- Each module independently testable
- reconcile.ts tests become integration wiring tests

**Cons:**
- Slightly more function arguments passed around

**Effort:** 1 hour (during implementation)

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/reconcile.ts` -- narrow to orchestration
- `src/xero/state.ts` -- add state query logic
- `src/xero/api.ts` -- owns payment creation

**Dependency graph (from Architecture Strategist):**
```
reconcile.ts -> matcher.ts (pure), api.ts (I/O), state.ts (I/O), export.ts (I/O)
api.ts -> auth.ts -> config.ts
errors.ts -> (no imports from siblings)
```

## Acceptance Criteria

- [ ] reconcile.ts does not contain state query logic
- [ ] reconcile.ts does not contain direct API call logic
- [ ] Dependency graph comment at top of reconcile.ts
- [ ] Each module passes tests independently

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Architecture Strategist)

**Actions:**
- Identified three-responsibility problem
- Proposed dependency graph
- Recommended single-responsibility split
