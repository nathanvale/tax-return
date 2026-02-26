---
status: pending
priority: p2
issue_id: "070"
tags: [code-review, performance, api, xero]
dependencies: []
---

# Eliminate N+1 BankTransaction fetch pattern in reconcile loop

The reconcile loop fetches each transaction individually, increasing request volume linearly and raising rate-limit pressure.

## Findings

- Per-item fetch in account flow: [src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:756).
- Per-item fetch in invoice flow: [src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:835).
- Blast radius: high API call counts and longer runtime on large batches.

## Proposed Solutions

### Option 1: Prefetch required transaction details in paged batches (Recommended)

**Approach:** Build a map of needed transactions before loop execution.

**Pros:** Fewer API round-trips; more predictable throughput.

**Cons:** More memory use; batch orchestration required.

**Effort:** Medium

**Risk:** Low

---

### Option 2: In-loop LRU cache

**Approach:** Cache fetched transactions by ID to avoid duplicate lookups.

**Pros:** Small change, immediate gains when IDs repeat.

**Cons:** Limited impact if IDs are unique.

**Effort:** Small

**Risk:** Low

---

### Option 3: Keep current fetch pattern

**Approach:** No change.

**Pros:** Simple.

**Cons:** Rate-limit and latency risk remain.

**Effort:** None

**Risk:** Medium

## Recommended Action


## Technical Details

- Affected files:
- [src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:756)
- [src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:835)

## Resources

- PR branch: `feat/xero-cli-agent-native`

## Acceptance Criteria

- [ ] API request count scales sub-linearly with input size.
- [ ] Reconcile runtime improves on 100+ input test case.
- [ ] Existing reconciliation correctness tests remain green.

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed execute loop and network call sites.
- Confirmed one fetch per reconciled item path.

**Learnings:**
- This compounds with per-item state writes to extend lock duration.

## Notes

- Prioritize with issue `063` for end-to-end throughput improvements.
