---
status: pending
priority: p1
issue_id: "045"
tags: [code-review, performance]
dependencies: []
---

# N+1 API Calls in AccountCode Reconciliation Path

## Problem Statement

For every input with an AccountCode, the reconcile command makes an individual GET request to fetch the bank transaction. For a 1,000-item batch, this produces 1,000 individual API calls. With Xero's 60-call/minute rate limit, this becomes 16+ minutes just for pre-fetch.

## Findings

- **Source:** Performance Oracle
- **File:** `src/cli/commands/reconcile.ts` (lines 756-793)
- **Evidence:** `fetchBankTransaction()` called per-item in the reconcile loop
- **Impact:** 10-60x slower than necessary at moderate scale. 200+ seconds of network latency for 1,000 items best case.

## Proposed Solutions

### Option A: Enrich snapshot fetch to include LineItems
- Modify `fetchUnreconciledSnapshot` to return full transaction data
- Pros: Eliminates per-item fetch entirely
- Cons: Larger initial payload
- Effort: Medium
- Risk: Low

### Option B: Batch-fetch transactions in groups of 50
- Use `/BankTransactions?IDs={comma-separated}` before entering the reconcile loop
- Pros: Reduces 1,000 calls to ~20 calls
- Cons: Requires restructuring the loop
- Effort: Medium
- Risk: Low

## Acceptance Criteria

- [ ] Reconciling 100 items does not make 100 individual GET requests
- [ ] Performance test showing <2 min for 100-item batch (currently ~3.5 min)

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | Performance Oracle identified as P0 |
