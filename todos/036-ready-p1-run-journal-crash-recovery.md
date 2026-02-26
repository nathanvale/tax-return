---
status: ready
priority: p1
issue_id: "036"
tags: [safety, state, recovery]
dependencies: []
---

# Add durable run journal for crash recovery

## Problem Statement

If the process is killed between a successful API payment creation and the state file write, there's an unrecoverable gray zone -- the payment exists in Xero but the state file doesn't know about it. The "server-side check" (query Xero for existing payments) is mentioned in the plan but not detailed in the reconciliation loop.

## Findings

- Operator review (Pass 3, Critical #1)
- State file write happens AFTER successful API call -- crash gap exists
- Plan mentions server-side duplicate check but it's a concept, not implemented in the flow

**Source:** Operator review (Pass 3)

## Proposed Solutions

### Option 1: Server-side pre-check before payment creation (recommended)

**Approach:** Before creating a payment for a matched transaction, query Xero for existing payments on that invoice. If a payment already exists with matching amount/bank account, skip it. This is the server-side idempotency check already mentioned in the plan -- just make it explicit in the reconciliation loop.

This is simpler than a full run journal and covers the crash gap: on re-run, the pre-check catches payments created but not recorded in state.

**Effort:** 30 minutes | **Risk:** Low (adds API calls but within rate limits for typical volumes)

### Option 2: Per-run JSONL journal (heavier)

**Approach:** Write a `.xero-reconcile-runs/<runId>.jsonl` recording planned/attempted/succeeded/failed per transaction. On re-run, check journal for completed items.

**Effort:** 1-2 hours | **Risk:** Medium (adds complexity, file management)

## Acceptance Criteria

- [ ] Server-side duplicate check is explicit in the reconciliation loop (before payment creation)
- [ ] Crash between API success and state write is recoverable on re-run
- [ ] No duplicate payments created on re-run after crash

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Operator review (Pass 3, Critical #1). Chose Option 1 (server-side pre-check) over full run journal -- simpler and sufficient for single-user MVP.
