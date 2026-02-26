---
status: done
priority: p2
issue_id: "028"
tags: [security, auth, networking]
dependencies: []
---

# Change callback port from 3000 and handle port conflicts

## Problem Statement

The callback server binds to port 3000, which is extremely common (React dev servers, Rails, etc.). This will frequently conflict with other local processes. Need to use a less common port AND hard-fail with a clear message if the port is occupied.

## Findings

- Plan binds `127.0.0.1:3000` with no fallback
- Port 3000 is one of the most commonly used dev ports
- Xero OAuth requires the redirect URI to match exactly what's registered in the app
- Need to pick an uncommon port and register it with Xero
- Previous todo 002 addressed port squatting but kept port 3000
- Need to bind BEFORE opening browser (not after)

**Source:** Security Engineer review (Pass 3) + Nathan's triage decision

## Recommended Action

1. Change port from 3000 to something uncommon (e.g., 5555, 8477, or similar)
2. Update Xero app redirect URI to match: `http://127.0.0.1:<new-port>/callback`
3. Bind server before opening browser
4. Hard-fail with clear message if port is occupied

## Acceptance Criteria

- [x] Callback port changed from 3000 to port 5555
- [x] Xero app redirect URI updated to match (`http://127.0.0.1:5555/callback`)
- [x] Server binds port before opening browser (documented in Security section)
- [x] Clear error message if port is occupied (documented in Security section)
- [x] Plan code examples updated with new port

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 3, Important #2)

### 2026-02-26 - Triage Update

**By:** Nathan (triage)
**Actions:** Changed scope -- port 3000 is too common, pick a different port entirely

### 2026-02-26 - Resolved

**By:** Claude Code
**Actions:** Updated MVP plan to use port 5555 everywhere:
- Project structure comment (`scripts/xero-auth-server.ts`)
- Phase 1 files description (`Bun.serve()` bind address)
- `redirect_uri` in `getAuthorizationUrl()` code example
- Pre-implementation checklist (Xero app registration instructions)
- Security section: updated bind address bullet, added new bullet for bind-before-browser with fail-fast behavior
- Superseded plan: top-level note does not reference port 3000, no changes needed
