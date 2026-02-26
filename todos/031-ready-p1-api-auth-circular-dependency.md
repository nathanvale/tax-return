---
status: ready
priority: p1
issue_id: "031"
tags: [architecture, testing, api]
dependencies: []
---

# Break api.ts/auth.ts circular dependency and decouple xeroFetch()

## Problem Statement

`xeroFetch()` in api.ts calls `ensureFreshToken()` from auth.ts, but auth.ts needs to make HTTP calls for token refresh (which could use api.ts). This creates a circular dependency. Additionally, baking auth + retry + error mapping into one wrapper makes every API test integration-heavy.

## Findings

- Architect review (Pass 1, Critical #1 and #2)
- `xeroFetch()` couples auth, retry, and error handling -- tests can't exercise API calls without dealing with Keychain/token refresh
- Token refresh in auth.ts needs raw HTTP but importing from api.ts creates a cycle

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Introduce http.ts for raw transport (recommended)

**Approach:** Create `src/xero/http.ts` with a raw `transportFetch(url, token, options)` function. auth.ts uses this for token refresh. api.ts uses auth's token provider + http.ts transport. No cycle.

**Effort:** 30 minutes | **Risk:** Low

### Option 2: Token provider interface injection

**Approach:** `xeroFetch()` accepts a `getToken: () => Promise<string>` parameter. Tests inject a mock. Auth module provides the real implementation.

**Effort:** 20 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] No circular import between api.ts and auth.ts
- [ ] API functions are testable with mock tokens (no Keychain in unit tests)
- [ ] Token refresh uses raw transport, not xeroFetch()

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Architect review (Pass 1, Critical #1 + #2)
