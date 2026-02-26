---
status: complete
priority: p3
issue_id: "014"
tags: [code-review, architecture]
dependencies: []
---

# Missing xero-status command for inspecting reconciliation state

## Problem Statement

There is no command for "show me the current state" or "what happened last run." For a tool where you want to know "where did I leave off?", this is a high-value, low-cost addition.

## Findings

- Architecture Strategist: "Consider a xero-status.md command that reads .xero-reconcile-state.json and reports: last run time, how many transactions matched, how many pending, any errors"
- The state file already contains all needed data
- This is cheap to build and prevents users from reading raw JSON

## Proposed Solutions

### Option 1: Add xero-status.md Claude command

**Approach:** Thin command that reads state.ts and presents a summary table.

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `.claude/commands/xero-status.md` (new)
- `src/xero/state.ts` -- add `getStateSummary()` function

## Acceptance Criteria

- [ ] `/xero-status` shows last run date, transaction counts, error summary
- [ ] Works when no state file exists (first run)

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Architecture Strategist)
