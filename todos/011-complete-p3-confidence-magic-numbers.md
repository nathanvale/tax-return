---
status: complete
priority: p3
issue_id: "011"
tags: [code-review, quality, typescript]
dependencies: []
---

# Confidence scoring uses undocumented magic numbers

## Problem Statement

`calculateConfidence()` has business logic baked into numeric literals (40, 25, 30, 20, 10, 5, 3, 7) with no explanation of why these specific weights were chosen. When revisiting in 3 months, the rationale will be lost.

## Findings

- TypeScript Reviewer: "Magic numbers everywhere"
- Suggested `as const satisfies Record<string, number>` pattern for weight constants
- Also missing: JSDoc explaining the scoring rationale
- `CandidateMatch` type not shown -- `contactSimilarity` range should be validated

## Proposed Solutions

### Option 1: Extract weights to named constant + add JSDoc

**Approach:**

```typescript
const CONFIDENCE_WEIGHTS = {
  amountExact: 40,
  amountTolerance: 25,
  contactSimilarity: 30,
  referenceFound: 20,
  dateClose: 10,
  dateNearby: 5,
} as const satisfies Record<string, number>
```

**Pros:**
- Self-documenting
- Easy to tune later

**Cons:**
- None

**Effort:** 15 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/matcher.ts` -- `calculateConfidence()`

## Acceptance Criteria

- [ ] Weights extracted to named constant
- [ ] JSDoc on `calculateConfidence()` explaining the scoring rationale
- [ ] `CandidateMatch` type defines `contactSimilarity` range (0-100)

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (TypeScript Reviewer)

**Actions:**
- Identified 8 magic numbers in confidence scoring
- Proposed `as const satisfies` pattern
