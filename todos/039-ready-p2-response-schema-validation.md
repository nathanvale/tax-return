---
status: ready
priority: p2
issue_id: "039"
tags: [security, api, validation]
dependencies: []
---

# Add runtime schema validation for API responses before state mutation

## Problem Statement

The plan trusts Xero API responses implicitly (parsing JSON, using fields directly). Malformed or unexpected responses could cause state file corruption or incorrect payment recording.

## Findings

- Security Engineer review (Pass 2, Important)
- No validation that PaymentID in response corresponds to the request
- No validation of required fields before writing to state
- Batch responses need per-item field verification

**Source:** Security Engineer review (Pass 2)

## Proposed Solutions

### Option 1: Lightweight runtime type guards (recommended)

**Approach:** Add type guard functions that validate required fields before state mutation. Not a full schema validation library -- just check that PaymentID, InvoiceID, Amount exist and are correct types before writing to state.

**Effort:** 30 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] Payment responses validated before writing to state (PaymentID exists and is string)
- [ ] Batch response PaymentID/amount verified against request
- [ ] Malformed response throws clear error instead of corrupting state

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 2, Important)
