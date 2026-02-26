---
status: complete
priority: p2
issue_id: "009"
tags: [code-review, performance]
dependencies: []
---

# Batch payment fallback retries entire batch individually (N+1 pattern)

## Problem Statement

When a batch of 50 payments fails, the fallback retries all 50 individually instead of identifying which specific payments failed. This is an N+1 pattern that can 50x the API call count on partial failures, risking the daily rate limit.

## Findings

- Performance Oracle: "a run creating 500 payments would go from 10 batch calls to potentially 260 calls"
- Xero batch API returns per-item success/failure via `HasErrors` on each payment in the response
- Only a total request failure (network error, 500) should trigger the individual fallback
- Per-item validation errors are already handled in the success path

## Proposed Solutions

### Option 1: Parse batch errors, retry only failures

**Approach:** On batch error, distinguish between total request failure (retry all individually) and partial validation failure (already handled). For network/server errors, the batch may have partially succeeded server-side -- check idempotency before retrying.

**Pros:**
- Drastically reduces fallback API calls
- Respects rate limits

**Cons:**
- Slightly more complex error parsing

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/api.ts` -- `createPaymentsBatched()` catch block

## Acceptance Criteria

- [ ] Per-item validation errors handled in success path (already designed)
- [ ] Total request failure only retries items not in state file
- [ ] API call count stays within rate limits for typical failure scenarios

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Performance Oracle)

**Actions:**
- Identified N+1 fallback pattern
- Noted per-item errors are already handled in success path
