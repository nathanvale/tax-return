---
status: pending
priority: p2
issue_id: "064"
tags: [code-review, bug, coderabbit]
dependencies: []
---

# AccountCode Required in CSV Validation but Optional in Schema

## Problem Statement

In `src/cli/commands/reconcile.ts`, the CSV row validation requires `AccountCode` in the `required` array and skips rows missing it. However, `ReconcileItemSchema` marks `AccountCode` as optional. This mismatch silently drops invoice-based reconciliation rows that legitimately lack an `AccountCode`.

## Findings

- CodeRabbit flagged lines 361-374 in `src/cli/commands/reconcile.ts`
- `required` array includes `AccountCode`
- Row-skip condition checks `record.AccountCode` presence
- `ReconcileItemSchema` defines `AccountCode` as optional
- Invoice-based reconciliation doesn't need `AccountCode` - only `BankTransactionID` is required
- Silent row dropping means users get partial reconciliation with no warning

## Proposed Solutions

### Option 1: Remove AccountCode from required list

**Approach:** Remove `AccountCode` from the `required` array and the row-skip condition. Keep `BankTransactionID` as the only required field. This aligns with `ReconcileItemSchema`.

**Pros:**
- Fixes the bug
- Matches schema definition
- Enables invoice-based reconciliation from CSV

**Cons:**
- Need to verify downstream code handles missing AccountCode

**Effort:** 30 min

**Risk:** Low

---

### Option 2: Make AccountCode mandatory in schema

**Approach:** Update `ReconcileItemSchema` to make `AccountCode` required, matching the CSV validation.

**Pros:**
- Removes the mismatch

**Cons:**
- Blocks invoice-based reconciliation
- Schema was likely optional for a reason

**Effort:** 15 min

**Risk:** Medium - may break valid use cases

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**
- `src/cli/commands/reconcile.ts:361-374` - CSV validation loop
- Schema definition for `ReconcileItemSchema`

## Acceptance Criteria

- [ ] Schema and validation agree on AccountCode optionality
- [ ] Invoice-based reconciliation rows (no AccountCode) not silently dropped
- [ ] Rows missing BankTransactionID still skipped with warning
- [ ] Unit tests cover rows with and without AccountCode

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Claude Code (CodeRabbit review)

**Actions:**
- CodeRabbit flagged schema/validation mismatch for AccountCode
- Confirmed required array and schema disagree

**Learnings:**
- Schema should be the source of truth for field optionality
- Silent row dropping is a data integrity risk
