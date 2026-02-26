---
status: pending
priority: p2
issue_id: "049"
tags: [code-review, performance]
dependencies: []
---

# State File Write-Per-Item Causes Quadratic I/O in Reconcile

## Problem Statement

Every successfully reconciled transaction triggers `markProcessed` + `saveState`. Each `markProcessed` creates a full shallow copy of the `processed` record via spread, then `saveState` serializes the entire state to JSON and writes it atomically. For 1,000 items with 5,000 previously processed, this produces ~5.5M key slot copies and 3,000 filesystem operations.

## Findings

- **Source:** Performance Oracle (CRITICAL-1)
- **Files:** `src/cli/commands/reconcile.ts` (801-802, 869-870), `src/state/state.ts` (64-83, 86-94)
- **Impact:** Hundreds of MB of transient allocations, potentially seconds of pure serialization overhead at scale

## Proposed Solutions

### Option A: Batch state writes
- Accumulate all changes in memory, write once at end of batch (or every 50 items)
- Pros: Eliminates quadratic I/O
- Cons: Slightly more state loss risk on crash (mitigated by audit trail)
- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] State file written at most once per batch (or per checkpoint interval)
- [ ] Reconcile 1,000 items without noticeable I/O overhead
- [ ] Audit trail still captures per-item results

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | Performance Oracle CRITICAL-1 |
