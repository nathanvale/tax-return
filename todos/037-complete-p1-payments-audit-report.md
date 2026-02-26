---
status: complete
priority: p1
issue_id: "037"
tags: [safety, audit, payments]
dependencies: []
---

# Emit machine-readable payments report for rollback/audit

## Problem Statement

Xero has no "undo payment" API -- payments must be deleted manually in the Xero UI or reversed via credit note. If the tool creates incorrect payments, the user has no structured record of what was created and no instructions for manual reversal.

## Findings

- Operator review (Pass 3, Critical #5)
- Current plan collects results but doesn't persist them
- Need: payment IDs, invoice refs, amounts, timestamps, Xero deep links

**Source:** Operator review (Pass 3)

## Proposed Solutions

### Option 1: JSON report file per execute run (recommended)

**Approach:** After `--execute`, write a timestamped JSON report to `.xero-reconcile-runs/YYYY-MM-DDTHH-MM-SS-execute.json` with all created payments (IDs, amounts, invoices) and failures. Include Xero web UI links for manual deletion.

**Effort:** 30 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] Execute run produces a JSON report with all created payments
- [ ] Report includes: paymentId, invoiceId, amount, bankTransactionId, timestamp
- [ ] Report includes Xero web UI link for each payment (for manual reversal)
- [ ] Failures are included with error details

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Operator review (Pass 3, Critical #5)
