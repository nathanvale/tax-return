---
status: complete
priority: p1
issue_id: "003"
tags: [code-review, security]
dependencies: []
---

# OAuth state parameter storage and validation not specified

## Problem Statement

The plan mentions using a cryptographically random `state` parameter to prevent CSRF, but does not specify where the state is stored or how it is validated in the callback handler. Without explicit single-use, in-memory state validation, the auth flow is vulnerable to forged callbacks.

## Findings

- Security Sentinel rated this HIGH severity
- State must be stored in-memory only (not on disk)
- State must be single-use (consumed after first validation)
- The plan's code snippets show `getAuthorizationUrl(codeChallenge, state)` but no callback handler validation code

## Proposed Solutions

### Option 1: In-memory closure-scoped state

**Approach:** Store the expected state in a closure variable within the callback server. Validate and consume on first callback.

```typescript
let expectedState: string | null = crypto.randomUUID()

// In callback handler:
if (url.searchParams.get('state') !== expectedState) {
  return new Response('Invalid state parameter', { status: 403 })
}
expectedState = null  // consumed -- reject any subsequent callbacks
```

**Pros:**
- Simple, correct, no persistence needed
- Single-use by design

**Cons:**
- Lost if process crashes before callback (user re-starts auth)

**Effort:** 15 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `scripts/xero-auth-server.ts` -- callback handler
- `src/xero/auth.ts` -- state generation

## Acceptance Criteria

- [ ] State parameter is generated per-session with `crypto.randomUUID()` or `crypto.getRandomValues()`
- [ ] State is stored in-memory only
- [ ] Callback handler validates state and rejects mismatches with 403
- [ ] State is consumed after first use (single-use)
- [ ] Callback handler only accepts requests to `/callback` path

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Security Sentinel)

**Actions:**
- Identified missing state validation specification
- Proposed in-memory closure pattern
