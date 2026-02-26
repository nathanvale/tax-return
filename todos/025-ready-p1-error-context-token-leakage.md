---
status: done
priority: p1
issue_id: "025"
tags: [security, logging, errors]
dependencies: []
---

# Prevent token leakage via StructuredError context field

## Problem Statement

The plan extends `StructuredError` from `@side-quest/core/errors` which includes a `context` field. If an error occurs during token exchange or API calls, the context field could accidentally include OAuth codes, verifiers, or tokens. Bun's default error serialization and `console.error` could also expose secrets in stack traces or error properties.

## Findings

- Plan uses `StructuredError` with `context` field (line 277)
- Token exchange errors could include code/verifier in context
- API errors could include Authorization header in request details
- Bun's default `console.error(error)` serializes all enumerable properties
- Plan logging policy says "NEVER log tokens" but doesn't specify enforcement mechanism
- No allowlist-based sanitizer mentioned in the plan

**Source:** Security Engineer review (Pass 3)

## Proposed Solutions

### Option 1: Allowlist-based error sanitizer (recommended)

**Approach:** Create a `sanitizeError()` function that strips sensitive fields before any error is logged. Only allow known-safe fields: `message`, `name`, `status`, `retryAfter`, `transactionId`. Apply to all `catch` blocks and error handlers.

**Pros:**
- Prevents accidental leaks from any error source
- Allowlist is safer than denylist (new fields are hidden by default)

**Cons:**
- Need to apply consistently everywhere
- May hide useful debugging info

**Effort:** 1 hour

**Risk:** Low

### Option 2: Never pass secrets into error context

**Approach:** Discipline at the call site: never include request bodies, headers, or tokens in error constructor context. Only pass transaction IDs, amounts, and status codes.

**Pros:**
- Simpler, no sanitizer needed
- Addresses root cause

**Cons:**
- Relies on developer discipline
- Easy to forget when debugging

**Effort:** 30 minutes (document convention)

**Risk:** Medium (human error)

## Recommended Action

Option 2 implemented: documented error context sanitization convention directly in the MVP plan's Security section with BAD/GOOD code examples. The convention explicitly lists safe fields (`message`, `status`, `transactionId`, `amount`) and forbids request bodies, headers, tokens, codes, and verifiers.

## Acceptance Criteria

- [x] Error context fields never contain tokens, codes, or verifiers
- [x] Enforcement mechanism documented (sanitizer or convention)
- [ ] Bun's default error serialization verified safe

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Security reviewer identified error context as token leakage vector
- Filed from Security Engineer review (Pass 3, Critical #5)

**Learnings:**
- StructuredError's flexible context field is a double-edged sword for security

### 2026-02-26 - Resolved via convention in MVP plan

**By:** Claude Code

**Actions:**
- Added "Error context sanitization" bullet to Security section of MVP plan
- Included BAD/GOOD code examples showing what to pass (and not pass) into error context
- Updated logging policy section with the sanitization rule as a companion to the existing "NEVER log tokens" policy
- Chose Option 2 (convention-based) -- simpler, addresses root cause, and the MVP is a single-developer project

**Learnings:**
- Embedding the convention directly next to the logging policy makes it hard to miss during implementation
- The BAD/GOOD pattern makes the rule immediately actionable without needing to read prose
