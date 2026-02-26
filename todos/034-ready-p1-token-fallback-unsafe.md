---
status: ready
priority: p1
issue_id: "034"
tags: [security, tokens, keychain]
dependencies: []
---

# Remove silent file-based token fallback

## Problem Statement

The plan says "If Keychain denied, fall back to file-based tokens with chmod 600." This is a silent security downgrade -- file-based tokens (even with 600 perms) are significantly weaker than Keychain (no encryption at rest, no lock-on-sleep, no ACL).

## Findings

- Security Engineer review (Pass 2, Critical #2)
- Silent downgrade means user may not know they're running in degraded security mode
- For a financial API tool, this is unacceptable as a default

**Source:** Security Engineer review (Pass 2)

## Proposed Solutions

### Option 1: Hard-fail if Keychain unavailable (recommended)

**Approach:** If Keychain access is denied, fail with clear error message explaining how to grant Terminal Keychain access. No fallback. Keep it simple.

**Effort:** 10 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] No file-based token fallback exists in code
- [ ] Clear error message when Keychain access denied with fix instructions
- [ ] Plan updated to remove fallback mention

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 2, Critical #2)
