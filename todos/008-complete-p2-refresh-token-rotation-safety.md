---
status: complete
priority: p2
issue_id: "008"
tags: [code-review, security]
dependencies: ["001"]
---

# Refresh token rotation can lose tokens on crash

## Problem Statement

Xero uses single-use refresh tokens -- each refresh invalidates the old token. If the app crashes after Xero issues new tokens but before saving them, the user must re-authenticate. The plan identifies this risk but does not specify the mitigation order.

## Findings

- Security Sentinel: "Save refresh token FIRST -- it's the more critical credential"
- The old refresh token is invalidated the moment Xero processes the refresh request
- A crash between "receive new tokens" and "save to Keychain" means both old and new refresh tokens are lost

## Proposed Solutions

### Option 1: Save refresh token first, keep previous as backup

**Approach:** Two-phase save: save new refresh token immediately, then access token. Keep previous refresh token until new one is confirmed working.

```typescript
async function doRefresh(): Promise<void> {
  const response = await fetchNewTokens(currentRefreshToken)
  // Save previous as backup
  await saveToKeychain('refresh_token_prev', currentRefreshToken)
  // Save new refresh token FIRST
  await saveToKeychain('refresh_token', response.refreshToken)
  // Then save access token
  await saveToKeychain('access_token', response.accessToken)
  await saveToKeychain('expires_at', String(response.expiresAt))
}
```

On `invalid_grant`: try `refresh_token_prev` before requiring re-auth.

**Pros:**
- Minimises window for token loss
- Previous token as fallback

**Cons:**
- Extra Keychain write per refresh

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/auth.ts` -- `doRefresh()` save order

## Acceptance Criteria

- [ ] Refresh token is saved before access token during rotation
- [ ] Previous refresh token kept as backup
- [ ] `invalid_grant` handler tries backup before requiring re-auth

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Security Sentinel)

**Actions:**
- Identified token loss window during rotation
- Proposed save-refresh-first + backup pattern
