---
name: xero-reconcile
description: >
  Reconcile Xero bank transactions for a quarter. Pulls unreconciled
  transactions, analyzes against chart of accounts and history, proposes
  account codes, and executes after user confirmation. Writes only after
  explicit approval.
disable-model-invocation: true
allowed-tools: Bash(bun run xero-cli *)
context: fork
argument-hint: [quarter|all]
---

# xero-reconcile

Full quarterly reconciliation of Xero bank transactions via `xero-cli`.

For CLI flags and examples, read [../xero-cli/references/command-reference.md](../xero-cli/references/command-reference.md).
For error codes and retry policy, read [../xero-cli/references/error-handling.md](../xero-cli/references/error-handling.md).

## Core Principles

- **Read first, write last.** All writes require explicit user confirmation.
- **Dry-run default.** `reconcile` only performs writes with `--execute`.
- **Small batches.** Chunk 50 at a time for reconcile.
- **Never assume.** If confidence is low or data incomplete, ask.

## Step 1: Preflight

```bash
bun run xero-cli status --json
```

Check the `diagnosis` field:
- `ok` -- proceed to step 2
- `needs-auth` -- run step 1a
- Anything else -- report to user and stop

### Step 1a: Auth (if needed)

```bash
bun run xero-cli auth
```

Auth requires human interaction (browser-based OAuth2 PKCE). In headless mode (`XERO_HEADLESS=1`), present the emitted `authUrl` to the user. The callback server listens on `127.0.0.1:5555`.

## Step 2: Pull unreconciled transactions

Start with a summary to gauge volume:

```bash
bun run xero-cli transactions --unreconciled --this-quarter --summary
```

If the user specified a different date range, use `--since` / `--until` or `--last-quarter` instead.

Then pull full details using progressive loading (see token budget below):

```bash
bun run xero-cli transactions --unreconciled --this-quarter --json \
  --fields BankTransactionID,Total,Contact.Name,Date,Type,CurrencyCode
```

## Step 3: Pull chart of accounts

```bash
bun run xero-cli accounts --json --fields Code,Name,Type
```

Load once (~2K tokens). Keep in context for all subsequent analysis.

## Step 4: Pull reconciliation history

```bash
bun run xero-cli history --since YYYY-MM-DD --json \
  --fields Contact,AccountCode,Count,AmountMin,AmountMax
```

Use a `--since` date that covers enough history for pattern matching (typically 6-12 months back). Load once (~4K tokens).

## Step 5: Pull invoices (if RECEIVE transactions exist)

Only needed if there are incoming (RECEIVE) transactions that might match invoices:

```bash
bun run xero-cli invoices --json --fields InvoiceID,Contact.Name,Total,AmountDue,CurrencyCode
```

Default filter is `Status=="AUTHORISED"` (outstanding invoices only).

**Invoice derivation rules:**
- `Amount` comes from the BankTransaction's `Total` field (not the Invoice)
- `CurrencyCode` comes from the BankTransaction's `CurrencyCode` field
- Both are required in the reconcile input
- If BankTransaction currency does not match Invoice currency, flag for manual review

## Step 6: Analyze and categorize

Process transactions in chunks of 50 (~5K tokens per chunk). For each chunk, classify every transaction:

**Decision tree:**

- Invoice match confident (has `InvoiceID`, `Amount`, `CurrencyCode`) -- **Confident**
- Contact + amount matches history with same account code -- **Confident**
- No history match -- **Needs input** (add note explaining why)
- Ambiguous description (bank transfer, cash, unknown) -- **Needs input**
- If any invoice fields are missing -- **Needs input**

**Contact name normalization for history matching:**

Bank descriptions are inconsistent (e.g., "GITHUB INC" vs "GITHUB.COM" vs "GH *GITHUB"). Apply:
- Strip common suffixes: PTY LTD, INC, LLC, CORP, LIMITED, P/L
- Normalize whitespace (collapse multiple spaces, trim)
- Case-insensitive comparison
- If match confidence is low, mark as **Needs input** rather than assuming

**BankTransactionID immutability:**
- Carry BankTransactionID unchanged from fetch through proposal and execute
- NEVER reconstruct IDs from display fields (Contact name, amount, date)
- If dropping a transaction from the proposal, drop the entire entry

Accumulate proposals across chunks. Target: <20K tokens per analysis step.

## Step 7: Present proposal to user

Show a summary table of categories and account codes:

```
I can reconcile 318 transactions confidently.
57 need your input.

By account code:
  6310 Software/SaaS:     42 items ($2,340.50)
  6420 Entertainment:      89 items ($1,230.80)
  6440 Motor Vehicle:      67 items ($4,560.00)
  ...

Invoice matches: 12 items ($41,230.00 AUD)

Proceed with the 318 confident ones? (yes/no)
```

Do NOT proceed without explicit confirmation.

## Step 8: Execute reconcile

Build JSON array and pipe to reconcile:

```bash
echo '[
  { "BankTransactionID": "...", "AccountCode": "400" },
  { "BankTransactionID": "...", "InvoiceID": "...", "Amount": 1200.00, "CurrencyCode": "AUD" }
]' | bun run xero-cli reconcile --execute --json
```

**Batch strategy:** Chunk into groups of 50. Max 1000 items per invocation. For >200 items, report progress after each batch.

**Auth recovery mid-reconcile:** If a batch fails with `E_UNAUTHORIZED`:
1. Run `bun run xero-cli auth`
2. Re-run `reconcile` with the same stdin (idempotent via state file)
3. Do NOT re-fetch transactions -- data in context is still valid

For other errors, read `../xero-cli/references/error-handling.md`.

## Step 9: Export uncertain items

Generate a CSV for human review:

```
BankTransactionID,Date,Amount,Contact,Description,SuggestedAccountCode,Confidence,Notes
```

Tell the user they can fill in the AccountCode column and return it via `/xero-review`.

## Success Criteria

- All confident transactions reconciled (dry-run passes, then `--execute`)
- Uncertain items exported as CSV for user review
- No unhandled errors
- User confirmed every write operation before execution
- Progress reported for batches >50 items
