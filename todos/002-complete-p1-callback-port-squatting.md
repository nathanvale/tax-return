---
status: complete
priority: p1
issue_id: "002"
tags: [code-review, security]
dependencies: []
---

# OAuth callback server uses fixed port 3000 (port squatting risk)

## Problem Statement

The auth callback server binds to a fixed port (`127.0.0.1:3000`). A malicious local process could bind to this port before the callback server starts and intercept the authorization code. While PKCE mitigates code exchange (attacker needs the code_verifier), a fixed port is still a security anti-pattern for OAuth callback servers.

## Findings

- Security Sentinel rated this HIGH severity
- RFC 8252 recommends ephemeral ports for native app OAuth flows
- Port 3000 is commonly used by dev servers, increasing collision risk
- PKCE code_verifier provides defence-in-depth, but the port squatting is still a vector

## Proposed Solutions

### Option 1: Use ephemeral port (bind to port 0)

**Approach:** Let the OS assign an available port. Requires Xero app to support dynamic redirect URIs or use a fixed localhost URI with a custom scheme.

```typescript
const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: handleCallback })
const redirectUri = `http://127.0.0.1:${server.port}/callback`
```

**Pros:**
- Eliminates port squatting entirely
- Standard practice per RFC 8252

**Cons:**
- Xero may require a fixed redirect URI registered in the developer portal
- Need to verify Xero's redirect URI matching rules

**Effort:** 30 minutes

**Risk:** Low (if Xero supports it)

---

### Option 2: Keep port 3000 but add port-availability check

**Approach:** Before starting auth flow, verify port 3000 is available. If not, warn user.

**Pros:**
- Simple, works with fixed redirect URI registration

**Cons:**
- TOCTOU race between check and bind
- Does not eliminate the underlying risk

**Effort:** 15 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `scripts/xero-auth-server.ts` -- Bun.serve port binding
- `src/xero/auth.ts` -- redirect_uri construction

## Acceptance Criteria

- [ ] Callback server does not use a predictable fixed port OR risk is documented as accepted
- [ ] Auth flow succeeds when port is changed

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Security Sentinel)

**Actions:**
- Identified fixed port 3000 as a port-squatting risk
- Recommended ephemeral port per RFC 8252
- Need to verify Xero's redirect URI registration rules before deciding
