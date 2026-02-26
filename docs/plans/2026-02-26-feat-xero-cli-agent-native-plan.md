---
title: "feat: xero-cli -- agent-native CLI for Xero bank reconciliation"
type: feat
status: active
date: 2026-02-26
supersedes: 2026-02-26-feat-xero-reconciliation-mvp-plan.md
---

# xero-cli -- Agent-Native CLI for Xero Bank Reconciliation

## The Problem

Nathan has 300-400 unreconciled bank transactions per quarter in Xero. Each one needs an account code assigned (6310 Software, 6440 Motor Vehicle, 6420 Entertainment, etc.) before it can be reconciled. He can't produce financial statements until they're all done. Currently he does them one-by-one in the Xero web app. It takes hours.

## The Approach

Split the work into two layers:

1. **`xero-cli`** -- a dumb CLI that talks to the Xero API. JSON in, JSON out. It reads transactions, reads the chart of accounts, reads history, creates reconciliation entries. It has no opinions about which account code to use. Zero AI dependencies.

2. **Claude Code skill** -- teaches Claude how to use `xero-cli` to pull transactions, analyze them against the chart of accounts and past reconciliation patterns, propose account codes, and execute reconciliation after user approval.

```
┌─────────────────────────────────────────────┐
│  Claude Code                                │
│  "Here are 387 unreconciled transactions.   │
│   Based on your chart of accounts and how   │
│   you categorized similar ones before,      │
│   here's what I'd suggest..."               │
├─────────────────────────────────────────────┤
│  Skill: xero-reconcile                      │
│  Teaches Claude the workflow + CLI commands  │
├─────────────────────────────────────────────┤
│  xero-cli (dumb pipe)                       │
│  auth | transactions | accounts | history   │
│  reconcile | status | help                  │
└─────────────────────────────────────────────┘
```

The CLI follows the agent-native patterns from `@side-quest/observability`:
- Tri-modal output (human / JSON / JSONL)
- Typed exit codes (0-5, 130)
- Structured JSON errors on stderr
- Auto non-TTY detection (pipes JSON automatically)
- Field projection (`--fields` for token economy)
- Self-documenting help system
- Zero runtime dependencies

---

## How a User Consumes This

### First time: Auth

```bash
$ bun run xero-cli auth
Opening Xero login in your browser...
Waiting for callback on 127.0.0.1:5555...

✓ Authenticated as "Nathan Vale Consulting" (AU)
  Tenant ID saved to .xero-config.json
  Tokens saved to macOS Keychain
```

### Pull unreconciled transactions

```bash
# Human mode (default in terminal)
$ bun run xero-cli transactions --unreconciled
Found 387 unreconciled transactions (Jan 1 - Mar 31, 2026)

  Date        Amount      Contact/Description          Type
  2026-01-03  -$5.30      SUMO SALAD MELBOURNE         SPEND
  2026-01-03  -$49.99     GITHUB INC                   SPEND
  2026-01-04  -$142.50    SHELL COLES EXPRESS           SPEND
  2026-01-04  +$2,450.00  ACME CORP PTY LTD            RECEIVE
  ... (383 more)

# JSON mode (for Claude / agents)
$ bun run xero-cli transactions --unreconciled --json
{"status":"data","data":{"command":"transactions","count":387,"transactions":[...]}}

# JSONL mode (for piping)
$ bun run xero-cli transactions --unreconciled --jsonl
{"BankTransactionID":"abc-123","Date":"2026-01-03","Total":"-5.30","Contact":{"Name":"SUMO SALAD MELBOURNE"},"Type":"SPEND"}
{"BankTransactionID":"def-456","Date":"2026-01-03","Total":"-49.99","Contact":{"Name":"GITHUB INC"},"Type":"SPEND"}
...

# Field projection (token-efficient for agents)
$ bun run xero-cli transactions --unreconciled --json --fields BankTransactionID,Total,Contact.Name,Date
```

### Pull chart of accounts

```bash
$ bun run xero-cli accounts --json
{"status":"data","data":{"command":"accounts","count":45,"accounts":[
  {"Code":"6310","Name":"Software & SaaS","Type":"EXPENSE","Status":"ACTIVE"},
  {"Code":"6420","Name":"Entertainment","Type":"EXPENSE","Status":"ACTIVE"},
  {"Code":"6440","Name":"Motor Vehicle Expenses","Type":"EXPENSE","Status":"ACTIVE"},
  ...
]}}
```

### Pull reconciliation history (for Claude to learn patterns)

```bash
$ bun run xero-cli history --since 2025-07-01 --json
{"status":"data","data":{"command":"history","count":892,"transactions":[
  {"Contact":"GITHUB INC","AccountCode":"6310","Amount":"-49.99","Count":6},
  {"Contact":"SHELL COLES EXPRESS","AccountCode":"6440","Amount":"varies","Count":23},
  {"Contact":"SUMO SALAD","AccountCode":"6420","Amount":"varies","Count":12},
  ...
]}}
```

### Execute reconciliation (batch)

```bash
# Reconcile transactions with account codes (JSON input on stdin)
$ echo '[
  {"BankTransactionID":"abc-123","AccountCode":"6420"},
  {"BankTransactionID":"def-456","AccountCode":"6310"},
  {"BankTransactionID":"ghi-789","InvoiceID":"inv-001"}
]' | bun run xero-cli reconcile --json

{"status":"data","data":{
  "command":"reconcile",
  "summary":{"total":3,"succeeded":3,"failed":0},
  "results":[
    {"BankTransactionID":"abc-123","status":"reconciled","AccountCode":"6420"},
    {"BankTransactionID":"def-456","status":"reconciled","AccountCode":"6310"},
    {"BankTransactionID":"ghi-789","status":"reconciled","InvoiceID":"inv-001","PaymentID":"pay-001"}
  ]
}}
```

### The Claude Code skill ties it all together

```
User: /xero-reconcile

Claude: Pulling unreconciled transactions...
        $ bun run xero-cli transactions --unreconciled --json

        Found 387 unreconciled transactions (Q1 2026).

        Pulling your chart of accounts...
        $ bun run xero-cli accounts --json

        Pulling reconciliation history for pattern matching...
        $ bun run xero-cli history --since 2025-07-01 --json

        Based on your accounts and past patterns, here's my analysis:

        === INVOICE MATCHES (12) ===
        $2,450.00  ACME CORP PTY LTD    -> Invoice INV-0234
        $890.00    WEB AGENCY PTY       -> Invoice INV-0241
        ...

        === CONFIDENT CATEGORIZATIONS (318) ===
        $5.30    SUMO SALAD MELBOURNE        -> 6420 Entertainment    (seen 12x before)
        $49.99   GITHUB INC                  -> 6310 Software/SaaS   (seen 6x before)
        $142.50  SHELL COLES EXPRESS         -> 6440 Motor Vehicle    (seen 23x before)
        $29.00   SPOTIFY                     -> 6310 Software/SaaS   (seen 6x before)
        $3,200.00 ATO PAYMENT               -> 8100 Tax Payments     (seen 4x before)
        ...

        === NEEDS YOUR INPUT (57) ===
        $500.00   TRANSFER FROM SAVINGS      -> Transfer? Which account?
        $1,234.56 UNKNOWN DIRECT DEBIT       -> Can't determine
        ...

        Want me to reconcile the 330 confident ones? (12 invoices + 318 categorized)
        The 57 uncertain ones I'll export as CSV for you to review.

User: yes, go ahead

Claude: Reconciling 330 transactions...
        $ echo '[...]' | bun run xero-cli reconcile --json

        ✓ 330/330 reconciled successfully
        ✓ Report saved to .xero-reconcile-runs/2026-02-26T14-30-00.json
        ✓ 57 uncertain items exported to xero-needs-review-2026-02-26.csv

        57 remaining. Want to go through them now?
```

---

## Architecture

### CLI Commands

| Command | Purpose | Key Flags |
|---------|---------|-----------|
| `auth` | OAuth2 PKCE flow, save tokens to Keychain | -- |
| `transactions` | Read bank transactions | `--unreconciled`, `--since`, `--until`, `--page`, `--limit` |
| `accounts` | Read chart of accounts | `--type` (EXPENSE, REVENUE, etc.) |
| `invoices` | Read outstanding invoices | `--status` (AUTHORISED), `--type` (ACCPAY, ACCREC) |
| `history` | Read past reconciled transactions | `--since`, `--contact`, `--account-code` |
| `reconcile` | Create reconciliation entries | Reads JSON from stdin. `--dry-run` (default), `--execute` |
| `status` | Check auth + API connectivity | -- |
| `help` | Self-documenting help topics | `help transactions`, `help contract`, etc. |

### Global Flags (every command)

| Flag | Purpose |
|------|---------|
| `--json` | JSON envelope on stdout |
| `--jsonl` | One JSON object per line (list commands only) |
| `--quiet` | Minimal output |
| `--fields` | Comma-separated field projection |
| `--non-interactive` | Never prompt, fail fast |

### Exit Codes

| Code | Constant | Meaning | Agent Action |
|------|----------|---------|-------------|
| 0 | `EXIT_OK` | Success | Proceed |
| 1 | `EXIT_RUNTIME` | Runtime error (API failure, network) | Retry or escalate |
| 2 | `EXIT_USAGE` | Bad arguments | Fix command syntax |
| 3 | `EXIT_NOT_FOUND` | Resource not found (no transactions, no config) | Create the resource first |
| 4 | `EXIT_UNAUTHORIZED` | Auth failure (expired tokens, Keychain denied) | Run `auth` command |
| 5 | `EXIT_CONFLICT` | Conflict (concurrent execute, locked state) | Wait and retry |
| 130 | `EXIT_INTERRUPTED` | SIGINT / Ctrl+C | User cancelled |

### JSON Output Contract

**Success:**
```json
{"status":"data","data":{"command":"transactions","count":387,"transactions":[...]}}
```

**Error (on stderr):**
```json
{"status":"error","message":"Tokens expired","error":{"name":"AuthError","code":"E_UNAUTHORIZED"}}
```

**JSONL (one per line):**
```json
{"BankTransactionID":"abc","Total":"-5.30","Contact":{"Name":"SUMO SALAD"},"Date":"2026-01-03"}
```

### File Structure

```
tax-return/
+-- src/
|   +-- cli/
|   |   +-- command.ts          # Arg parsing, command dispatch, output formatting
|   |   +-- commands/
|   |       +-- auth.ts         # OAuth2 PKCE + Keychain
|   |       +-- transactions.ts # GET /BankTransactions
|   |       +-- accounts.ts     # GET /Accounts
|   |       +-- invoices.ts     # GET /Invoices
|   |       +-- history.ts      # GET /BankTransactions (reconciled, grouped)
|   |       +-- reconcile.ts    # PUT /BankTransactions + PUT /Payments (stdin JSON)
|   |       +-- status.ts       # Preflight check (auth + API + config)
|   +-- xero/
|   |   +-- http.ts             # Raw transport: transportFetch(url, token, options)
|   |   +-- api.ts              # xeroFetch() with retry, rate limit, error handling
|   |   +-- auth.ts             # Token management (Keychain, refresh, PKCE)
|   |   +-- types.ts            # Xero API TypeScript interfaces
|   |   +-- errors.ts           # XeroAuthError, XeroApiError (extends StructuredError)
|   +-- state/
|       +-- state.ts            # Reconciliation state (idempotency, via @side-quest/core/fs)
+-- tests/
|   +-- cli/
|   |   +-- command.test.ts     # Arg parsing tests
|   +-- xero/
|       +-- api.test.ts
|       +-- auth.test.ts
+-- .claude/
|   +-- skills/
|       +-- xero-reconcile/
|           +-- SKILL.md        # Teaches Claude the workflow + CLI commands
+-- scripts/
    +-- xero-auth-server.ts     # OAuth2 callback server (Bun.serve on 127.0.0.1:5555)
```

### Key Design Decisions

1. **CLI is a dumb pipe.** It moves data between Xero and stdout/stdin. No AI, no matching logic, no categorization. That's Claude's job.

2. **`reconcile` command reads JSON from stdin.** This is how Claude feeds it decisions. The CLI doesn't care where the decisions came from -- it just validates the shape and executes.

3. **Two reconciliation modes in one command:**
   - **Account code assignment** -- for everyday expenses. Creates/updates the BankTransaction with the right AccountCode and marks reconciled.
   - **Invoice matching** -- for payments against invoices. Creates a Payment with `IsReconciled: true`.
   - The input JSON distinguishes them: `{"BankTransactionID":"...","AccountCode":"6310"}` vs `{"BankTransactionID":"...","InvoiceID":"..."}`.

4. **`history` command is the learning signal.** It returns past reconciled transactions grouped by contact, so Claude can say "you've categorized GITHUB INC as 6310 Software 6 times before."

5. **Follows `@side-quest/observability` patterns exactly.** Same arg parsing, same output contract, same exit codes, same error envelope. An agent that knows one knows both.

---

## Implementation Phases

### Phase 1: CLI Skeleton + Auth

**Goal:** Working CLI with `auth`, `status`, and `help` commands. Agent-native output contract.

**Files to create:**
- `src/cli/command.ts` -- arg parser, command dispatch, `writeSuccess`/`writeError`, output context
- `src/cli/commands/auth.ts` -- OAuth2 PKCE flow
- `src/cli/commands/status.ts` -- preflight check
- `src/xero/http.ts` -- raw transport
- `src/xero/api.ts` -- `xeroFetch()` with retry/rate-limit
- `src/xero/auth.ts` -- token management (Keychain, refresh mutex)
- `src/xero/errors.ts` -- error hierarchy
- `scripts/xero-auth-server.ts` -- OAuth2 callback server

**Arg parser follows the discriminated union pattern:**

```typescript
const EXIT_OK = 0
const EXIT_RUNTIME = 1
const EXIT_USAGE = 2
const EXIT_NOT_FOUND = 3
const EXIT_UNAUTHORIZED = 4
const EXIT_CONFLICT = 5
const EXIT_INTERRUPTED = 130

type ExitCode = 0 | 1 | 2 | 3 | 4 | 5 | 130
type CommandName = 'auth' | 'transactions' | 'accounts' | 'invoices' | 'history' | 'reconcile' | 'status'

interface GlobalFlags {
  readonly json: boolean
  readonly jsonl: boolean
  readonly quiet: boolean
  readonly nonInteractive: boolean
  readonly fields: readonly string[] | null
}

interface AuthCommand extends GlobalFlags {
  readonly command: 'auth'
}

interface TransactionsCommand extends GlobalFlags {
  readonly command: 'transactions'
  readonly unreconciled: boolean
  readonly since: string | null
  readonly until: string | null
  readonly page: number
  readonly limit: number | null
}

interface AccountsCommand extends GlobalFlags {
  readonly command: 'accounts'
  readonly type: string | null  // EXPENSE, REVENUE, ASSET, etc.
}

interface InvoicesCommand extends GlobalFlags {
  readonly command: 'invoices'
  readonly status: string       // default: AUTHORISED
  readonly type: string | null  // ACCPAY, ACCREC
}

interface HistoryCommand extends GlobalFlags {
  readonly command: 'history'
  readonly since: string | null
  readonly contact: string | null
  readonly accountCode: string | null
}

interface ReconcileCommand extends GlobalFlags {
  readonly command: 'reconcile'
  readonly execute: boolean     // default: false (dry-run)
}

interface StatusCommand extends GlobalFlags {
  readonly command: 'status'
}

type CliOptions = AuthCommand | TransactionsCommand | AccountsCommand
  | InvoicesCommand | HistoryCommand | ReconcileCommand | StatusCommand

interface ParseCliOk { readonly ok: true; readonly options: CliOptions }
interface ParseCliError {
  readonly ok: false
  readonly exitCode: ExitCode
  readonly message: string
  readonly output: string
  readonly errorCode: string
  readonly json: boolean
  readonly quiet: boolean
}
type ParseCliResult = ParseCliOk | ParseCliError
```

**Auto non-TTY detection:**

```typescript
function shouldUseAutomaticMachineMode(): boolean {
  return !isatty(1) // fd 1 = stdout
}

function applyAutomaticOutputMode(options: CliOptions, autoMachine: boolean): CliOptions {
  if (!autoMachine) return options
  if ('jsonl' in options && options.jsonl) return { ...options, quiet: true }
  return { ...options, quiet: true, json: true }
}
```

**Verification:** `bun run xero-cli` prints full help. `bun run xero-cli auth` completes OAuth flow. `bun run xero-cli status --json` returns structured JSON.

### Phase 2: Read Commands

**Goal:** `transactions`, `accounts`, `invoices`, `history` commands working with all output modes.

**Files to create:**
- `src/cli/commands/transactions.ts`
- `src/cli/commands/accounts.ts`
- `src/cli/commands/invoices.ts`
- `src/cli/commands/history.ts`
- `src/xero/types.ts` -- TypeScript interfaces for Xero API responses

**`transactions --unreconciled` is the primary command.** Fetches `GET /BankTransactions?where=IsReconciled==false AND Date>=DateTime(...)&page=N` with auto-pagination.

**`accounts` fetches the chart of accounts.** `GET /Accounts?where=Status=="ACTIVE"` -- returns account codes, names, types. This is what Claude uses to propose categorizations.

**`history` is the pattern-matching signal.** Fetches reconciled transactions from the last N months, groups by contact name and account code, returns frequency counts. Claude uses this to say "you've categorized GITHUB INC as 6310 six times."

**All list commands support JSONL for streaming and `--fields` for token efficiency.**

**Verification:** `bun run xero-cli transactions --unreconciled --json` returns structured data. `bun run xero-cli accounts --json` returns chart of accounts. `bun run xero-cli history --since 2025-07-01 --json` returns grouped history.

### Phase 3: Reconcile Command + State

**Goal:** `reconcile` command reads JSON from stdin, creates reconciliation entries via API.

**Files to create:**
- `src/cli/commands/reconcile.ts`
- `src/state/state.ts`

**Two reconciliation paths based on input:**

```typescript
// Account code assignment (everyday expenses)
interface AccountCodeReconciliation {
  BankTransactionID: string
  AccountCode: string       // e.g. "6310"
}

// Invoice matching (payment against invoice)
interface InvoiceReconciliation {
  BankTransactionID: string
  InvoiceID: string
}

type ReconciliationEntry = AccountCodeReconciliation | InvoiceReconciliation
```

**For account code assignments:** The transaction already exists in Xero as an unreconciled BankTransaction. We need to update it with the correct AccountCode on its line items and potentially mark it reconciled. Research needed on exact API call -- may need to update the BankTransaction's LineItems with the AccountCode, which should auto-reconcile it.

**For invoice matches:** Create a Payment with `IsReconciled: true` via `PUT /Payments`. Same as the original plan.

**Safety:** `--execute` flag required. Dry-run by default shows what would happen. Process lock via `withFileLock()` for concurrent safety. State file for idempotency.

**Verification:** Pipe test JSON to `bun run xero-cli reconcile --json`, see dry-run output. Pipe with `--execute`, confirm reconciliation in Xero web UI.

### Phase 4: Claude Code Skill

**Goal:** Skill file that teaches Claude the full workflow.

**File:** `.claude/skills/xero-reconcile/SKILL.md`

The skill teaches Claude:
1. How to authenticate (`bun run xero-cli auth`)
2. How to pull unreconciled transactions and chart of accounts
3. How to analyze transaction history for pattern matching
4. How to propose account codes with confidence levels
5. How to present proposals to the user for review
6. How to execute reconciliation via stdin JSON
7. How to handle the "needs review" bucket

**The skill is where the intelligence lives.** The CLI is deliberately dumb -- the skill turns Claude into the smart layer that categorizes 300+ transactions in seconds.

---

## Xero API Types

> See the superseded plan (`2026-02-26-feat-xero-reconciliation-mvp-plan.md`) for the full technical specification with all TypeScript interfaces, researched from official Xero docs.

Key types carried forward: `XeroBankTransaction`, `XeroInvoice`, `XeroPayment`, `XeroConnection`, `XeroOrganisation`, `XeroValidationError`, `XeroPagination`.

New type needed:

```typescript
/** Chart of accounts entry */
interface XeroAccount {
  AccountID: string
  Code: string            // e.g. "6310"
  Name: string            // e.g. "Software & SaaS"
  Type: 'REVENUE' | 'EXPENSE' | 'ASSET' | 'LIABILITY' | 'EQUITY' | 'CURRENT' | 'FIXED'
    | 'CURRLIAB' | 'TERMLIAB' | 'DIRECTCOSTS' | 'OVERHEADS' | 'DEPRECIATION'
    | 'OTHERINCOME' | 'EQUITY'
  Status: 'ACTIVE' | 'ARCHIVED'
  TaxType?: string
  Description?: string
  Class: 'ASSET' | 'EQUITY' | 'EXPENSE' | 'LIABILITY' | 'REVENUE'
  EnablePaymentsToAccount?: boolean
}
```

---

## Security

All security decisions from the superseded plan carry forward:

- **PKCE OAuth2** -- no client_secret
- **macOS Keychain** for tokens via stdin piping (no argv leakage)
- **Hard-fail** if Keychain unavailable (no file-based fallback)
- **One-shot callback** server (state consumed after first use)
- **Process lock** via `withFileLock()` for `--execute` mode
- **Server-side pre-check** for crash recovery (query Xero before creating)
- **Response validation** type guards before state mutation
- **0o600 permissions** on state files and reports
- **Never log tokens** -- redact Authorization headers in errors

---

## Dependencies

```bash
# Runtime
bun add @side-quest/core   # fs, oauth, concurrency, errors, utils, formatters
# That's it. Zero other runtime deps.
```

---

## Acceptance Criteria

- [ ] `bun run xero-cli` with no args prints full self-documenting help
- [ ] `bun run xero-cli auth` completes OAuth2 PKCE flow, stores tokens in Keychain
- [ ] `bun run xero-cli transactions --unreconciled --json` returns structured JSON
- [ ] `bun run xero-cli accounts --json` returns chart of accounts
- [ ] `bun run xero-cli history --json` returns grouped reconciliation history
- [ ] `bun run xero-cli invoices --json` returns outstanding invoices
- [ ] `bun run xero-cli reconcile --execute` accepts JSON from stdin, creates entries in Xero
- [ ] `bun run xero-cli status --json` returns auth + API health check
- [ ] All commands support `--json`, `--jsonl` (list commands), `--quiet`, `--fields`
- [ ] Non-TTY auto-detects and switches to JSON output
- [ ] Typed exit codes (0-5, 130) for agent branching
- [ ] Structured JSON errors on stderr
- [ ] Claude Code skill can orchestrate the full reconciliation workflow
- [ ] Re-runs are idempotent (state file + server-side check)
- [ ] All tests pass (`bun test`)
- [ ] No tokens in logs

---

## What Changed From the Previous Plan

| Aspect | Previous Plan | This Plan |
|--------|--------------|-----------|
| Architecture | Monolithic CLI with matching logic | Dumb CLI pipe + Claude skill |
| Intelligence | Built into `matcher.ts` | Lives in Claude Code skill |
| Primary use case | Invoice matching | Account code categorization (300+ txns) |
| Output format | Human-only | Tri-modal (human/JSON/JSONL) |
| Agent support | None (Claude command wrapper) | First-class (agent-native patterns) |
| Field projection | None | `--fields` for token economy |
| Exit codes | 0-3 (ad hoc) | 0-5, 130 (typed, semantic) |
| Error format | Thrown exceptions | Structured JSON on stderr |
| Chart of accounts | Not fetched | Core command (`accounts`) |
| History/patterns | Not fetched | Core command (`history`) |
| Reconcile input | Hardcoded matching | JSON from stdin (agent feeds it) |

---

## Sources

### Agent-Native CLI Patterns
- [joelclaw.com -- "Designing CLI tools for LLM agents"](https://joelclaw.com) -- JSON-first, self-documenting
- [@yacineMTB -- "0 dependencies. It's not hard."](https://x.com) -- zero-dep philosophy
- [Lineark (@flipbit03) -- "13K tokens via MCP vs 1K via CLI"](https://x.com) -- field projection
- [Laminar -- headless agent guidelines](https://laminar.dev) -- never block stdin, JSON-strict
- Reference implementation: `@side-quest/observability` CLI (`packages/server/src/cli/command.ts`)

### Xero API
- [BankTransactions API](https://developer.xero.com/documentation/api/accounting/banktransactions)
- [Payments API](https://developer.xero.com/documentation/api/accounting/payments)
- [Accounts API](https://developer.xero.com/documentation/api/accounting/accounts)
- [Xero OpenAPI Spec v11.0.0](https://github.com/XeroAPI/Xero-OpenAPI) -- MIT license
