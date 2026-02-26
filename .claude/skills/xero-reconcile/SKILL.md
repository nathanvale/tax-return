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

### 0) Preflight check

```bash
bun run xero-cli status --json
```

Checks env, config, keychain, state file, lock file, audit dir, and API connectivity. Returns a `diagnosis` field (`ok`, `needs-auth`, `invalid-config`, `api-error`, `keychain-locked`, `keychain-denied`, `fs-error`) and a `nextAction` hint. Run this before any workflow to verify readiness.

### 1) Auth (first run only)

**Important:** Auth requires human interaction. It starts a local callback server on `127.0.0.1:5555` and opens a browser for Xero OAuth2 PKCE login. A human must complete the login in the browser before the CLI can proceed.

```bash
bun run xero-cli auth
```

Optional timeout (seconds, default 300):

```bash
bun run xero-cli auth --auth-timeout 120
```

**Headless/agent mode:** When running in a non-TTY environment or when `XERO_HEADLESS=1` is set, the CLI does not open a browser. Instead it emits the auth URL as structured JSON to stdout:

```json
{ "authUrl": "https://login.xero.com/identity/connect/authorize?..." }
```

The agent or orchestrator must present this URL to a human for completion. The callback server still listens on `127.0.0.1:5555` and the CLI blocks until the callback arrives or the timeout expires.

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

Pagination and limiting:

```bash
# Server-side pagination (Xero API page number, 1-based)
bun run xero-cli transactions --unreconciled --json --page 1

# Client-side limit (return only first N rows)
bun run xero-cli transactions --unreconciled --json --limit 20
```

Date range filters:

```bash
bun run xero-cli transactions --since 2026-01-01 --until 2026-03-31 --json
bun run xero-cli transactions --this-quarter --json
bun run xero-cli transactions --last-quarter --json
```

Note: `--this-quarter` and `--last-quarter` are mutually exclusive. When `--summary` is used without an explicit date range, it defaults to the current quarter.

Token-efficient projection:

```bash
bun run xero-cli transactions --unreconciled --json --fields BankTransactionID,Total,Contact.Name,Date
```

### 3) Pull chart of accounts

```bash
bun run xero-cli accounts --json
```

Filter by account type:

```bash
bun run xero-cli accounts --type REVENUE --json
```

Token-efficient projection:

```bash
bun run xero-cli accounts --json --fields Code,Name,Type
```

### 4) Pull reconciliation history (optional signal)

```bash
bun run xero-cli history --since YYYY-MM-DD --json
```

`--since` is required. Optional filters:

```bash
bun run xero-cli history --since 2025-01-01 --contact "Acme Corp" --json
bun run xero-cli history --since 2025-01-01 --account-code 400 --json
```

Token-efficient projection:

```bash
bun run xero-cli history --since 2025-01-01 --json --fields Contact,AccountCode,Count,AmountMin,AmountMax
```

### 4a) Pull invoices (for invoice-based reconciliation)

```bash
bun run xero-cli invoices --json
```

**Default filter:** When no `--status` or `--type` is specified, the invoices command defaults to `Status=="AUTHORISED"` (i.e., only outstanding invoices). Specifying any filter overrides this default.

```bash
# Filter by status (overrides the AUTHORISED default)
bun run xero-cli invoices --status PAID --json

# Filter by type
bun run xero-cli invoices --type ACCREC --json

# Both filters combined
bun run xero-cli invoices --status AUTHORISED --type ACCREC --json
```

Token-efficient projection:

```bash
bun run xero-cli invoices --json --fields InvoiceID,Contact.Name,Total,AmountDue,CurrencyCode
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

## Output Mode

- **Auto-JSON:** When stdout is not a TTY (e.g., piped or agent-invoked), `--json` is enabled automatically. No need to pass it explicitly in agent workflows.
- `--quiet` outputs minimal single-line results.
- `--verbose` and `--debug` emit structured logs to stderr.

## Command Aliases

For brevity in interactive use:

| Alias | Full command |
|-------|-------------|
| `tx` | `transactions` |
| `acct` | `accounts` |
| `inv` | `invoices` |
| `rec` | `reconcile` |
| `hist` | `history` |

## `--fields` Support

The `--fields` flag is available on all list commands: `accounts`, `transactions`, `history`, and `invoices`. It accepts a comma-separated list of dot-path field names (e.g., `Contact.Name`, `LineItems.AccountCode`). Fields must match the pattern `[A-Za-z0-9_.]`.

## Safety Notes

- Account-code reconciliation uses `IsReconciled: true` (conversion/migration flow)
- For bank-feed accounts, this may not match statement lines
