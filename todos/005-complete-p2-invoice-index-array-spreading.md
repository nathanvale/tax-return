---
status: complete
priority: p2
issue_id: "005"
tags: [code-review, performance]
dependencies: []
---

# Invoice index uses O(n^2) array spreading instead of push

## Problem Statement

`buildInvoiceIndex()` creates a new array on every insertion via spread syntax: `[...(existing ?? []), inv]`. For invoices sharing common amounts (e.g., subscription billing), this is O(k^2) per bucket where k is the bucket size. Both the Performance Oracle and TypeScript Reviewer flagged this independently.

## Findings

- Performance Oracle: "An org with 10,000 invoices where 500 share a common amount would perform ~125,000 unnecessary array copy operations just for that one bucket"
- TypeScript Reviewer: "creates a new array on every single invoice"
- Also flagged: `byReference` silently overwrites duplicate invoice numbers (last-write-wins)

## Proposed Solutions

### Option 1: Mutate in-place with push + helper

**Approach:** Use `push()` for O(1) amortised insertion. Extract `appendToMap` helper.

```typescript
function appendToMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key)
  if (existing) { existing.push(value) } else { map.set(key, [value]) }
}
```

**Pros:**
- O(n) total instead of O(n * k)
- Reduces duplication across 3 map insertions

**Cons:**
- None

**Effort:** 15 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/matcher.ts` -- `buildInvoiceIndex()`

## Acceptance Criteria

- [ ] No array spreading in `buildInvoiceIndex()`
- [ ] Uses `push()` or `appendToMap` helper
- [ ] `byReference` either uses `appendToMap` (handles duplicates) or documents last-write-wins

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Performance Oracle + TypeScript Reviewer)

**Actions:**
- Identified O(n^2) array spreading pattern
- Proposed push-based fix with helper
