---
status: ready
priority: p1
issue_id: "035"
tags: [security, auth, oauth]
dependencies: []
---

# Harden OAuth callback: one-time binding + code validation

## Problem Statement

The callback server validates the `state` parameter but has no protections against: duplicate callbacks, code injection, or race conditions. A local attacker who can observe the state could attempt to inject a malicious authorization code.

## Findings

- Security Engineer review (Pass 2, Critical #3 + #4)
- State validation alone is not sufficient operationally
- No validation of code parameter shape/presence before exchange
- Server should close immediately after first valid callback

**Source:** Security Engineer review (Pass 2)

## Proposed Solutions

### Option 1: One-shot callback with code validation (recommended)

**Approach:**
1. Mark state as consumed after first valid callback (reject duplicates)
2. Validate code parameter is present and non-empty before exchange
3. Close server immediately after first valid callback via `queueMicrotask(() => server.stop())`
4. Reject any subsequent requests with 400

**Effort:** 20 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] State is single-use -- second callback with same state is rejected
- [ ] Code parameter validated for presence before exchange
- [ ] Server stops after first valid callback
- [ ] Any request after valid callback gets 400

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 2, Critical #3 + #4)
