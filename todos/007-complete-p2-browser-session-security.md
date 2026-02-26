---
status: complete
priority: p2
issue_id: "007"
tags: [code-review, security]
dependencies: []
---

# Browser session profile stores unprotected Xero cookies on disk

## Problem Statement

`agent-browser --headed --profile ~/.xero-session` stores Xero session cookies in a browser profile directory. These cookies provide full authenticated access to the Xero web UI. The plan does not specify file permissions, encryption verification, or backup exclusion.

## Findings

- Security Sentinel rated this HIGH
- Browser profile directories store cookies in SQLite (Chromium encrypts via Keychain, but agent-browser's engine is unverified)
- No file permissions specified (defaults to umask, often 644 = world-readable)
- Time Machine will capture this directory
- A stolen cookie file provides persistent Xero web UI access

## Proposed Solutions

### Option 1: Permissions + backup exclusion + documentation

**Approach:** Set restrictive permissions, exclude from backups, document the risk.

```bash
chmod 700 ~/.xero-session
tmutil addexclusion ~/.xero-session
```

**Pros:**
- Simple, addresses the immediate risks
- No additional dependencies

**Cons:**
- Does not verify cookie encryption at rest

**Effort:** 15 minutes

**Risk:** Low

---

### Option 2: Clear session after each run

**Approach:** Delete `~/.xero-session` after each reconciliation run.

**Pros:**
- Eliminates persistent cookie risk

**Cons:**
- User must re-login every run
- Defeats the purpose of session persistence

**Effort:** 5 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `.claude/commands/xero-browse.md` -- add permission setting and cleanup
- `.gitignore` -- ensure ~/.xero-session path noted

## Acceptance Criteria

- [ ] `~/.xero-session` has 700 permissions
- [ ] Time Machine exclusion set
- [ ] Risk documented in plan

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Security Sentinel)

**Actions:**
- Identified unprotected browser session on disk
- Proposed permissions + backup exclusion
