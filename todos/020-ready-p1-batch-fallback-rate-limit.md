---
status: done
priority: p1
issue_id: "020"
tags: [api, rate-limiting, resilience]
dependencies: []
---

# Batch fallback must be rate-aware to prevent self-DDOS

## Problem Statement

When a batch POST of 50 payments fails, the fallback creates 50 individual API calls. With Xero's 60 req/min limit, this immediately exceeds the rate limit, cascading into retries and more 429 errors. The batch fallback and rate limiting strategies are not composed.

## Findings

- Batch fallback code at plan lines 556-567
- Xero rate limit: 60 calls/min, 5 concurrent
- Failed batch of 50 -> 50 individual calls -> instant rate limit breach
- `retry()` from `@side-quest/core` handles individual 429s but doesn't coordinate across the batch
- The fallback catch block retries ALL items individually regardless of error type

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Classify errors before fallback (recommended)

**Approach:** Only fall back to individual creation for validation errors (400/422). For rate limit (429) or server errors (500/503), retry the batch itself. Cap individual fallback to 10 items per minute.

**Pros:**
- Prevents rate limit cascade
- Handles each error type appropriately

**Cons:**
- Slightly more complex error classification

**Effort:** 1 hour

**Risk:** Low

### Option 2: Stagger individual fallback with delays

**Approach:** On batch failure, fall back to individual but with 1-second delays between calls.

**Pros:**
- Simple to implement
- Stays under rate limit

**Cons:**
- 50 items at 1/sec = 50 seconds, slow
- Doesn't distinguish error types

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

Option 1 implemented. See updated batch payment creation code in the MVP plan.

## Acceptance Criteria

- [x] Batch fallback classifies error type (rate limit vs validation vs server)
- [x] Rate limit errors retry the batch, not individual items
- [x] Individual fallback respects 60 req/min limit
- [x] Plan code example updated

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Identified interaction between batch fallback and rate limiting
- Filed from Architect review (Pass 1, Critical #5)

**Learnings:**
- Error handling strategies must compose -- can't design batch fallback and rate limiting independently

### 2026-02-26 - Resolved

**By:** Claude Code

**Actions:**
- Added `isRetryableError()` classifier to distinguish 429/500/503 (retryable) from 400/validation (fallback)
- Wrapped batch POST in `retry()` with `shouldRetry: isRetryableError` for automatic retries on transient errors
- Added `RATE_LIMIT_DELAY_MS = 1100` throttle on individual fallback calls (~55 req/min)
- If retryable errors exhaust all retry attempts, batch items are marked failed (no individual fallback cascade)
- Updated rate limiting description to reflect the composed strategy

**Learnings:**
- Composing retry and fallback is straightforward when error classification is the first decision point in the catch block
