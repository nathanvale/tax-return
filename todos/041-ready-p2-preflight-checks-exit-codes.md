---
status: ready
priority: p2
issue_id: "041"
tags: [ux, cli, error-handling]
dependencies: []
---

# Add preflight checks before execute and define exit codes

## Problem Statement

No preflight validation before --execute mode. If tokens are expired, tenant unreachable, or state path unwritable, the user discovers this mid-run. Exit codes are undefined, making failures unscriptable.

## Findings

- Operator review (Pass 3, Important)
- No pre-check for: token validity, tenant reachability, writable paths, lock collision
- No defined exit codes for different failure modes

**Source:** Operator review (Pass 3)

## Proposed Solutions

### Option 1: Preflight check function + exit codes (recommended)

**Approach:**
- Before execute: validate tokens, test API connectivity (GET /Organisation), check state path writable
- Exit codes: 0 = success, 1 = partial success, 2 = auth failure, 3 = config error
- Fail fast with actionable error if any preflight check fails

**Effort:** 30 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] Preflight checks run before --execute mode
- [ ] Clear error message if tokens expired, tenant unreachable, or paths unwritable
- [ ] Exit codes documented and consistent

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Operator review (Pass 3, Important)
