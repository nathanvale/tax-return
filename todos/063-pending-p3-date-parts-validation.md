---
status: pending
priority: p3
issue_id: "063"
tags: [code-review, validation, coderabbit]
dependencies: []
---

# parseDateParts Doesn't Validate Calendar Ranges

## Problem Statement

`parseDateParts` in `src/cli/commands/transactions.ts` splits a date string and converts to year/month/day integers but doesn't verify they form a valid calendar date. Invalid inputs like `2026-13-45` would pass through and produce an invalid OData DateTime clause.

## Findings

- CodeRabbit flagged lines 136-140 in `src/cli/commands/transactions.ts`
- Function splits date string and returns `DateTime(year,month,day)` format
- No range checks: month 1-12, day valid for month/year
- Invalid dates would create malformed Xero API queries
- Similar pattern exists in `src/cli/commands/history.ts:219-222` (options.since) - covered by todo 048

## Proposed Solutions

### Option 1: Add range validation

**Approach:** After parsing, verify month is 1-12 and day is valid for that month/year. Construct a `Date` object and confirm components match (catches Feb 30, etc.). Throw descriptive error on invalid input.

**Pros:**
- Minimal change
- Clear error messages for users

**Cons:**
- None significant

**Effort:** 30 min

**Risk:** Low

## Recommended Action

To be filled during triage.

## Technical Details

**Affected files:**
- `src/cli/commands/transactions.ts:136-140` - parseDateParts function
- `src/cli/commands/history.ts:219-222` - similar pattern (see todo 048)

## Acceptance Criteria

- [ ] Invalid months (0, 13) throw descriptive error
- [ ] Invalid days (Feb 30, Apr 31) throw descriptive error
- [ ] Valid dates pass through unchanged
- [ ] Unit tests cover boundary cases

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Claude Code (CodeRabbit review)

**Actions:**
- CodeRabbit flagged missing date range validation
- Confirmed no validation exists beyond basic split/parseInt

**Learnings:**
- Date validation is a common miss - construct Date and verify roundtrip
