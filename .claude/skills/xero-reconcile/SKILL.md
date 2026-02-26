---
name: xero-reconcile
description: >
  Reconcile Xero bank transactions using xero-cli. Use when the user asks about
  Xero reconciliation, unreconciled transactions, bank categorization, or
  account code assignment. Safe by default -- read-only analysis, writes only
  after user confirmation.
disable-model-invocation: true
allowed-tools: Bash(bun run xero-cli *)
argument-hint: [quarter|all]
---

# xero-reconcile

Agent runbook for reconciling Xero bank transactions via `xero-cli`.

## Core Principles

- **Read first, write last.** All writes require explicit user confirmation.
- **Dry-run default.** `reconcile` only performs writes with `--execute`.
- **Small batches.** For large runs, chunk 50 at a time.
- **Never assume.** If confidence is low or data incomplete, ask.

## Quick Start

```bash
# 1. Check readiness
bun run xero-cli status --json

# 2. Pull unreconciled transactions for this quarter
bun run xero-cli transactions --unreconciled --this-quarter --summary

# 3. Pull full details + chart of accounts + history
bun run xero-cli transactions --unreconciled --this-quarter --json
bun run xero-cli accounts --json --fields Code,Name,Type
bun run xero-cli history --since 2025-01-01 --json --fields Contact,AccountCode,Count

# 4. Analyze, propose, confirm with user, then execute
echo '[...]' | bun run xero-cli reconcile --execute --json
```

## Intake

When the user invokes `/xero-reconcile`, determine what they need:

1. **"reconcile [quarter]"** or **"reconcile all"** -- Full quarterly reconciliation.
   Read `workflows/reconcile-quarter.md` and follow it step by step.

2. **"review"** or **"import CSV"** -- User has reviewed uncertain items and wants to import decisions.
   Read `workflows/review-uncertain.md` and follow it.

3. **Unclear** -- Ask:
   > What would you like to do?
   > 1. Reconcile unreconciled transactions (quarter or all)
   > 2. Import reviewed CSV decisions for uncertain items

## Workflows

| Workflow | File | When to use |
|----------|------|-------------|
| Reconcile quarter | `workflows/reconcile-quarter.md` | Full reconciliation run |
| Review uncertain | `workflows/review-uncertain.md` | Import CSV decisions |

## References

| Reference | File | When to read |
|-----------|------|-------------|
| Command reference | `references/command-reference.md` | Need CLI flags, examples, or field projection |
| Error handling | `references/error-handling.md` | Hit an error, need retry/batch strategy |

## Success Criteria

- All confident transactions reconciled (dry-run passes, then `--execute`)
- Uncertain items exported as CSV for user review
- No unhandled errors
- User confirmed every write operation before execution
- Progress reported for batches >50 items
