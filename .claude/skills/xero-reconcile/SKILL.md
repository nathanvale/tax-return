---
name: xero-reconcile
description: Reconcile Xero bank transactions using xero-cli (agent-native workflow)
---

# xero-reconcile

Agent runbook for reconciling Xero bank transactions via `xero-cli`. This skill is **safe by default**: it performs analysis in read-only mode and only reconciles after explicit user confirmation.

## Preconditions

- `XERO_CLIENT_ID` set in `.env`
- Auth completed at least once (`bun run xero-cli auth`)
- `xero-cli` available via `bun run xero-cli`

## Core Principles

- **Read first, write last.** All writes require explicit user confirmation.
- **Dry-run default.** `reconcile` only performs writes with `--execute`.
- **Small batches.** For large runs, chunk 50 at a time.
- **Never assume.** If confidence is low or data incomplete, ask.

## Workflow

### 1) Auth (first run only)

```bash
bun run xero-cli auth
```

Success indicators:
- Output includes tenant ID saved to `.xero-config.json`
- No auth errors

### 2) Pull unreconciled transactions

```bash
bun run xero-cli transactions --unreconciled --json
```

For large sets, use summary first:

```bash
bun run xero-cli transactions --unreconciled --summary
```

Token-efficient projection:

```bash
bun run xero-cli transactions --unreconciled --json --fields BankTransactionID,Total,Contact.Name,Date
```

### 3) Pull chart of accounts

```bash
bun run xero-cli accounts --json
```

### 4) Pull reconciliation history (optional signal)

```bash
bun run xero-cli history --since YYYY-MM-DD --json
```

### 5) Analyze + propose

- Group by contact and amount.
- Match against history patterns.
- Identify invoice candidates.
- Split into:
  - **Confident**: auto-reconcile candidates
  - **Needs input**: require user decisions

### 5a) Decision tree (categorization)

- If invoice match is confident:
  - Require `InvoiceID`, `Amount`, `CurrencyCode` from invoice.
  - If any missing, move to **Needs input**.
- If contact + amount appears in history with same account code:
  - Mark as **Confident**.
- If no history match:
  - Mark as **Needs input** with a short note.
- If transaction has ambiguous description (bank transfer, cash, unknown):
  - Always **Needs input**.

### 6) Ask user confirmation

Example prompt:

```
I can reconcile 318 transactions confidently.
57 need your input.
Proceed with the 318 now? (yes/no)
```

### 7) Execute reconcile (write)

Build JSON array:

```json
[
  { "BankTransactionID": "...", "AccountCode": "400" },
  { "BankTransactionID": "...", "InvoiceID": "...", "Amount": 1200.00, "CurrencyCode": "AUD" }
]
```

Run:

```bash
echo '[...]' | bun run xero-cli reconcile --execute --json
```

### 8) Handle uncertain transactions (CSV round-trip)

Export uncertain items for human review:

```
BankTransactionID,Date,Amount,Contact,Description,SuggestedAccountCode,Confidence,Notes
```

User fills in AccountCode column, then:

```bash
bun run xero-cli reconcile --from-csv xero-needs-review-YYYY-MM-DD.csv --execute --json
```

Validation:
- Reject missing BankTransactionID
- Reject invalid AccountCode
- Reject IDs not in current unreconciled set

## Error Handling

- `E_UNAUTHORIZED`: run auth
- `E_USAGE`: fix arguments
- `E_RATE_LIMITED`: wait and retry
- `E_CONFLICT`: wait and retry

If writes fail mid-run:
- Re-run same input. CLI is idempotent via state file.

## Retry Policy

- `E_RATE_LIMITED`: wait 2-5 seconds and retry the same command.
- `E_CONFLICT`: wait and retry once. If it fails again, ask the user.
- `E_UNAUTHORIZED`: run auth, then retry once.
- `E_USAGE`: fix arguments, do not retry blindly.

## Stop / Ask-User Gates

- Any ambiguous categorization
- Missing or conflicting invoice data
- Significant API errors or rate limits
- Any reconciliation affecting multiple accounts
- If >10% of transactions remain in **Needs input**, pause and ask for guidance
- If `E_CONFLICT` repeats twice in a row, stop and ask

## Batch Strategy

- Use chunks of 50 transactions for reconciliation
- For >200 items, loop with progress updates

## Token Budget Strategy

- Use `--fields` to reduce payload sizes.
- Prefer `--summary` when scanning large lists.
- Avoid pulling full transactions unless needed.

## Safety Notes

- Account-code reconciliation uses `IsReconciled: true` (conversion/migration flow)
- For bank-feed accounts, this may not match statement lines
