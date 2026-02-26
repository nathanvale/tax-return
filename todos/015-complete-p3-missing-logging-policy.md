---
status: complete
priority: p3
issue_id: "015"
tags: [code-review, security]
dependencies: []
---

# No logging policy -- tokens could leak to console/logs

## Problem Statement

The plan does not specify what gets logged. Tokens, authorization codes, and code verifiers must NEVER be logged. Sensitive headers must be redacted in error logs.

## Findings

- Security Sentinel: "Ensure tokens, authorization codes, and code verifiers are NEVER logged"
- Also missing: token scope validation after exchange (Xero could return fewer scopes than requested)

## Proposed Solutions

### Option 1: Define logging policy in plan + implement redaction

**Approach:** Document what is safe to log (transaction IDs, amounts, counts) and what must never be logged (tokens, codes, verifiers). Add a `redactHeaders()` utility for error logs.

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/auth.ts` -- ensure no token logging
- `src/xero/api.ts` -- redact Authorization header in error logs
- `src/xero/errors.ts` -- error serialization must not include tokens

## Acceptance Criteria

- [ ] No tokens, codes, or verifiers in any log output
- [ ] Error logs redact Authorization headers
- [ ] Scope validation after token exchange

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Security Sentinel)
