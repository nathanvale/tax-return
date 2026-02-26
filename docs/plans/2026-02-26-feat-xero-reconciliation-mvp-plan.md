---
title: "feat: Xero bank reconciliation MVP - auth + simple matching"
type: feat
status: active
date: 2026-02-26
---

# Xero Bank Reconciliation MVP - Auth + Simple Matching

## Enhancement Summary

**Scope:** MVP only - auth (PKCE + Keychain), fetch unreconciled transactions, simple matching (exact amount + contact substring), batch payment creation, CSV export for unmatched, state file for idempotency.

**Split from:** `2026-02-26-feat-xero-bank-reconciliation-plan-SUPERSEDED.md`

### Key Decisions
1. **Dropped xero-node SDK** - deprecated April 28, 2026. Using direct `fetch()` against Xero REST API instead.
2. **Added PKCE** - Xero supports it natively for CLI apps. No `client_secret` needed.
3. **macOS Keychain** for token storage via macOS `security` CLI and `Bun.spawn()` (encrypted at rest in Keychain).
4. **Simplified matching** - exact amount + normalized contact substring + manual queue. No fuzzy matching, no weighted scoring.
5. **Batch payment creation** (50/request) - 10-50x fewer API calls.
6. **`@side-quest/core` integration** - leverage existing utilities instead of custom code.
7. **1 command** (`xero-reconcile`) with `--auth`, `--execute`, `--export` flags. **Dry-run by default** -- the `--execute` flag is REQUIRED for live payment creation (safety interlock enforced in TypeScript, not just the Claude command).

---

## Overview

Build a CLI tool that reconciles bank transactions in Xero using the Xero REST API (direct `fetch()`). Pull unreconciled transactions, match them against outstanding invoices using simple exact-amount + contact-substring matching, create payments via API for matches, and export unmatched items to CSV for manual processing.

## Problem Statement / Motivation

Manual bank reconciliation in Xero is tedious, repetitive work. Nathan needs to reconcile bank transactions regularly for tax return preparation. This tool automates the core workflow: pull data via API, match using simple heuristics, execute matches via API, and export the rest as CSV.

## Proposed Solution

### Architecture

```
+---------------------------------------------------+
|  Claude Command: /xero-reconcile                   |
|  Thin orchestrator - calls TypeScript modules      |
+--------------+------------------------------------+
|  API Layer   |  CLI Layer                          |
|  fetch()     |  --auth, --execute,                |
|              |  --export                          |
+--------------+------------------------------------+
| Read txns    | Match (exact amount + contact)      |
| Read invoices| Create payments (batched)           |
| Create       | Export unmatched as CSV             |
| payments     | State file for idempotency          |
+--------------+------------------------------------+
```

**Key decisions:**
- **Direct `fetch()` instead of xero-node SDK** - The SDK is deprecated April 28, 2026. `fetch()` is native to Bun, zero dependencies, full API coverage.
- **PKCE OAuth2 flow** - No `client_secret` needed. More secure for CLI tools. Xero explicitly supports "Auth Code with PKCE" app type.
- **macOS Keychain for token storage** - Encrypted at rest, locked with screen lock, no plaintext tokens on disk.
- **Claude commands are thin** - Workflow logic lives in TypeScript modules.
- **`@side-quest/core` for shared utilities** - State persistence, token expiry checks, retry logic, error handling, currency formatting, and batch chunking.

### `@side-quest/core` Integration Map

| Plan Module | SideQuest Core Utility | Replaces |
|---|---|---|
| `state.ts` | `loadJsonStateSync()`, `saveJsonStateSync()` from `@side-quest/core/fs` | Custom atomic JSON read/write + schema validation. **Verified:** `saveJsonStateSync()` uses `writeJsonFileSyncAtomic()` internally (temp file + `renameSync`), guaranteeing crash-safe atomic writes. |
| `auth.ts` | `isTokenExpired()` from `@side-quest/core/oauth` | Custom expiry check logic |
| `auth.ts` | `generateSecureToken()` from `@side-quest/core/password` | Custom `crypto.getRandomValues` for OAuth2 `state` param |
| `api.ts` | `retry()` from `@side-quest/core/utils` | Inline retry-on-429 logic |
| `reconcile.ts` | `chunk()` from `@side-quest/core/utils` | Custom batch splitting in `createPaymentsBatched()` |
| `errors.ts` | `StructuredError` from `@side-quest/core/errors` | Custom error base class |
| `errors.ts` | `getErrorMessage()` from `@side-quest/core/utils` | Safe error-to-string extraction |
| `export.ts` | `formatCurrency()` from `@side-quest/core/formatters` | Custom AUD formatting |
| `scripts/xero-auth-server.ts` | `withTimeout()` from `@side-quest/core/concurrency` | Custom 120s server timeout logic |
| `reconcile.ts` | `withFileLock()` from `@side-quest/core/concurrency` | Custom lock file implementation. Atomic O_EXCL, stale PID detection, auto-cleanup. |

### Project Structure (~14 files)

```
tax-return/
+-- .claude/
|   +-- commands/
|       +-- xero-reconcile.md      # Single command: --auth, --execute, --export (dry-run by default)
+-- .env.example                   # Template (XERO_CLIENT_ID only - no secret with PKCE)
+-- .xero-config.json              # Runtime config: tenant ID, org name (gitignored)
+-- .xero-reconcile-state.json     # Run state for idempotency (gitignored, schema-versioned)
+-- .xero-reconcile-runs/          # Per-execute JSON reports for audit/rollback (gitignored)
+-- src/
|   +-- xero/
|       +-- config.ts              # Load + validate env vars and .xero-config.json
|       +-- http.ts                # Raw transport: transportFetch(url, token, options) - no auth logic
|       +-- auth.ts                # OAuth2 PKCE flow + token refresh + Keychain (uses http.ts for refresh)
|       +-- api.ts                 # Xero API client: xeroFetch() uses auth token provider + http.ts transport
|       +-- matcher.ts             # Simple matching: exact amount + contact substring
|       +-- reconcile.ts           # Orchestration: match, preflight, execute, manage state, audit report
|       +-- state.ts               # State file via @side-quest/core/fs (includes schemaVersion check on load)
|       +-- errors.ts              # XeroAuthError, XeroApiError
|       +-- export.ts              # CSV export for unmatched transactions (0o600 perms, timestamped)
+-- tests/
|   +-- xero/
|       +-- auth.test.ts
|       +-- matcher.test.ts
|       +-- reconcile.test.ts
|       +-- state.test.ts
+-- scripts/
    +-- xero-auth-server.ts        # OAuth2 callback server (Bun.serve on 127.0.0.1:5555)
```

### Research Insights: Why Not xero-node

The xero-node SDK (v13.3.0) is auto-generated from an OpenAPI spec and **deprecated on April 28, 2026** (source: Xero SDKs Overview page). Building on it creates immediate technical debt. The Xero REST API is straightforward (illustrative only -- actual implementation uses `xeroFetch()` in `api.ts`):

```typescript
/** Illustrative example -- NOT implementation code. See xeroFetch() in api.ts for the single HTTP client. */
const where = encodeURIComponent('IsReconciled==false AND Date>=DateTime(2025,01,01)')
const response = await fetch(
  `https://api.xero.com/api.xro/2.0/BankTransactions?where=${where}&page=1&order=Date%20DESC`,
  {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'xero-tenant-id': tenantId,
      'Accept': 'application/json',
    },
  },
)
```

---

## Technical Considerations

### Xero API Constraints (confirmed via research)

- **No reconciliation API** - Xero explicitly states "no immediate plans" to add this
- **Workaround:** Create payments with `isReconciled: true`; Xero auto-matches when amount/date/bank account align with a bank feed line
- **Bank Feeds API** is restricted to financial institutions - not available
- **Rate limits:** 60 calls/min, 5,000/day per org, 5 concurrent requests. Response headers `X-MinLimit-Remaining`, `X-DayLimit-Remaining`, `X-AppMinLimit-Remaining` report remaining quota -- use these for proactive throttling instead of only reacting to 429s.
- **OAuth2:** 30-min access tokens, single-use refresh tokens (60-day expiry if unused)
- **Granular scopes:** Apps created after 2 March 2026 need new scope format
- **`IsReconciled` filter is not "optimised"** for high-volume orgs - always combine with Date range filter
- **Overpayments via API return validation error** - can't overpay, must be exact or partial
- **200 responses can contain validation errors** - always check `hasErrors` on results
- **Batch limit:** Up to 50 items per POST request (practical ceiling -- max request size is 10MB). Applies to payments, invoices, contacts, etc.
- **Pagination:** 100 items per page, no total count header -- increment page until `length < 100`. Supported on: invoices, credit notes, contacts, bank transactions, manual journals.
- **200 responses can contain per-item validation errors** - always check `HasErrors` and `ValidationErrors` on each item in batch responses

### Research Insights: BankTransactions vs BankStatementLines

These are different things:
- **BankTransactions** = spend/receive money entries recorded in Xero's ledger. Has `IsReconciled` field. **This is what we query.**
- **BankStatementLines** = raw bank feed lines imported from bank feeds. No `IsReconciled` field.

We filter `BankTransactions` with `IsReconciled==false` to find unreconciled items.

### Security

- **PKCE OAuth2** - No `client_secret` stored anywhere. Code verifier + challenge per auth session.
- **macOS Keychain** for tokens via macOS `security` CLI and `Bun.spawn()` - encrypted at rest in Keychain. **All tokens stored as a single JSON blob** in one Keychain entry for atomic updates (no torn state on crash).
- **OAuth2 `state` parameter** - cryptographically random, validated in callback to prevent CSRF
- **Callback server binds to `127.0.0.1:5555`** - not `0.0.0.0`, prevents LAN access. Port 5555 chosen to avoid React/Rails conflicts (port 3000).
- **Callback server binds port BEFORE opening browser** - If port 5555 is occupied, fail immediately with clear error message.
- **Callback server one-shot** - State is single-use (marked consumed after first valid callback). Code parameter validated for presence before exchange. Server stops immediately after first valid callback via `queueMicrotask(() => server.stop())`. Any subsequent request gets 400.
- **Callback server timeout** - 120s, auto-shuts down if no callback received
- **Scopes minimised** - `accounting.transactions accounting.contacts offline_access` (accounting.settings removed after audit -- not needed for MVP endpoints)
- **Logging policy** - NEVER log tokens, authorization codes, or code verifiers. Redact `Authorization` headers in error logs. Safe to log: transaction IDs, amounts, counts, timestamps, error messages (without headers).
- **Error context sanitization** - NEVER pass request bodies, headers, tokens, codes, or verifiers into error constructor `context`. Only pass safe fields: `message`, `status` (code), `transactionId`, `amount`. This prevents accidental leakage via `StructuredError`'s enumerable `context` property, which Bun's `console.error()` and stack traces will serialize.

```typescript
// BAD - leaks secrets into error context
throw new XeroApiError('Token exchange failed', {
  context: { code, codeVerifier, headers: response.headers, body: requestBody },
})

// GOOD - only safe fields in error context
throw new XeroApiError('Token exchange failed', {
  context: { status: response.status, message: 'Invalid authorization code' },
})

// GOOD - API error with safe context only
throw new XeroApiError('Payment creation failed', {
  context: { status: response.status, transactionId: txn.BankTransactionID, amount: txn.Total },
})
```

### Research Insights: Token Refresh Mutex

With single-use refresh tokens, concurrent refresh attempts will invalidate each other. Use a mutex pattern:

```typescript
let refreshPromise: Promise<void> | null = null

async function ensureFreshToken(): Promise<string> {
  const tokens = await loadTokens()
  if (!tokens) throw new XeroAuthError('No tokens found - run --auth first')
  if (!isTokenExpired(tokens.expiresAt, 5 * 60 * 1000)) {
    return tokens.accessToken
  }
  if (refreshPromise) {
    await refreshPromise  // another caller is already refreshing
    return (await loadTokens())!.accessToken
  }
  refreshPromise = doRefresh(tokens)
  try { await refreshPromise }
  finally { refreshPromise = null }
  return (await loadTokens())!.accessToken
}
```

On `invalid_grant` error: re-read token bundle from Keychain (another process may have refreshed) and retry once before declaring re-auth needed.

**Refresh token rotation safety:**
All tokens stored as a single JSON blob in one Keychain entry -- one write is atomic (all updated or none). The previous refresh token is kept inside the same bundle as a fallback. No more torn state from crashes between separate writes.

```typescript
async function doRefresh(currentTokens: KeychainTokenBundle): Promise<void> {
  const response = await fetchNewTokens(currentTokens.refreshToken)
  // Single atomic write -- no torn state possible
  await saveTokens({
    accessToken: response.accessToken,
    refreshToken: response.refreshToken,
    refreshTokenPrev: currentTokens.refreshToken,
    expiresAt: response.expiresAt,
  })
}
```

On `invalid_grant`: try `refreshTokenPrev` from the same token bundle before requiring full re-auth.

### Error Handling Strategy

Simplified error hierarchy in `src/xero/errors.ts` -- 2 classes only:

```typescript
import { StructuredError } from '@side-quest/core/errors'

class XeroAuthError extends StructuredError { /* 401 - re-auth needed */ }
class XeroApiError extends StructuredError { /* all other API errors (400, 429, 500, etc.) */ }
```

**Partial failure strategy:** Best-effort with batch reporting. Process as many transactions as possible, collect failures, report all at the end.

---

## Technical Specification: Xero API Types

> Researched from official Xero developer documentation and the [Xero OpenAPI spec](https://github.com/XeroAPI/Xero-OpenAPI) (v11.0.0, MIT license).

### Type Strategy: Lightweight Hand-Written Types

For MVP, we use hand-written TypeScript interfaces based on the official Xero OpenAPI spec. This keeps dependencies at zero and types focused on the fields we actually use. The full OpenAPI spec (`xero_accounting.yaml`) is available at `github.com/XeroAPI/Xero-OpenAPI` if we need to generate comprehensive types later.

**Why not Zod for MVP:**
- We only read ~15 fields from each endpoint. Full schema validation adds complexity without proportional safety.
- Our `assertValidPaymentResponse()` type guards (see reconcile.ts) validate the critical fields before state mutation.
- Zod adds a runtime dependency. Hand-written type guards are zero-dependency and debuggable.
- **Future option:** If we add more endpoints or the type surface grows, `openapi-typescript` can generate types from the official YAML spec.

### Standard Response Envelope

All Accounting API responses use this envelope (JSON format):

```typescript
/** Standard envelope for all Xero Accounting API responses */
interface XeroResponse<T extends string, V> {
  Id: string                    // Request UUID
  Status: 'OK'                 // Always "OK" for HTTP 200
  DateTimeUTC: string          // .NET date: "/Date(1439434356790)/"
  pagination?: XeroPagination  // Only when ?page= param used
  [K in T]: V[]                // Resource array: "Invoices", "Payments", etc.
}

interface XeroPagination {
  page: number        // Current page (1-indexed)
  pageSize: number    // Items per page (default 100, max 1000)
  pageCount: number   // Total pages
  itemCount: number   // Total items across all pages
}
```

### Date Handling

Xero uses .NET JSON date format. Helper to parse:

```typescript
/** Parse Xero's .NET JSON date format: "/Date(1439434356790+0000)/" */
function parseXeroDate(xeroDate: string): Date {
  const match = xeroDate.match(/\/Date\((\d+)/)
  if (!match) throw new XeroApiError(`Invalid date format: ${xeroDate}`)
  return new Date(Number(match[1]))
}
```

### BankTransaction (GET /api.xro/2.0/BankTransactions)

```typescript
/** Fields we use from BankTransactions endpoint */
interface XeroBankTransaction {
  BankTransactionID: string
  Type: 'RECEIVE' | 'SPEND' | 'RECEIVE-OVERPAYMENT' | 'SPEND-OVERPAYMENT'
    | 'RECEIVE-PREPAYMENT' | 'SPEND-PREPAYMENT' | 'RECEIVE-TRANSFER' | 'SPEND-TRANSFER'
  Contact: {
    ContactID: string
    Name: string
  }
  BankAccount: {
    AccountID: string
    Code?: string
    Name?: string
  }
  Date: string              // .NET date format
  DateString: string        // "2014-05-26T00:00:00"
  Status: 'AUTHORISED' | 'DELETED'
  SubTotal: string          // Decimal as string: "49.90"
  TotalTax: string
  Total: string             // Decimal as string -- parse with Number()
  CurrencyCode: string      // ISO 4217 (e.g. "AUD")
  IsReconciled: string      // "true" | "false" (STRING, not boolean!)
  Reference?: string
  LineItems?: XeroLineItem[]
  UpdatedDateUTC: string
}

interface XeroLineItem {
  LineItemID: string
  Description?: string
  Quantity?: string         // Decimal as string
  UnitAmount?: string       // Decimal as string
  AccountCode?: string
  TaxType?: string
  TaxAmount?: string
  LineAmount?: string
}
```

**Key gotchas:**
- `IsReconciled` is a **string** ("true"/"false"), not a boolean
- `Total`, `SubTotal`, `TotalTax` are **strings**, not numbers -- parse with `Number()`
- Query: `GET /BankTransactions?where=IsReconciled==false AND Date>=DateTime(2025,01,01)&page=1&order=Date DESC`
- Optimised filters: `Type==`, `Status==`, `Date` range, `Contact.ContactID==guid("...")`

### Invoice (GET /api.xro/2.0/Invoices)

```typescript
/** Fields we use from Invoices endpoint */
interface XeroInvoice {
  InvoiceID: string
  Type: 'ACCPAY' | 'ACCREC'      // ACCPAY=bill, ACCREC=sales invoice
  InvoiceNumber: string
  Reference?: string               // ACCREC only
  Contact: {
    ContactID: string
    Name: string
  }
  Date: string
  DueDate: string
  Status: 'DRAFT' | 'SUBMITTED' | 'DELETED' | 'AUTHORISED' | 'PAID' | 'VOIDED'
  SubTotal: number                  // NOTE: number (unlike BankTransaction)
  TotalTax: number
  Total: number
  AmountDue: number                 // Outstanding amount
  AmountPaid: number
  CurrencyCode: string
  CurrencyRate: number
  UpdatedDateUTC: string
  HasErrors?: boolean               // Batch responses only
  ValidationErrors?: XeroValidationError[]
}
```

**Key gotchas:**
- Invoice amounts are **numbers** (unlike BankTransaction which uses strings)
- Query: `GET /Invoices?Statuses=AUTHORISED&page=1` or `GET /Invoices?where=Status=="AUTHORISED"&page=1`
- Use `AmountDue` for matching (not `Total` -- invoice may be partially paid)
- Optimised filters: `Type==`, `Status==`, `Contact.ContactID==guid("...")`, `Date` range, `InvoiceNumber==`

### Payment (PUT /api.xro/2.0/Payments)

```typescript
/** Create payment request */
interface XeroCreatePayment {
  Invoice: { InvoiceID: string } | { InvoiceNumber: string }
  Account: { AccountID: string } | { Code: string }
  Date: string                    // "YYYY-MM-DD"
  Amount: number                  // In invoice currency, must be <= AmountDue
  IsReconciled?: boolean          // true = auto-match with bank statement line
  Reference?: string
}

/** Payment response (from GET or after PUT) */
interface XeroPayment {
  PaymentID: string
  Date: string
  Amount: number                  // In invoice currency
  BankAmount: number              // In bank account currency
  CurrencyRate: number
  Reference?: string
  IsReconciled: boolean           // NOTE: boolean (unlike BankTransaction!)
  Status: 'AUTHORISED' | 'DELETED'
  PaymentType: 'ACCRECPAYMENT' | 'ACCPAYPAYMENT' | 'ARCREDITPAYMENT' | 'APCREDITPAYMENT'
  Account: {
    AccountID: string
    Code?: string
  }
  Invoice?: {
    InvoiceID: string
    InvoiceNumber: string
    Type: 'ACCREC' | 'ACCPAY'
    Contact?: { ContactID: string; Name: string }
  }
  HasValidationErrors?: boolean
  ValidationErrors?: XeroValidationError[]
  StatusAttributeString?: 'OK' | 'WARNING' | 'ERROR'
  UpdatedDateUTC: string
}
```

**Key gotchas:**
- `IsReconciled` is a **boolean** here (unlike BankTransaction where it's a string!)
- `Amount` must be <= `AmountDue` on the invoice -- API rejects overpayments
- Delete a payment: `POST /Payments/{PaymentID}` with `{ "Status": "DELETED" }`
- Batch: `PUT /Payments?SummarizeErrors=false` with `{ "Payments": [...] }` -- max 50 items

### Connection (GET /connections -- Identity API)

```typescript
/** Connection from Identity API -- bare JSON array, no envelope */
interface XeroConnection {
  id: string              // Connection UUID
  tenantId: string        // Use as xero-tenant-id header
  tenantType: 'ORGANISATION' | 'PRACTICEMANAGER' | 'PRACTICE'
  tenantName: string | null
  createdDateUtc: string  // ISO 8601
  updatedDateUtc: string
}
```

**Important:** This is the **Identity API** at `https://api.xero.com/connections` (NOT `/api.xro/2.0/`). Returns a bare JSON array -- no envelope. The `tenantId` becomes the `xero-tenant-id` header for all Accounting API calls.

### Organisation (GET /api.xro/2.0/Organisation)

```typescript
/** Minimal org info for preflight/display */
interface XeroOrganisation {
  OrganisationID: string
  Name: string
  LegalName: string
  ShortCode: string       // Unique code e.g. "!23eYt"
  BaseCurrency: string    // ISO 4217
  CountryCode: string     // ISO 3166-2
  IsDemoCompany: boolean
  Version: string         // Region: "AU", "NZ", "UK", "US", "GLOBAL"
}
```

### Validation Errors (batch responses)

```typescript
/** Per-item error from batch responses with ?SummarizeErrors=false */
interface XeroValidationError {
  Message: string         // Human-readable error description
}

/** Standard API error response (HTTP 400) */
interface XeroApiErrorResponse {
  ErrorNumber: number     // e.g. 10
  Type: string            // e.g. "ValidationException"
  Message: string         // e.g. "A validation exception occurred"
  Elements?: Array<{
    ValidationErrors: XeroValidationError[]
  }>
}
```

**Batch behavior with `?SummarizeErrors=false`:**
- Always returns HTTP 200, even if individual items fail
- Each item gets `StatusAttributeString: "OK" | "WARNING" | "ERROR"`
- Failed items have `ValidationErrors` array and `HasValidationErrors: true`
- Without this flag, a single validation error causes HTTP 400 for the whole batch

### Empty Arrays and Null Handling

Per Xero docs: "Due to JSON serialization behavior, a null object may be represented as an empty array." Always use optional chaining and nullish coalescing when accessing nested fields.

### Sources

- [Xero OpenAPI Spec (v11.0.0)](https://github.com/XeroAPI/Xero-OpenAPI) -- MIT license, official
- [BankTransactions API](https://developer.xero.com/documentation/api/accounting/banktransactions)
- [Invoices API](https://developer.xero.com/documentation/api/accounting/invoices)
- [Payments API](https://developer.xero.com/documentation/api/accounting/payments)
- [Contacts API](https://developer.xero.com/documentation/api/accounting/contacts)
- [Organisation API](https://developer.xero.com/documentation/api/accounting/organisation)
- [Connections (Identity API)](https://developer.xero.com/documentation/guides/oauth2/tenants)
- [Response Codes](https://developer.xero.com/documentation/api/accounting/responsecodes)
- [Types & Codes Reference](https://developer.xero.com/documentation/api/accounting/types)

---

## Implementation Phases

### Phase 1: Auth + Read Transactions

**Goal:** Authenticate with Xero via PKCE and pull unreconciled bank transactions.

**Files:**
- `src/xero/config.ts` - Load and validate `XERO_CLIENT_ID` from env + `.xero-config.json` for tenant. Fail fast with clear messages.
- `src/xero/http.ts` - Raw transport layer: `transportFetch(url, token, options)`. No auth logic, no retry, no error mapping. Used by auth.ts for token refresh (avoids circular dependency with api.ts).
- `src/xero/auth.ts` - PKCE flow: `generateCodeVerifier()`, `generateCodeChallenge()`, `getAuthorizationUrl()`, `exchangeCodeForTokens(code, verifier)`, `refreshAccessToken()`. Token storage via macOS `security` CLI + `Bun.spawn()` with stdin piping (no argv leakage). Uses `isTokenExpired()` from `@side-quest/core/oauth` and `generateSecureToken()` from `@side-quest/core/password` for the OAuth2 `state` param. Mutex for refresh. Validates returned scopes after token exchange. Token refresh uses `transportFetch()` from http.ts (not xeroFetch) to avoid circular imports. **Hard-fails if Keychain unavailable** -- no file-based fallback.
- `src/xero/api.ts` - Xero API client: `xeroFetch()` uses auth's `ensureFreshToken()` for tokens + `transportFetch()` from http.ts for transport. Adds retry (429/503 via `retry()` from `@side-quest/core/utils`) and error handling. Convenience wrapper `xeroPost()` delegates to `xeroFetch()`. Exports `getUnreconciledTransactions(page?)` with Date range filter + `IsReconciled==false`, paginating until `length < 100`. **No circular dependency** -- auth.ts uses http.ts directly, api.ts uses auth.ts + http.ts.
- `src/xero/errors.ts` - Typed error hierarchy (XeroAuthError, XeroApiError)
- `scripts/xero-auth-server.ts` - `Bun.serve()` on `127.0.0.1:5555`. **One-shot callback**: state is single-use (marked consumed after first valid callback), code parameter validated for presence before exchange, server stops immediately after first valid callback via `queueMicrotask(() => server.stop())`, any subsequent request returns 400. 120s timeout via `withTimeout()` from `@side-quest/core/concurrency`. Returns HTML confirmation page.
- `.env.example` - `XERO_CLIENT_ID=` (no secret needed with PKCE)

**Auth scopes:** `accounting.transactions accounting.contacts offline_access` (accounting.settings removed -- not needed for MVP endpoints: BankTransactions, Invoices, Payments, Contacts all use accounting.transactions or accounting.contacts)

**Tenant selection:** After first auth, call `GET /connections` to list orgs. Let user choose. Save to `.xero-config.json`.

**Deep-Dive: PKCE Auth with macOS Keychain**

Token storage uses macOS `security` CLI via `Bun.spawn()` for encrypted Keychain access. All tokens are stored as a **single serialized JSON blob** in one Keychain entry, making updates atomic (all-or-nothing). This prevents torn state if a crash occurs mid-save.

```typescript
// Token storage - single JSON blob in macOS Keychain via `security` CLI
// Reverse-DNS service name avoids collisions with other tools
const KEYCHAIN_SERVICE = 'com.nathanvale.tax-return.xero'
const KEYCHAIN_ACCOUNT = 'oauth-tokens'

/** All tokens stored together for atomic read/write */
interface KeychainTokenBundle {
  accessToken: string
  refreshToken: string
  refreshTokenPrev: string
  expiresAt: number
}

/** Save all tokens as a single atomic Keychain entry.
 *  Pipes JSON via stdin to avoid token leakage in process arguments (ps aux). */
async function saveTokens(tokens: KeychainTokenBundle): Promise<void> {
  const json = JSON.stringify(tokens)
  const proc = Bun.spawn(['security', 'add-generic-password',
    '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-U', '-w'], {
    stdin: 'pipe',
  })
  proc.stdin.write(json)
  proc.stdin.end()
  const exitCode = await proc.exited
  if (exitCode !== 0) {
    throw new XeroAuthError('Failed to save tokens to Keychain. Grant Terminal access: System Settings > Privacy & Security > Keychain Access.')
  }
}

/** Load all tokens from a single Keychain entry */
async function loadTokens(): Promise<KeychainTokenBundle | null> {
  try {
    const proc = Bun.spawn(['security', 'find-generic-password',
      '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-w'])
    const text = await new Response(proc.stdout).text()
    const trimmed = text.trim()
    if (!trimmed) return null
    return JSON.parse(trimmed) as KeychainTokenBundle
  } catch { return null }
}

/** Delete all tokens (used during logout / re-auth) */
async function deleteTokens(): Promise<void> {
  const proc = Bun.spawn(['security', 'delete-generic-password',
    '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT])
  await proc.exited
}
```

```typescript
// PKCE S256 flow - no client_secret needed
function generateCodeVerifier(): string {
  const buffer = new Uint8Array(32)
  crypto.getRandomValues(buffer)
  return base64url(buffer)
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64url(new Uint8Array(hash))
}

function getAuthorizationUrl(codeChallenge: string, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: 'http://127.0.0.1:5555/callback',
    scope: 'accounting.transactions accounting.contacts offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })
  return `https://login.xero.com/identity/connect/authorize?${params}`
}
```

```typescript
import { retry } from '@side-quest/core/utils'

// Single HTTP client -- ALL Xero API calls go through xeroFetch().
// Auth, retry (429/503), and error handling are centralised here.
async function xeroFetch(path: string, options?: RequestInit): Promise<Response> {
  return retry(async () => {
    const token = await ensureFreshToken()
    const response = await fetch(`https://api.xero.com/api.xro/2.0${path}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${token}`,
        'xero-tenant-id': getTenantId(),
        'Accept': 'application/json',
        ...options?.headers,
      },
    })
    if (response.status === 401) throw new XeroAuthError('Token expired - re-auth needed')
    if (response.status === 429 || response.status === 503) {
      const retryAfter = Number(response.headers.get('Retry-After') ?? 5)
      const limitProblem = response.headers.get('X-Rate-Limit-Problem') ?? 'unknown'
      throw new XeroApiError(`Rate limited (${response.status}, ${limitProblem})`, { status: response.status, retryAfter })
    }
    if (!response.ok) throw new XeroApiError(`API error: ${response.status}`, { status: response.status })

    // Log remaining quota for proactive throttling awareness
    const minRemaining = response.headers.get('X-MinLimit-Remaining')
    const dayRemaining = response.headers.get('X-DayLimit-Remaining')
    if (minRemaining && Number(minRemaining) < 10) {
      console.warn(`Xero rate limit warning: ${minRemaining} calls remaining this minute`)
    }
    if (dayRemaining && Number(dayRemaining) < 100) {
      console.warn(`Xero daily limit warning: ${dayRemaining} calls remaining today`)
    }

    return response
  }, {
    maxAttempts: 3,
    shouldRetry: (error) => error instanceof XeroApiError && [429, 503].includes(error.context?.status),
  })
}

// POST convenience wrapper -- delegates to xeroFetch (same auth/retry/error handling)
async function xeroPost(path: string, body: unknown): Promise<any> {
  const response = await xeroFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return response.json()
}
```

**Note:** The `security` CLI requires Terminal to have Keychain access. If denied, **hard-fail** with clear error message explaining how to grant access (System Settings > Privacy & Security > Keychain Access). No file-based fallback -- plaintext tokens on disk are unacceptable for a financial API tool.

**Verification:** Run `/xero-reconcile --auth`, authenticate in browser, confirm tokens stored.

### Phase 2: Match + Reconcile

**Goal:** Simple matching of transactions to invoices, batch payment creation, CSV export.

**Files:**
- `src/xero/api.ts` (extend) - Add `getOutstandingInvoices()` filtering `Status=='AUTHORISED'` for ACCREC and ACCPAY, and `createPaymentsBatched(payments, batchSize=50)`. All new functions use the same `xeroFetch()`/`xeroPost()` client -- no additional HTTP abstractions.
- `src/xero/matcher.ts` - Simple matching functions (no side effects, fully testable):
  - `findMatches(transactions, invoices)` - exact amount match + normalized contact substring
  - Returns `Match[]` with confidence: `matched` (exact amount + contact match) or `unmatched` (everything else goes to CSV)
  - Build invoice lookup by amount (Map) for O(1) exact matches
- `src/xero/reconcile.ts` - Orchestration:
  - `preflight(config)` - Validates tokens (not expired), tests API connectivity (`GET /Organisation`), checks state path writable. Fails fast with actionable error if any check fails. Runs before `--execute` mode.
  - `categorise(matches, state)` - splits into matched / unmatched / alreadyProcessed
  - `executeReconciliation(matched, options: { execute: boolean })` - **Safety interlock: throws if `execute` is not explicitly `true`.** Wrapped in `withFileLock()` from `@side-quest/core/concurrency` -- concurrent `--execute` runs fail-fast with clear error. Lock only applies to execute mode (dry-run can run in parallel). Includes **server-side pre-check**: before creating each payment, queries Xero for existing payments on the invoice; skips if matching payment already exists (handles crash-gap between API success and state write). Batch payment creation with **per-item error parsing**: deterministic validation failures are reported and skipped (not retried individually). State updates. **Audit report**: writes timestamped JSON to `.xero-reconcile-runs/YYYY-MM-DDTHH-MM-SS-execute.json` with all created payments (IDs, amounts, invoices, Xero deep links) and failures.
  - **Response validation**: type guard functions validate required fields (PaymentID, InvoiceID, Amount exist and are correct types) before writing to state. Malformed responses throw clear error instead of corrupting state.
  - Partial failure: best-effort with batch reporting
- `src/xero/state.ts` - `loadState()`, `saveState()`, `markProcessed()`, `isProcessed()`, `getStateSummary()`. Uses `loadJsonStateSync()` and `saveJsonStateSync()` from `@side-quest/core/fs`. On load, checks `schemaVersion` -- if missing or mismatched, warns the user with instructions to back up and reset.
- `src/xero/export.ts` - `exportUnmatchedAsCsv()` for manual processing. Uses `formatCurrency()` from `@side-quest/core/formatters` for AUD display. **File conventions**: timestamped filename (`xero-unmatched-YYYY-MM-DD.csv`), 0o600 permissions, no silent overwrite (appends time suffix if file exists). CSV pattern added to `.gitignore`.
- `.claude/commands/xero-reconcile.md` - Single command with flags: `--auth`, `--execute`, `--export`. Dry-run is the default behavior (no flag needed). The `--execute` flag is required to create real payments.

**Simple matching logic:**

```typescript
/** Match transactions to invoices using exact amount + contact substring */
function findMatches(
  transactions: BankTransaction[],
  invoices: Invoice[],
): { matched: Match[]; unmatched: BankTransaction[] } {
  // Build invoice lookup by amount (O(1) exact match)
  const byAmount = new Map<string, Invoice[]>()
  for (const inv of invoices) {
    const key = inv.AmountDue.toFixed(2)
    byAmount.set(key, [...(byAmount.get(key) ?? []), inv])
  }

  const matched: Match[] = []
  const unmatched: BankTransaction[] = []

  for (const txn of transactions) {
    const amountKey = Math.abs(txn.Total).toFixed(2)
    const candidates = byAmount.get(amountKey) ?? []

    // Find candidate where contact name is a substring match
    const normalizedDesc = normalize(txn.Contact?.Name ?? txn.Description ?? '')
    const match = candidates.find(inv => {
      const normalizedContact = normalize(inv.Contact?.Name ?? '')
      return normalizedContact && normalizedDesc.includes(normalizedContact)
        || normalizedContact && normalizedContact.includes(normalizedDesc)
    })

    if (match) {
      matched.push({ transaction: txn, invoice: match })
      // Remove matched invoice from candidates to prevent double-matching
      const remaining = candidates.filter(c => c !== match)
      if (remaining.length) byAmount.set(amountKey, remaining)
      else byAmount.delete(amountKey)
    } else {
      unmatched.push(txn)
    }
  }

  return { matched, unmatched }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()
}
```

**Dry-run is the default, not an opt-in flag.** Running `xero-reconcile` without `--execute` shows what WOULD happen without creating any payments. The `--execute` flag is required to create real payments. This safety interlock is enforced in `reconcile.ts` at the TypeScript level -- not just in the Claude command -- so it applies even if the module is called directly from a script or test.

```typescript
/** Safety interlock - enforced in TypeScript, not just the Claude command */
function assertExecuteFlag(options: { execute: boolean }): void {
  if (!options.execute) {
    throw new Error(
      'Safety interlock: payment creation requires the --execute flag. '
      + 'Run without --execute to see what WOULD happen (dry-run).'
    )
  }
}
```

**Batch payment creation:**

Error classification strategy: rate limit (429) and server errors (500/503) retry the batch itself via `retry()`. Only validation errors (400/hasErrors) fall back to individual creation. Individual fallback is throttled at ~55 req/min (1100ms delay) to stay under Xero's 60 req/min limit.

```typescript
import { chunk, retry } from '@side-quest/core/utils'

/** Classify HTTP errors to determine retry vs fallback strategy */
function isRetryableError(error: unknown): boolean {
  if (error instanceof XeroApiError) {
    const status = error.context?.status
    // Rate limit (429) and server errors (500, 503) -- retry the batch
    return status === 429 || status === 500 || status === 503
  }
  return false
}

/** Throttle to stay under Xero's 60 req/min limit */
const RATE_LIMIT_DELAY_MS = 1100 // ~55 req/min to leave headroom

async function createPaymentsBatched(payments: PaymentInput[], batchSize = 50): Promise<PaymentResult[]> {
  const results: PaymentResult[] = []
  for (const batch of chunk(payments, batchSize)) {
    try {
      // retry() handles transient failures (429/503) with exponential backoff
      const response = await retry(
        () => xeroPost('/Payments', { Payments: batch.map(toXeroPayment) }),
        { maxAttempts: 3, shouldRetry: isRetryableError },
      )
      for (const payment of response.Payments ?? []) {
        if (payment.HasErrors) {
          // Per-item validation errors are deterministic -- report and skip (don't retry individually)
          results.push({ success: false, errors: payment.ValidationErrors, deterministic: true })
        } else {
          // Validate response before state mutation
          assertValidPaymentResponse(payment)
          await state.markProcessed(payment.BankTransactionID, payment.PaymentID)
          results.push({ success: true, payment })
        }
      }
    } catch (error) {
      // Only fall back to individual creation for ambiguous/transient batch-level failures.
      // Rate limit (429) and server errors (500/503) already retried above --
      // if still failing, don't cascade into N individual calls.
      if (isRetryableError(error)) {
        for (const p of batch) {
          results.push({ success: false, input: p, error })
        }
        continue
      }

      // Ambiguous batch failure -- fall back to individual calls, throttled to respect 60 req/min.
      // Note: per-item validation errors (HasErrors) are already handled above and NOT retried.
      for (const p of batch) {
        try {
          const response = await xeroPost('/Payments?SummarizeErrors=false', toXeroPayment(p))
          const payment = response.Payments[0]
          if (payment.HasErrors) {
            results.push({ success: false, input: p, errors: payment.ValidationErrors, deterministic: true })
          } else {
            assertValidPaymentResponse(payment)
            await state.markProcessed(p.bankLineId, payment.PaymentID)
            results.push({ success: true, payment })
          }
        } catch (individualError) {
          results.push({ success: false, input: p, error: individualError })
        }
        // Throttle individual calls to stay under 60 req/min
        await Bun.sleep(RATE_LIMIT_DELAY_MS)
      }
    }
  }
  return results
}

/** Validate payment response has required fields before state mutation.
 *  Prevents corrupted state from malformed API responses. */
function assertValidPaymentResponse(payment: unknown): asserts payment is { PaymentID: string; BankTransactionID: string; Amount: number } {
  if (!payment || typeof payment !== 'object') throw new XeroApiError('Malformed payment response: not an object')
  const p = payment as Record<string, unknown>
  if (typeof p.PaymentID !== 'string' || !p.PaymentID) throw new XeroApiError('Malformed payment response: missing PaymentID')
  if (typeof p.Amount !== 'number') throw new XeroApiError('Malformed payment response: missing Amount')
}
```

**Process lock (execute mode only):**

```typescript
import { withFileLock } from '@side-quest/core/concurrency'

// Only --execute mode acquires the lock. Dry-run can run in parallel.
async function executeWithLock(fn: () => Promise<void>): Promise<void> {
  await withFileLock('xero-reconcile-execute', fn, { timeoutMs: 5000 })
}
```

**Preflight checks (before execute):**

```typescript
async function preflight(config: XeroConfig): Promise<void> {
  // 1. Token validity
  const tokens = await loadTokens()
  if (!tokens) throw new XeroAuthError('No tokens found - run --auth first')
  if (isTokenExpired(tokens.expiresAt)) throw new XeroAuthError('Tokens expired - run --auth to refresh')

  // 2. API connectivity
  const response = await xeroFetch('/Organisation')
  if (!response.ok) throw new XeroApiError('Cannot reach Xero API - check network/tenant', { status: response.status })

  // 3. State path writable
  const statePath = '.xero-reconcile-state.json'
  try { await Bun.write(statePath, await Bun.file(statePath).text()) }
  catch { throw new XeroApiError(`State file not writable: ${statePath}`) }
}
```

**Exit codes:**
- `0` - success (all matched items reconciled)
- `1` - partial success (some items failed, see report)
- `2` - auth failure (tokens expired or Keychain access denied)
- `3` - config error (missing env vars, unwritable paths, preflight failure)

**Audit report (per execute run):**

```typescript
interface ExecuteReport {
  runId: string
  timestamp: string
  paymentsCreated: Array<{
    paymentId: string
    invoiceId: string
    bankTransactionId: string
    amount: number
    xeroUrl: string // deep link: https://go.xero.com/Bank/ViewTransaction.aspx?bankTransactionID=...
  }>
  failures: Array<{
    bankTransactionId: string
    error: string
    deterministic: boolean
  }>
  summary: { total: number; succeeded: number; failed: number }
}

// Written to .xero-reconcile-runs/YYYY-MM-DDTHH-MM-SS-execute.json with 0o600 perms
```

**State file schema:**

```json
{
  "schemaVersion": 1,
  "processedTransactions": {
    "<bankTransactionId>": "<paymentId>"
  }
}
```

`schemaVersion` is always the first field. On load, `loadState()` checks the version -- if missing or mismatched against the current `SCHEMA_VERSION` constant, it warns the user to back up and reset their state file. This prevents silent data corruption if the schema evolves in future updates.

**Idempotency (two-layer check):**
1. **Local state file** (fast, avoids API call) -- check `processedTransactions` map first
2. **Server-side pre-check** (crash recovery) -- before creating each payment, `GET /Payments?Where=Invoice.InvoiceID==guid("...")` to check if a matching payment already exists. If found, update local state and skip. This covers the crash-gap: if process dies between successful API payment creation and state file write, the next run detects the existing payment server-side.
3. After creating a payment, write to state file immediately via `saveJsonStateSync()` (verified atomic: temp file + rename)
4. On re-run, skip already-processed items and report them

**Rate limiting:** No dedicated module. `xeroFetch()` has built-in retry for 429/503 (max 3 attempts via `retry()` from `@side-quest/core/utils`) and reads `X-Rate-Limit-Problem` header to identify which limit was hit. It also reads `X-MinLimit-Remaining` and `X-DayLimit-Remaining` headers for proactive warnings when quota is low. `createPaymentsBatched()` adds batch-level retry with `isRetryableError` classifier for 429/500/503. Individual fallback only triggers on validation errors (400) and is throttled at ~55 req/min via `RATE_LIMIT_DELAY_MS` to stay under Xero's 60 req/min limit. When 429 is returned, the `Retry-After` header specifies how many seconds to wait before resuming.

**Edge cases:**
- Partial payments (amount < invoice) - export to CSV for manual review
- Overpayments (amount > invoice) - export to CSV (API rejects overpayments)
- Multi-currency - export to CSV
- Credit notes and prepayments - export to CSV

**Verification:** Run `/xero-reconcile` (dry-run by default), see matched/unmatched table. Run `/xero-reconcile --execute`, confirm payments created in Xero. Run `/xero-reconcile --export`, get CSV of unmatched.

---

## Pre-Implementation Checklist

- [ ] Register Xero app at https://developer.xero.com/app/manage/ BEFORE March 2, 2026 using "Auth Code with PKCE" type, redirect URI `http://127.0.0.1:5555/callback`
- [ ] Copy `XERO_CLIENT_ID` from the registered app into `.env`
- [ ] Verify scopes `accounting.transactions accounting.contacts offline_access` are accepted by the registered app

## Acceptance Criteria

- [ ] OAuth2 PKCE authentication works with Bun (auth flow, Keychain storage, auto-refresh)
- [ ] Unreconciled bank transactions are pulled and displayed correctly
- [ ] Outstanding invoices are pulled and matched against transactions
- [ ] Default mode (no flags) is dry-run -- shows what would happen without making changes
- [ ] `--execute` flag is REQUIRED for live payment creation (safety interlock in TypeScript)
- [ ] `reconcile.ts` throws if `execute` is not explicitly `true` (safety at code level, not just UX)
- [ ] High-confidence matches are reconciled via API (batched payments with isReconciled: true)
- [ ] Re-runs are idempotent (state file + server-side check prevents duplicate payments)
- [ ] CSV export works for unmatched transactions
- [ ] Partial failures don't abort the run (best-effort with batch reporting)
- [ ] All tests pass (`bun test`)
- [ ] No tokens, codes, or verifiers appear in any log output

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Granular scopes (post March 2 2026) | MITIGATED if app registered before March 2 | Register Xero app BEFORE March 2, 2026 (see Pre-Implementation Checklist). Apps created before that date use current scope format. |
| Refresh token lost during rotation | Low | Single JSON blob write is atomic. Previous refresh token saved in same bundle as `refreshTokenPrev`. Try backup on `invalid_grant`. |
| Payment creation succeeds but auto-match fails | Low | Log payment IDs, provide manual correction instructions |
| macOS Keychain access denied | Low | Hard-fail with instructions to grant Terminal Keychain access. No file-based fallback. |

### YAGNI Items Explicitly Excluded

These are deferred to future plans:
- ~~Browser automation~~ - See `2026-02-26-feat-xero-browser-reconciliation-plan.md`
- ~~Token Set Ratio fuzzy matching~~ - See `2026-02-26-feat-xero-advanced-matching-plan.md`
- ~~Australian bank description parser~~ - See advanced matching plan
- ~~Multi-dimensional invoice index~~ - See advanced matching plan
- ~~Weighted confidence scoring~~ - See advanced matching plan
- ~~OpenAPI type generation (openapi-typescript + openapi-fetch)~~ - See advanced matching plan
- ~~Rate limiter module~~ - Single user, ~100-200 calls/session. Inline retry on 429 is sufficient.
- ~~File locking on tokens~~ - Single user, single process. Keychain handles this.
- ~~Zod/schema validation library~~ - Lightweight type guards are sufficient for MVP. See tech spec for response shapes.

## Sources & References

### Xero Developer Documentation
- [Xero PKCE Flow](https://developer.xero.com/documentation/guides/oauth2/pkce-flow)
- [Xero OAuth2 Scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [Xero OAuth2 Auth Flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
- [Bank Transactions API](https://developer.xero.com/documentation/api/accounting/banktransactions)
- [Payments API](https://developer.xero.com/documentation/api/accounting/payments)
- [Rate Limits](https://developer.xero.com/documentation/guides/oauth2/limits)

### Dependencies

```bash
# Runtime
bun add @side-quest/core

# No dev-only type generation dependencies needed for MVP
```

### Tools & Packages
- [@side-quest/core](https://github.com/nathanvale/side-quest-core) - Nathan's shared utility library (oauth, fs, errors, concurrency, formatters, utils)

### Security References
- [PKCE for Native Apps (Xero blog)](https://devblog.xero.com/introducing-pkce-quick-easy-and-secure-use-of-oauth-2-0-for-native-apps-7696a4b83900)
- [macOS Keychain via security CLI](https://www.netmeister.org/blog/keychain-passwords.html)
- [OAuth 2.0 for Native Apps (RFC 8252)](https://tools.ietf.org/html/rfc8252)
