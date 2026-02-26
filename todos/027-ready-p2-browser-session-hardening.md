---
status: done
priority: p2
issue_id: "027"
tags: [security, browser, session]
dependencies: []
---

# Harden browser session profile directory security

## Problem Statement

`~/.xero-session` stores Xero session cookies in plain text on disk. These cookies grant full access to the Xero account. The directory needs restricted permissions, Time Machine exclusion, and cloud sync exclusion.

## Findings

- `agent-browser --headed --profile ~/.xero-session` stores cookies as files
- Default permissions may allow other local processes to read cookies
- Time Machine and iCloud may back up the session directory
- Cookies are equivalent to authenticated access to the Xero account

**Source:** Security Engineer review (Pass 3)

## Proposed Solutions

### Option 1: Enforce permissions at startup

**Approach:** Before launching agent-browser, ensure `~/.xero-session` has `0700` permissions. Exclude from Time Machine via `tmutil addexclusion`. Consider using ephemeral profiles for each run (or on a timer).

**Effort:** 30 minutes | **Risk:** Low

## Acceptance Criteria

- [x] Directory permissions enforced at `0700` before use
- [x] Excluded from Time Machine backup
- [x] Plan documents session security requirements

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 3, Important #4)

### 2026-02-26 - Session Security section added to browser reconciliation plan

**By:** Claude Code
**Actions:** Added "Session Security" subsection under "Browser Session Hardening Notes" in the browser reconciliation plan. Documents all four requirements: 0700 dir perms enforcement, Time Machine exclusion via tmutil, iCloud sync exclusion, and ephemeral profile consideration. Added four corresponding acceptance criteria to the plan.
