---
title: "feat: Xero advanced matching - fuzzy matching, AU bank parser, confidence scoring"
type: feat
status: future
date: 2026-02-26
prerequisite: 2026-02-26-feat-xero-reconciliation-mvp-plan.md
---

# Xero Advanced Matching Engine

## Overview

Upgrade the MVP's simple matching (exact amount + contact substring) with a sophisticated matching engine: Token Set Ratio fuzzy matching, Australian bank description parsing, multi-dimensional invoice indexing, weighted confidence scoring, and OpenAPI type generation for full type safety.

**Prerequisite:** The MVP plan (`2026-02-26-feat-xero-reconciliation-mvp-plan.md`) must be implemented first. This plan replaces/extends `src/xero/matcher.ts` and `src/xero/api.ts` from the MVP.

**Split from:** `2026-02-26-feat-xero-bank-reconciliation-plan-SUPERSEDED.md`

---

## Proposed Solution

### Token Set Ratio Algorithm

Fuzzy contact matching via `fastest-levenshtein`. Handles word order and subset matching (e.g., "PAYMENT ACME CORP" vs "Acme Corporation"):

```typescript
import { distance } from 'fastest-levenshtein'

/** Token Set Ratio - handles word order and subset matching */
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

### Australian Bank Description Parser

Extracts merchant names from common Australian bank description patterns (5 regex patterns):

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

**Australian edge cases:**
- GST rounding - tolerance of $0.50 for amount matching
- Forex transactions - skip API route, always browser (multi-currency)
- BPAY references - often invoice numbers, check `byReference` index
- Bank descriptions truncated at 18 chars for some banks

### Multi-Dimensional Invoice Index

O(1) lookups across amount, contact, and reference:

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

### Weighted Confidence Scoring

Weights: amount 40%, contact 30%, reference 20%, date 10%:

```typescript
/** Weights tuned for Australian tax return matching - amount is strongest signal */
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

**Confidence tiers:**
- `high` (>= 85%) - auto-reconcile via API
- `medium` (50-84%) - show to user for confirmation
- `low` (< 50%) - export to CSV / route to browser

**Categorisation output:**

```typescript
interface ReconcileResult {
  apiReconcilable: Match[]      // high confidence invoice payments
  browserRequired: Match[]      // transfers, manual matches, amount mismatches
  needsReview: Match[]          // medium confidence, show to user
  alreadyProcessed: string[]    // from state file, skip these
}
```

### OpenAPI Type Generation

Generate types from the Xero OpenAPI spec using `openapi-typescript` + `openapi-fetch` for full type safety:

```yaml
# redocly.yaml - pin to specific Xero spec version
apis:
  xero-accounting:
    root: https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/v11.0.0/xero_accounting.yaml
```

```bash
# Generate types (run once, commit the output)
bunx openapi-typescript redocly.yaml -o src/types/xero-accounting.d.ts
```

```typescript
// src/xero/api.ts - typed fetch client with auth middleware
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

// Full type safety - URL autocomplete, response types inferred
const { data, error } = await xero.GET('/BankTransactions', {
  params: { query: { where: 'IsReconciled==false', page: 1 } },
})
```

**Dependencies:** `openapi-typescript` (dev only), `openapi-fetch` (~6kb runtime). Types are generated and committed - no runtime dependency on the spec.

### Files to Add/Modify

- `src/xero/matcher.ts` - Replace simple matching with Token Set Ratio + confidence scoring
- `src/xero/api.ts` - Replace manual `fetch()` with `openapi-fetch` typed client
- `src/types/xero-accounting.d.ts` - Generated from Xero OpenAPI spec (do not edit)
- `redocly.yaml` - OpenAPI type generation config
- `scripts/generate-xero-types.ts` - Run openapi-typescript against Xero spec
- `tests/xero/matcher.test.ts` - Extend with fuzzy matching and AU bank parser tests

### Extended Error Hierarchy

When advanced matching is added, the error hierarchy may need expansion:

```typescript
class XeroError extends StructuredError { /* base */ }
class XeroAuthError extends XeroError { /* 401 - re-auth needed */ }
class XeroRateLimitError extends XeroError { retryAfter: number /* from header */ }
class XeroValidationError extends XeroError { /* 400 or hasErrors - skip item */ }
class XeroServerError extends XeroError { /* 500/503 - retry with backoff */ }
```

---

## Dependencies

```bash
# Runtime (in addition to MVP dependencies)
bun add openapi-fetch fastest-levenshtein

# Dev only (type generation)
bun add -d openapi-typescript
```

### Tools & Packages
- [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) - generate TypeScript types from OpenAPI specs
- [openapi-fetch](https://github.com/openapi-ts/openapi-typescript/tree/main/packages/openapi-fetch) - typed fetch client (~6kb)
- [fastest-levenshtein](https://github.com/ka-weihe/fastest-levenshtein) - fastest JS string distance

---

## Acceptance Criteria

- [ ] MVP plan is fully implemented (prerequisite)
- [ ] Token Set Ratio matching produces accurate fuzzy contact matches
- [ ] Australian bank description parser handles all 5 patterns correctly
- [ ] Multi-dimensional invoice index provides O(1) lookups
- [ ] Weighted confidence scoring correctly categorises matches into high/medium/low
- [ ] OpenAPI types are generated and provide full type safety
- [ ] Tests cover all matching edge cases (GST rounding, truncated descriptions, BPAY references)
