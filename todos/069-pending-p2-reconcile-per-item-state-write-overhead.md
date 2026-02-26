---
status: pending
priority: p2
issue_id: "069"
tags: [code-review, performance, reliability, xero]
dependencies: []
---

# Reduce per-item state fsync overhead in reconcile

Reconcile writes state to disk after every successful item. This is durable but can become a major throughput bottleneck on large runs.

## Findings

- Save calls occur on each successful account reconciliation ([src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:802)).
- Save calls also occur on each successful invoice flow ([src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:870)).
- Blast radius: slow execution, higher I/O pressure, and more lock hold time under large batches.

## Proposed Solutions

### Option 1: Batch state flush (Recommended)

**Approach:** Persist every N successes and once at completion/interruption.

**Pros:** Large speedup with bounded replay on restart.

**Cons:** Slightly more work reprocessed after crash.

**Effort:** Medium

**Risk:** Low

---

### Option 2: Buffered writer with time-based flush

**Approach:** Flush every X seconds or on signal.

**Pros:** Smoother I/O pattern.

**Cons:** More complexity and timer lifecycle management.

**Effort:** Medium

**Risk:** Medium

---

### Option 3: Keep per-item writes

**Approach:** Retain current durability model.

**Pros:** Simplest recovery semantics.

**Cons:** Throughput penalty remains.

**Effort:** None

**Risk:** High (operational inefficiency)

## Recommended Action


## Technical Details

- Affected files:
- [src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:802)
- [src/cli/commands/reconcile.ts](/Users/nathanvale/code/tax-return/src/cli/commands/reconcile.ts:870)

## Resources

- PR branch: `feat/xero-cli-agent-native`

## Acceptance Criteria

- [ ] Reconcile performs fewer state writes under batch workloads.
- [ ] Interrupt/resume semantics remain correct.
- [ ] Integration test validates crash recovery with batched flush.

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Codex

**Actions:**
- Profiled reconcile control flow for write frequency.
- Verified state persistence is invoked per successful record.

**Learnings:**
- Durability strategy trades too much throughput for granularity.

## Notes

- Pair with lock timeout review when implementing.
