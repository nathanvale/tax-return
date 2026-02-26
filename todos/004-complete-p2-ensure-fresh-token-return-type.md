---
status: complete
priority: p2
issue_id: "004"
tags: [code-review, typescript, architecture]
dependencies: ["001"]
---

# ensureFreshToken returns void but callers expect a token string

## Problem Statement

The `ensureFreshToken()` function returns `Promise<void>`, but in `xeroFetch()` it is called as `const token = await ensureFreshToken()` -- which would always be `undefined`. The token is then used in the Authorization header, resulting in `Bearer undefined`.

Additionally, on 401 responses the function throws immediately instead of attempting a refresh-then-retry, which means clock skew between local machine and Xero servers causes unnecessary re-auth prompts.

## Findings

- Security Sentinel and TypeScript Reviewer both flagged this
- The mutex pattern is correct for single-threaded Bun, but the return type is wrong
- 401 handling should attempt one refresh-then-retry before throwing

## Proposed Solutions

### Option 1: Return the access token from ensureFreshToken

**Approach:** Change return type to `Promise<string>` and return the stored access token after any refresh.

```typescript
async function ensureFreshToken(): Promise<string> {
  if (!isNearExpiry(5 * 60 * 1000)) return getStoredAccessToken()
  if (refreshPromise) { await refreshPromise; return getStoredAccessToken() }
  refreshPromise = doRefresh()
  try { await refreshPromise }
  finally { refreshPromise = null }
  return getStoredAccessToken()
}
```

Also add 401 retry-with-refresh in xeroFetch:

```typescript
if (response.status === 401) {
  await forceTokenRefresh()
  const retry = await fetch(/* same request with new token */)
  if (retry.status === 401) throw new XeroAuthError('Re-auth needed')
  return retry
}
```

**Pros:**
- Fixes the type bug
- Handles clock skew gracefully

**Cons:**
- Slightly more complex xeroFetch

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/auth.ts` -- `ensureFreshToken()` return type
- `src/xero/api.ts` -- `xeroFetch()` 401 handling

## Acceptance Criteria

- [ ] `ensureFreshToken()` returns `Promise<string>` (the access token)
- [ ] `xeroFetch()` retries once with refreshed token on 401
- [ ] Tests verify the refresh-then-retry flow

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Security Sentinel + TypeScript Reviewer)

**Actions:**
- Identified void return type bug
- Identified missing 401 retry logic
- Proposed combined fix
