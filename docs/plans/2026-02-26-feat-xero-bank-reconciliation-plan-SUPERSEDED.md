---
title: "feat: Xero bank reconciliation with hybrid API and browser automation"
type: feat
status: superseded
date: 2026-02-26
---

> **SUPERSEDED:** This plan has been split into 3 separate plans:
> - `2026-02-26-feat-xero-reconciliation-mvp-plan.md` -- MVP: auth + simple matching
> - `2026-02-26-feat-xero-browser-reconciliation-plan.md` -- Future: browser automation
> - `2026-02-26-feat-xero-advanced-matching-plan.md` -- Future: fuzzy matching + OpenAPI types

# Xero Bank Reconciliation - Hybrid API + Browser Automation

## Enhancement Summary

**Deepened on:** 2026-02-26 (2 rounds + SideQuest Core integration)
**Round 1 agents:** Security Sentinel, Performance Oracle, Architecture Strategist, Code Simplicity Reviewer, Best Practices Researcher, Framework Docs Researcher
**Round 2 agents:** PKCE + Keychain Deep-Dive, Fuzzy Matching Engine, Browser Automation Patterns, OpenAPI Type Generation
**Round 3:** SideQuest Core utility analysis -- mapped 11 direct replacements across all modules

### Key Changes from Original Plan
1. **Dropped xero-node SDK** -- deprecated April 28, 2026. Using direct `fetch()` against Xero REST API instead.
2. **Added PKCE** -- Xero supports it natively for CLI apps. No `client_secret` needed.
3. **macOS Keychain** for token storage via macOS `security` CLI and `Bun.spawn()` (encrypted at rest in Keychain).
4. **Consolidated from 5 phases to 3** -- merged matching + reconciliation, dissolved polish phase.
5. **Consolidated from 8 files to 5** in `src/xero/` -- removed YAGNI modules.
6. **Removed YAGNI** -- rate limiter module, file locking, daily budget tracking, rules file, session log.
7. **Added** `config.ts`, `errors.ts`, `state.ts` for proper architecture.
8. **Batch payment creation** (50/request) -- 10-50x fewer API calls.
9. **OpenAPI types** via `openapi-typescript` + `openapi-fetch` -- typed fetch client from Xero OpenAPI spec v11.0.0.
10. **Token Set Ratio** matching algorithm via `fastest-levenshtein` -- handles Australian bank description patterns.
11. **Browser session persistence** via `--profile ~/.xero-session` and dashboard-based navigation.
12. **`@side-quest/core` integration** -- leverage existing utilities for state management, auth helpers, error handling, retry logic, and formatting. Saves ~4-5 hours of custom code.

---

## Overview

Build a tool that reconciles bank transactions in Xero using a hybrid approach: the Xero REST API (direct `fetch()`) for reads and simple payment matching, Claude for AI-powered categorisation and matching, and agent-browser (headed mode) for driving Xero's reconciliation UI when the API can't do the job.

## Problem Statement / Motivation

Manual bank reconciliation in Xero is tedious, repetitive work. Nathan needs to reconcile bank transactions regularly for tax return preparation. Xero's own AI (JAX) handles some auto-reconciliation, but there's no API surface for it and no way to script the remaining manual work. This tool automates the workflow: pull data via API, let Claude suggest matches, execute simple ones via API, and drive the browser for everything else.

## Proposed Solution

### Architecture

```
+---------------------------------------------------+
|  Claude Command: /xero-reconcile                  |
|  Thin orchestrator -- calls TypeScript modules    |
+--------------+--------------+---------------------+
|  API Layer   |  AI Layer    |  Browser Layer      |
|  fetch()     |  Claude      |  agent-browser      |
|  + types     |  analysis    |  --headed           |
+--------------+--------------+---------------------+
| Read txns    | Categorise   | Drive Xero UI       |
| Read invoices| Match        | for complex         |
| Create       | Suggest      | reconciliation      |
| payments     | account codes|                     |
+--------------+--------------+---------------------+
```

**Key decisions:**
- **Direct `fetch()` instead of xero-node SDK** -- The SDK is deprecated April 28, 2026. `fetch()` is native to Bun, zero dependencies, full API coverage.
- **`openapi-typescript` + `openapi-fetch`** -- Generate types from Xero OpenAPI spec v11.0.0. Typed fetch client with URL-level autocomplete, auth middleware, ~6kb runtime.
- **PKCE OAuth2 flow** -- No `client_secret` needed. More secure for CLI tools. Xero explicitly supports "Auth Code with PKCE" app type.
- **macOS Keychain for token storage** -- Encrypted at rest, locked with screen lock, no plaintext tokens on disk. Uses macOS `security` CLI via `Bun.spawn()` for Keychain read/write.
- **Claude commands are thin** -- Workflow logic lives in TypeScript modules. Commands call functions and present results.
- **`@side-quest/core` for shared utilities** -- State persistence, token expiry checks, retry logic, error hierarchy, currency formatting, and batch chunking all come from Nathan's existing library instead of custom code.

### `@side-quest/core` Integration Map

The `@side-quest/core` library (Nathan's shared utility package) provides battle-tested implementations for several modules in this project. Using it eliminates ~4-5 hours of custom code and ensures consistency across projects.

| Plan Module | SideQuest Core Utility | Replaces |
|---|---|---|
| `state.ts` | `loadJsonStateSync()`, `saveJsonStateSync()` from `@side-quest/core/fs` | Custom atomic JSON read/write + schema validation |
| `auth.ts` | `isTokenExpired()` from `@side-quest/core/oauth` | Custom expiry check logic |
| `auth.ts` | `generateSecureToken()` from `@side-quest/core/password` | Custom `crypto.getRandomValues` for OAuth2 `state` param |
| `api.ts` | `retry()` from `@side-quest/core/utils` | Inline retry-on-429 logic |
| `reconcile.ts` | `chunk()` from `@side-quest/core/utils` | Custom batch splitting in `createPaymentsBatched()` |
| `reconcile.ts` | `groupBy()` from `@side-quest/core/utils` | Manual categorisation grouping |
| `errors.ts` | `StructuredError` from `@side-quest/core/errors` | Custom error base class |
| `errors.ts` | `getErrorMessage()` from `@side-quest/core/utils` | Safe error-to-string extraction |
| `export.ts` | `formatCurrency()` from `@side-quest/core/formatters` | Custom AUD formatting |
| `scripts/xero-auth-server.ts` | `withTimeout()` from `@side-quest/core/concurrency` | Custom 120s server timeout logic |
| `xero-browse.md` | `commandExists()` from `@side-quest/core/spawn` | Custom agent-browser availability check |

**Not using from SideQuest Core** (custom implementation needed):
- `OAuthCredentials` type -- missing `client_secret` field (PKCE has no secret)
- `RateLimiter` -- uses min-delay pattern, we need sliding-window for Xero's 60/min
- `saveTokenFile()`/`loadTokenFile()` -- we use macOS Keychain via `security` CLI, not file-based tokens

### Project Structure

```
tax-return/
+-- .claude/
|   +-- commands/
|       +-- xero-auth.md           # OAuth2 authentication
|       +-- xero-reconcile.md      # Main reconciliation workflow
|       +-- xero-browse.md         # Browser-driven reconciliation
|       +-- xero-status.md          # Show reconciliation state and last run summary
+-- .env.example                   # Template (XERO_CLIENT_ID only -- no secret with PKCE)
+-- .xero-config.json              # Runtime config: tenant ID, org name (gitignored)
+-- .xero-reconcile-state.json     # Run state for idempotency (gitignored)
+-- redocly.yaml                   # OpenAPI type generation config (pinned to Xero spec v11.0.0)
+-- src/
|   +-- index.ts                   # Re-exports
|   +-- types/
|   |   +-- xero-accounting.d.ts   # Generated from Xero OpenAPI spec (do not edit)
|   +-- xero/
|       +-- config.ts              # Load + validate env vars and .xero-config.json
|       +-- auth.ts                # OAuth2 PKCE flow + token refresh + Keychain via `security` CLI
|       +-- api.ts                 # Typed Xero API client (openapi-fetch + auth middleware)
|       +-- matcher.ts             # Pure matching logic (testable, no side effects)
|       +-- reconcile.ts           # Orchestration: categorise, execute, manage state
|       +-- state.ts               # State file via `@side-quest/core/fs` (loadJsonStateSync/saveJsonStateSync)
|       +-- errors.ts              # Typed error hierarchy extending `@side-quest/core/errors` StructuredError
|       +-- export.ts              # Fallback JSON/CSV export for manual processing
+-- tests/
|   +-- xero/
|       +-- auth.test.ts
|       +-- api.test.ts
|       +-- matcher.test.ts
|       +-- reconcile.test.ts
|       +-- state.test.ts
+-- scripts/
    +-- xero-auth-server.ts        # OAuth2 callback server (Bun.serve on 127.0.0.1:3000)
    +-- generate-xero-types.ts     # Run openapi-typescript against Xero spec
```

### Research Insights: Why Not xero-node

The xero-node SDK (v13.3.0) is auto-generated from an OpenAPI spec and **deprecated on April 28, 2026** (source: Xero SDKs Overview page). Building on it creates immediate technical debt. The Xero REST API is straightforward:

```typescript
/** Example: fetch unreconciled bank transactions */
async function getBankTransactions(accessToken: string, tenantId: string, page = 1) {
  const where = encodeURIComponent('IsReconciled==false AND Date>=DateTime(2025,01,01)')
  const response = await fetch(
    `https://api.xero.com/api.xro/2.0/BankTransactions?where=${where}&page=${page}&order=Date%20DESC`,
    {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'xero-tenant-id': tenantId,
        'Accept': 'application/json',
      },
    },
  )
  if (!response.ok) throw new XeroApiError(response)
  return response.json()
}
```

### Deep-Dive: OpenAPI Type Generation

Instead of hand-writing types or depending on the deprecated SDK, generate them from the Xero OpenAPI spec using `openapi-typescript` + `openapi-fetch`:

```yaml
# redocly.yaml -- pin to specific Xero spec version
apis:
  xero-accounting:
    root: https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/v11.0.0/xero_accounting.yaml
```

```bash
# Generate types (run once, commit the output)
bunx openapi-typescript redocly.yaml -o src/types/xero-accounting.d.ts
```

```typescript
// src/xero/api.ts -- typed fetch client with auth middleware
import createClient, { type Middleware } from 'openapi-fetch'
import type { paths } from '../types/xero-accounting'

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = await ensureFreshToken()
    request.headers.set('Authorization', `Bearer ${token}`)
    request.headers.set('xero-tenant-id', getTenantId())
    return request
  },
}

const xero = createClient<paths>({ baseUrl: 'https://api.xero.com/api.xro/2.0' })
xero.use(authMiddleware)

// Full type safety -- URL autocomplete, response types inferred
const { data, error } = await xero.GET('/BankTransactions', {
  params: { query: { where: 'IsReconciled==false', page: 1 } },
})
```

**Dependencies:** `openapi-typescript` (dev only), `openapi-fetch` (~6kb runtime). Types are generated and committed -- no runtime dependency on the spec.

---

## Technical Considerations

### Xero API Constraints (confirmed via research)

- **No reconciliation API** -- Xero explicitly states "no immediate plans" to add this
- **Workaround:** Create payments with `isReconciled: true`; Xero auto-matches when amount/date/bank account align with a bank feed line
- **Bank Feeds API** is restricted to financial institutions -- not available
- **Rate limits:** 60 calls/min, 5,000/day per org, 5 concurrent requests
- **OAuth2:** 30-min access tokens, single-use refresh tokens (60-day expiry if unused)
- **Granular scopes:** Apps created after 2 March 2026 need new scope format
- **`IsReconciled` filter is not "optimised"** for high-volume orgs -- always combine with Date range filter
- **Overpayments via API return validation error** -- can't overpay, must be exact or partial
- **200 responses can contain validation errors** -- always check `hasErrors` on results
- **Batch limit:** 50 payments per POST request
- **Pagination:** 100 items per page, no total count, increment until `length < 100`

### Research Insights: BankTransactions vs BankStatementLines

These are different things:
- **BankTransactions** = spend/receive money entries recorded in Xero's ledger. Has `IsReconciled` field. **This is what we query.**
- **BankStatementLines** = raw bank feed lines imported from bank feeds. No `IsReconciled` field. These are what's waiting to be matched.

We filter `BankTransactions` with `IsReconciled==false` to find unreconciled items.

### Security

- **PKCE OAuth2** -- No `client_secret` stored anywhere. Code verifier + challenge per auth session.
- **macOS Keychain** for tokens via macOS `security` CLI and `Bun.spawn()` -- encrypted at rest in Keychain
- **Atomic token writes** -- write to temp file, then rename (same filesystem = atomic on POSIX)
- **OAuth2 `state` parameter** -- cryptographically random, validated in callback to prevent CSRF
- **Callback server binds to `127.0.0.1`** -- not `0.0.0.0`, prevents LAN access
- **Callback server timeout** -- 120s, auto-shuts down after receiving callback
- **Scopes minimised** -- only `accounting.transactions accounting.contacts accounting.settings offline_access` (dropped unnecessary `openid profile email`)
- **Logging policy** -- NEVER log tokens, authorization codes, or code verifiers. Redact `Authorization` headers in error logs. Safe to log: transaction IDs, amounts, counts, timestamps, error messages (without headers).
- Never store Xero web UI credentials -- user pre-authenticates manually in headed browser

### Research Insights: Token Refresh Mutex

With single-use refresh tokens, concurrent refresh attempts will invalidate each other. Use a mutex pattern:

```typescript
let refreshPromise: Promise<void> | null = null

async function ensureFreshToken(): Promise<void> {
  if (!isNearExpiry(5 * 60 * 1000)) return
  if (refreshPromise) {
    await refreshPromise  // another caller is already refreshing
    return
  }
  refreshPromise = doRefresh()
  try { await refreshPromise }
  finally { refreshPromise = null }
}
```

On `invalid_grant` error: re-read tokens from Keychain (another process may have refreshed) and retry once before declaring re-auth needed.

**Refresh token rotation safety:**
Save tokens in priority order -- refresh token first (most critical). Keep previous refresh token as fallback.

```typescript
async function doRefresh(currentRefreshToken: string): Promise<void> {
  const response = await fetchNewTokens(currentRefreshToken)
  // Save previous as backup before overwriting
  await saveToKeychain('refresh_token_prev', currentRefreshToken)
  // Save new refresh token FIRST -- most critical
  await saveToKeychain('refresh_token', response.refreshToken)
  // Then access token and expiry
  await saveToKeychain('access_token', response.accessToken)
  await saveToKeychain('expires_at', String(response.expiresAt))
}
```

On `invalid_grant`: try `refresh_token_prev` before requiring full re-auth.

### Error Handling Strategy

Typed error hierarchy in `src/xero/errors.ts`, extending `StructuredError` from `@side-quest/core/errors` (provides `name`, `cause`, `context` out of the box). Use `getErrorMessage()` from `@side-quest/core/utils` for safe error-to-string extraction in catch blocks:

```typescript
import { StructuredError } from '@side-quest/core/errors'

class XeroError extends StructuredError { /* base -- inherits name, cause, context */ }
class XeroAuthError extends XeroError { /* 401 -- re-auth needed */ }
class XeroRateLimitError extends XeroError { retryAfter: number /* from header */ }
class XeroValidationError extends XeroError { /* 400 or hasErrors -- skip item */ }
class XeroServerError extends XeroError { /* 500/503 -- retry with backoff */ }
```

**Partial failure strategy:** Best-effort with batch reporting. Process as many transactions as possible, collect failures, report all at the end.

---

## Implementation Phases

### Phase 1: Auth + Read Transactions

**Goal:** Authenticate with Xero via PKCE and pull unreconciled bank transactions.

**Files:**
- `src/xero/config.ts` -- Load and validate `XERO_CLIENT_ID` from env + `.xero-config.json` for tenant. Fail fast with clear messages.
- `src/xero/auth.ts` -- PKCE flow: `generateCodeVerifier()`, `generateCodeChallenge()`, `getAuthorizationUrl()`, `exchangeCodeForTokens(code, verifier)`, `refreshAccessToken()`. Token storage via macOS `security` CLI + `Bun.spawn()`. Uses `isTokenExpired()` from `@side-quest/core/oauth` and `generateSecureToken()` from `@side-quest/core/password` for the OAuth2 `state` param. Mutex for refresh. Validates returned scopes after token exchange -- fails fast if required scopes are missing.
- `src/xero/api.ts` -- `getUnreconciledTransactions(page?)` with Date range filter + `IsReconciled==false`. Paginate until `length < 100`. All API calls go through `withFreshToken()` wrapper. Uses `retry()` from `@side-quest/core/utils` for 429/503 resilience.
- `src/types/xero-accounting.d.ts` -- Generated from Xero OpenAPI spec (committed, not hand-written)
- `src/xero/errors.ts` -- Typed error hierarchy (see above)
- `scripts/xero-auth-server.ts` -- `Bun.serve()` on `127.0.0.1:3000`, validates `state` param, 120s timeout via `withTimeout()` from `@side-quest/core/concurrency`, returns HTML confirmation page, shuts down via `queueMicrotask(() => server.stop())`
- `.claude/commands/xero-auth.md` -- Thin command: runs `bun scripts/xero-auth-server.ts`, confirms success
- `.env.example` -- `XERO_CLIENT_ID=` (no secret needed with PKCE)

**Auth scopes:** `accounting.transactions accounting.contacts accounting.settings offline_access`

**Tenant selection:** After first auth, call `GET /connections` to list orgs. Let user choose. Save to `.xero-config.json` (not `.env` -- separate static config from runtime state). Display org name before any actions.

**Deep-Dive: PKCE Auth with macOS Keychain**

Token storage uses macOS `security` CLI via `Bun.spawn()` for encrypted Keychain access. Token expiry checks use `isTokenExpired()` from `@side-quest/core/oauth`. OAuth2 `state` parameter uses `generateSecureToken()` from `@side-quest/core/password`.

```typescript
// Token storage -- macOS Keychain via `security` CLI
const KEYCHAIN_SERVICE = 'xero-tax-return'

async function saveToKeychain(key: string, value: string): Promise<void> {
  const proc = Bun.spawn(['security', 'add-generic-password',
    '-s', KEYCHAIN_SERVICE, '-a', key, '-w', value, '-U'])
  await proc.exited
}

async function loadFromKeychain(key: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(['security', 'find-generic-password',
      '-s', KEYCHAIN_SERVICE, '-a', key, '-w'])
    const text = await new Response(proc.stdout).text()
    return text.trim() || null
  } catch { return null }
}

async function loadTokens(): Promise<XeroTokens | null> {
  const accessToken = await loadFromKeychain('access_token')
  if (!accessToken) return null
  return {
    accessToken,
    refreshToken: await loadFromKeychain('refresh_token') ?? '',
    expiresAt: Number(await loadFromKeychain('expires_at') ?? 0),
  }
}
```

```typescript
// PKCE S256 flow -- no client_secret needed
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
    redirect_uri: 'http://127.0.0.1:3000/callback',
    scope: 'accounting.transactions accounting.contacts accounting.settings offline_access',
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state,
  })
  return `https://login.xero.com/identity/connect/authorize?${params}`
}
```

```typescript
// Convenience wrapper -- all API calls go through this
async function xeroFetch(path: string, options?: RequestInit): Promise<Response> {
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
  if (response.status === 401) throw new XeroAuthError('Token expired -- re-auth needed')
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get('Retry-After') ?? 60)
    throw new XeroRateLimitError(retryAfter)
  }
  return response
}
```

**Note:** The `security` CLI requires Terminal to have Keychain access. If denied, fall back to file-based tokens with `chmod 600`.

**Verification:** Run `/xero-auth`, authenticate in browser, then `bun run src/xero/api.ts` prints unreconciled transactions.

### Phase 2: Match + Reconcile (merged from original phases 2+3)

**Goal:** Claude analyses transactions, suggests matches, and executes API reconciliation for high-confidence items.

**Files:**
- `src/xero/api.ts` (extend) -- Typed via `openapi-fetch` client. `getOutstandingInvoices()` filtering `Status=='AUTHORISED'` for ACCREC and ACCPAY. Filter by date range and amount range based on transaction set. `createPaymentsBatched(payments, batchSize=50)`.
- `src/xero/matcher.ts` -- Pure matching functions (no side effects, fully testable):
  - `findPotentialMatches(transactions, invoices)` -- exact amount, fuzzy contact, reference parsing, date proximity
  - Returns `Match[]` with confidence: `high` (>= 85%) / `medium` (50-84%) / `low` (< 50%)
  - Build invoice lookup index by amount (Map) for O(1) exact matches
- `src/xero/reconcile.ts` -- Orchestration:
  - `categoriseForReconciliation(matches, state)` -- splits into apiReconcilable / browserRequired / needsReview / alreadyProcessed
  - `executeReconciliation(apiReconcilable)` -- batch payment creation, state updates, error collection
  - Partial failure: best-effort with batch reporting
- `src/xero/state.ts` -- `loadState()`, `saveState()`, `markProcessed()`, `isProcessed()`, `getStateSummary()`. Uses `loadJsonStateSync()` and `saveJsonStateSync()` from `@side-quest/core/fs` for atomic JSON persistence. Schema-versioned. Validate on load.
- `.claude/commands/xero-reconcile.md` -- Thin orchestrator: calls TypeScript modules, presents results, asks for confirmation
- `.claude/commands/xero-status.md` -- Thin command: reads state file, displays last run time, transactions matched, pending count, errors. Works when no state file exists (first run).

**`--dry-run` is core, not polish.** It's how you verify matching before executing. Built into Phase 2 from the start.

**Matching logic:**
- Exact amount match against outstanding invoices (O(1) via index)
- Contact name fuzzy match (handle "PAYMENT ACME CORP" vs "Acme Corporation")
- Reference/invoice number in bank description
- Date proximity scoring
- Claude enhances with reasoning: parse descriptions, suggest account codes, flag duplicates

**Deep-Dive: Matching Engine**

**Token Set Ratio algorithm** (via `fastest-levenshtein`) for fuzzy contact matching:

```typescript
import { distance } from 'fastest-levenshtein'

/** Token Set Ratio -- handles word order and subset matching */
function tokenSetRatio(a: string, b: string): number {
  const tokensA = new Set(normalise(a).split(' '))
  const tokensB = new Set(normalise(b).split(' '))
  const intersection = [...tokensA].filter(t => tokensB.has(t))
  const sortedIntersection = intersection.sort().join(' ')
  const sortedA = [...tokensA].sort().join(' ')
  const sortedB = [...tokensB].sort().join(' ')

  const t0_ab = `${sortedIntersection} ${sortedA}`.trim()
  const t0_ba = `${sortedIntersection} ${sortedB}`.trim()

  const maxLen = Math.max(t0_ab.length, t0_ba.length)
  if (maxLen === 0) return 100
  return Math.round((1 - distance(t0_ab, t0_ba) / maxLen) * 100)
}
```

**Australian bank description parser** -- extracts merchant names from common patterns:

```typescript
/** Parse Australian bank descriptions into structured data */
function parseBankDescription(description: string): ParsedDescription {
  const patterns = [
    { type: 'eftpos', regex: /^EFTPOS\s+(.+?)(?:\s+\d{2}\/\d{2})/ },
    { type: 'bpay', regex: /^BPAY\s+(.+?)(?:\s+REF:\s*(.+))?$/ },
    { type: 'directDebit', regex: /^(?:DIRECT DEBIT|DD)\s+(.+?)(?:\s+REF:\s*(.+))?$/ },
    { type: 'transfer', regex: /^(?:TRANSFER|TFR)\s+(?:TO|FROM)\s+(.+)/ },
    { type: 'paypal', regex: /^PAYPAL\s*\*?\s*(.+)/ },
  ]
  for (const { type, regex } of patterns) {
    const match = description.match(regex)
    if (match) return { type, merchant: match[1].trim(), reference: match[2]?.trim() }
  }
  return { type: 'unknown', merchant: description, reference: undefined }
}
```

**Invoice index** -- multi-dimensional for O(1) lookups:

```typescript
/** Build invoice index for fast matching */
function buildInvoiceIndex(invoices: Invoice[]): InvoiceIndex {
  const byAmount = new Map<string, Invoice[]>()      // rounded to 2dp
  const byContact = new Map<string, Invoice[]>()      // normalised name
  const byReference = new Map<string, Invoice[]>()    // invoice number

  for (const inv of invoices) {
    const amountKey = inv.AmountDue.toFixed(2)
    byAmount.set(amountKey, [...(byAmount.get(amountKey) ?? []), inv])

    const contactKey = normalise(inv.Contact?.Name ?? '')
    if (contactKey) byContact.set(contactKey, [...(byContact.get(contactKey) ?? []), inv])

    if (inv.InvoiceNumber) byReference.set(inv.InvoiceNumber.toLowerCase(), [inv])
  }
  return { byAmount, byContact, byReference }
}
```

**Confidence scoring** (weights: amount 40%, contact 30%, reference 20%, date 10%):
```typescript
/** Weights tuned for Australian tax return matching -- amount is strongest signal */
const CONFIDENCE_WEIGHTS = {
  amountExact: 40,
  amountTolerance: 25,  // GST rounding tolerance: $0.50
  contactSimilarity: 30,
  referenceFound: 20,
  dateClose: 10,        // <= 3 days
  dateNearby: 5,        // <= 7 days
} as const satisfies Record<string, number>

function calculateConfidence(match: CandidateMatch): number {
  let score = 0
  if (match.amountExact) score += CONFIDENCE_WEIGHTS.amountExact
  else if (match.amountWithinTolerance) score += CONFIDENCE_WEIGHTS.amountTolerance
  score += (match.contactSimilarity / 100) * CONFIDENCE_WEIGHTS.contactSimilarity
  if (match.referenceFound) score += CONFIDENCE_WEIGHTS.referenceFound
  if (match.dateProximity <= 3) score += CONFIDENCE_WEIGHTS.dateClose
  else if (match.dateProximity <= 7) score += CONFIDENCE_WEIGHTS.dateNearby
  return Math.min(score, 100)
}
```

**Australian edge cases:**
- GST rounding -- tolerance of $0.50 for amount matching
- Forex transactions -- skip API route, always browser (multi-currency)
- BPAY references -- often invoice numbers, check `byReference` index
- Bank descriptions truncated at 18 chars for some banks

**Categorisation output:**
```typescript
interface ReconcileResult {
  apiReconcilable: Match[]      // high confidence invoice payments
  browserRequired: Match[]      // transfers, manual matches, amount mismatches
  needsReview: Match[]          // low confidence, show to user
  alreadyProcessed: string[]    // from state file, skip these
}
```

**Edge cases:**
- Partial payments (amount < invoice) -- route to browser with annotation
- Overpayments (amount > invoice) -- route to browser (API will reject overpayments)
- Multi-currency -- skip API route, always browser
- Credit notes and prepayments -- route to browser (different API calls)

**Research Insights: Batch Payment Creation**

```typescript
import { chunk } from '@side-quest/core/utils'
import { retry } from '@side-quest/core/utils'

async function createPaymentsBatched(payments: PaymentInput[], batchSize = 50): Promise<PaymentResult[]> {
  const results: PaymentResult[] = []
  for (const batch of chunk(payments, batchSize)) {
    try {
      const response = await xeroPost('/Payments', { Payments: batch.map(toXeroPayment) })
      for (const payment of response.Payments ?? []) {
        if (payment.HasErrors) {
          results.push({ success: false, errors: payment.ValidationErrors })
        } else {
          await state.markProcessed(payment.BankTransactionID, payment.PaymentID)
          results.push({ success: true, payment })
        }
      }
    } catch (error) {
      // On batch failure, fall back to individual creation
      for (const p of batch) {
        try {
          const response = await xeroPost('/Payments', toXeroPayment(p))
          await state.markProcessed(p.bankLineId, response.Payments[0].PaymentID)
          results.push({ success: true, payment: response.Payments[0] })
        } catch (individualError) {
          results.push({ success: false, input: p, error: individualError })
        }
      }
    }
  }
  return results
}
```

**Research Insights: Server-side Idempotency**

Before creating a payment, also check the Xero API for existing payments on that invoice (not just the local state file). This catches payments created manually or by a previous interrupted run where the state file wasn't updated.

**Idempotency:**
- Check local state file first (fast, avoids API call)
- If not in state file, query Xero for existing payments on the invoice (server-side check)
- After creating a payment, write to state file immediately (atomic write)
- On re-run, skip already-processed items and report them

**Rate limiting:** No dedicated module. Use `retry()` from `@side-quest/core/utils` with custom shouldRetry to respect `Retry-After` header on 429s. Max 3 attempts with exponential backoff. For a single-user tool running ~100-200 calls per session, this is sufficient.

**Verification:** Run `/xero-reconcile --dry-run`, see categorised matches table. Run without `--dry-run`, confirm matches, verify in Xero web UI.

### Phase 3: Browser-Driven Reconciliation

**Goal:** Handle transactions that can't be reconciled via API.

**Files:**
- `.claude/commands/xero-browse.md` -- Browser automation command using agent-browser
- `src/xero/export.ts` -- First-class fallback: `exportUnmatchedAsJson()`, `exportUnmatchedAsCsv()` with suggested account codes. Uses `formatCurrency()` from `@side-quest/core/formatters` for AUD display.

**Workflow:**
1. Check if `agent-browser` is installed via `commandExists()` from `@side-quest/core/spawn`; if not, call `export.ts` and output file path
2. Launch `agent-browser --headed --profile ~/.xero-session` (cookie persistence across runs)
3. Navigate to Xero -- detect login page vs. dashboard
4. If login page: prompt user "Please log in to Xero in the browser, then press Enter to continue"
5. After login: verify org name in page matches `.xero-config.json` tenant
6. Navigate via dashboard (not hardcoded URLs) -- click Accounting > Bank Reconciliation
7. For each remaining transaction:
   - Snapshot interactive elements (`agent-browser snapshot -i`)
   - Locate the matching row by amount/date/description
   - Choose action based on match type:
     - **Find & Match** -- for transactions with invoice matches
     - **Create** -- for expenses needing account code assignment
     - **Transfer** -- for inter-account movements
   - Fill matching details using element refs (`@e1`, `@e2`, etc.)
   - Confirm reconciliation
   - Update state file
8. Use event-driven waits (not fixed pauses)
9. On error: screenshot for debugging, skip to next transaction

**Screenshots:** Opt-in via `--screenshots` flag (not default). Default: log action + timestamp + transaction ID.

**Deep-Dive: Browser Automation Patterns**

**Session persistence** -- `--profile ~/.xero-session` stores cookies between runs. Users log in once; subsequent runs skip authentication:

```bash
# First run -- user logs in manually
agent-browser --headed --profile ~/.xero-session

# Subsequent runs -- session cookies are reused
agent-browser --headed --profile ~/.xero-session  # already authenticated
```

**Login detection:**

```
# Check if we're on the login page or dashboard
agent-browser snapshot -i
# Look for refs containing "Login" or "Sign in" vs. "Dashboard" or "Organisation"
```

**Navigation via dashboard** (not hardcoded URLs -- Xero URLs change):

```
# From dashboard, navigate to reconciliation
agent-browser click @e[accounting-menu]
agent-browser wait --text "Bank Reconciliation"
agent-browser click @e[bank-reconciliation-link]
agent-browser wait --load networkidle
```

**Snapshot-then-act pattern** -- ALWAYS re-snapshot after any DOM mutation:

```
# 1. Snapshot to discover elements
agent-browser snapshot -i
# 2. Act on an element
agent-browser click @e5
# 3. Re-snapshot (DOM has changed)
agent-browser snapshot -i
# 4. Continue with new refs
```

**Event-driven waits** (never use `sleep`):

```
agent-browser wait --text "Reconciled"       # wait for text to appear
agent-browser wait --load networkidle        # wait for network to settle
agent-browser wait --fn "!document.querySelector('.spinner')"  # custom JS condition
```

**Error recovery:**
- On element not found: re-snapshot, retry once with fresh refs
- On navigation error: return to dashboard, start fresh for that transaction
- On timeout: screenshot + skip transaction + log for manual review
- Never retry the same click more than once -- DOM may have changed

**Verification:** Open headed browser, process a transaction, verify in Xero.

---

## Acceptance Criteria

- [ ] OAuth2 PKCE authentication works with Bun (auth flow, Keychain storage, auto-refresh)
- [ ] Unreconciled bank transactions are pulled and displayed correctly
- [ ] Outstanding invoices are pulled and matched against transactions
- [ ] `--dry-run` shows what would happen without making changes
- [ ] High-confidence matches are reconciled via API (batched payments with isReconciled: true)
- [ ] Re-runs are idempotent (state file + server-side check prevents duplicate payments)
- [ ] Browser automation handles remaining transactions in headed mode
- [ ] Fallback JSON/CSV export works when agent-browser is unavailable
- [ ] Partial failures don't abort the run (best-effort with batch reporting)
- [ ] All tests pass (`bun test`)
- [ ] All quality checks pass (`bun run validate`)
- [ ] No tokens, codes, or verifiers appear in any log output

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Granular scopes (post March 2 2026) | High | Check Xero docs for exact new scope format when creating app |
| Refresh token lost during rotation | Medium | Save refresh token first. Keep previous as backup. Try backup on invalid_grant. |
| Xero UI changes break browser automation | Medium | agent-browser refs are more resilient than CSS selectors. Re-snapshot and adapt. |
| Payment creation succeeds but auto-match fails | Low | Log payment IDs, provide manual correction instructions |
| macOS Keychain access denied | Low | Fall back to file-based tokens with `chmod 600`. Prompt user to grant Terminal access. |

### YAGNI Items Explicitly Excluded

These were in the original plan but removed after simplicity review:
- ~~Rate limiter module~~ -- Single user, ~100-200 calls/session. Inline retry on 429 is sufficient.
- ~~File locking on tokens~~ -- Single user, single process. Keychain handles this.
- ~~Daily budget tracking~~ -- 200 calls vs 5,000 limit. Not a real risk.
- ~~Categorisation rules file~~ -- No known patterns yet. Add when patterns emerge.
- ~~Session history log~~ -- Xero has full audit trail. State file tracks what was processed.
- ~~Proactive background refresh~~ -- `withFreshToken()` wrapper handles this before each API call.
- ~~`src/utils/` directory~~ -- General utilities come from `@side-quest/core`.

## Sources & References

### Xero Developer Documentation
- [Xero PKCE Flow](https://developer.xero.com/documentation/guides/oauth2/pkce-flow)
- [Xero OAuth2 Scopes](https://developer.xero.com/documentation/guides/oauth2/scopes/)
- [Xero OAuth2 Auth Flow](https://developer.xero.com/documentation/guides/oauth2/auth-flow/)
- [Bank Transactions API](https://developer.xero.com/documentation/api/accounting/banktransactions)
- [Payments API](https://developer.xero.com/documentation/api/accounting/payments)
- [Rate Limits](https://developer.xero.com/documentation/guides/oauth2/limits)
- [Xero OpenAPI Spec](https://github.com/XeroAPI/Xero-OpenAPI)

### Dependencies

```bash
# Runtime
bun add @side-quest/core openapi-fetch fastest-levenshtein

# Dev only (type generation)
bun add -d openapi-typescript
```

### Tools & Packages
- [@side-quest/core](https://github.com/nathanvale/side-quest-core) -- Nathan's shared utility library (oauth, fs, errors, concurrency, formatters, utils)
- [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) -- generate TypeScript types from OpenAPI specs
- [openapi-fetch](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch) -- typed fetch client (~6kb)
- [fastest-levenshtein](https://github.com/ka-weihe/fastest-levenshtein) -- fastest JS string distance
- [agent-browser CLI](https://www.npmjs.com/package/agent-browser) (Vercel) -- ref-based browser automation

### Community Research
- Xero UserVoice "Reconcile via the API" -- open since 2013, no plans to implement
- JAX (Xero AI auto-reconciliation) -- launched Nov 2025, zero API surface
- xero-node SDK deprecated April 28, 2026 -- use direct REST API instead
- Xero API pricing changes incoming March 2026

### Security References
- [PKCE for Native Apps (Xero blog)](https://devblog.xero.com/introducing-pkce-quick-easy-and-secure-use-of-oauth-2-0-for-native-apps-7696a4b83900)
- [macOS Keychain via security CLI](https://www.netmeister.org/blog/keychain-passwords.html)
- [OAuth 2.0 for Native Apps (RFC 8252)](https://tools.ietf.org/html/rfc8252)
