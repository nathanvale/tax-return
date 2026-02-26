---
status: ready
priority: p2
issue_id: "040"
tags: [security, export, files]
dependencies: []
---

# Set restrictive perms on CSV/state files and define export conventions

## Problem Statement

CSV exports contain financial transaction data and state files contain transaction IDs. Neither has restrictive file permissions. Export filename convention, overwrite policy, and output directory are undefined.

## Findings

- Security Engineer review (Pass 2, Important) -- CSV/state need 0o600
- Operator review (Pass 3, Important) -- export conventions undefined
- No defined: output directory, filename pattern, overwrite behavior

**Source:** Security Engineer + Operator reviews

## Proposed Solutions

### Option 1: Restrictive perms + timestamped filenames (recommended)

**Approach:**
- State file: write with 0o600 permissions
- CSV exports: write to project root with timestamped name (`xero-unmatched-YYYY-MM-DD.csv`), 0o600 perms
- No overwrite -- append date/time suffix if file exists
- Add `.xero-unmatched-*.csv` to .gitignore

**Effort:** 20 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] State file written with 0o600 permissions
- [ ] CSV exports written with 0o600 permissions
- [ ] CSV filename includes timestamp
- [ ] No silent overwrite of existing exports
- [ ] CSV pattern added to .gitignore

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Security Engineer + Operator reviews
