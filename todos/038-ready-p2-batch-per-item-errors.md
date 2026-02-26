---
status: ready
priority: p2
issue_id: "038"
tags: [api, batch, error-handling]
dependencies: []
---

# Parse per-item errors from batch responses, skip deterministic failures

## Problem Statement

Batch fallback strategy falls back to individual API calls for ALL validation errors. For 50 items that all fail the same deterministic validation error, this means 55 seconds of sequential calls that will all fail identically. Wasteful and pathological.

## Findings

- Architect review (Pass 1, Critical #4)
- Xero batch POST returns 200 with per-item HasErrors/ValidationErrors
- Most validation failures are deterministic (wrong amount, missing field) -- retrying individually won't fix them

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Parse per-item, only retry ambiguous failures (recommended)

**Approach:** When batch returns 200, check each item's HasErrors. For items with validation errors, report and skip (don't retry). Only fall back to individual calls for items where the batch-level request failed (not per-item validation).

**Effort:** 20 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] Per-item validation errors parsed from batch response and reported
- [ ] Deterministic validation failures are not retried individually
- [ ] Individual fallback only for ambiguous/transient failures

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Architect review (Pass 1, Critical #4)
