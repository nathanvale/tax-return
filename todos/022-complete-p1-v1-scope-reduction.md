---
status: complete
priority: p1
issue_id: "022"
tags: [scope, yagni, planning]
dependencies: []
completed: 2026-02-26
---

# Split plan into MVP + future feature plans

## Problem Statement

The current plan is a single 750-line document covering everything from auth to browser automation. It needs to be split into separate plans:

1. **MVP plan** -- Auth + Reconciliation only (the only thing Nathan cares about for v1)
2. **Future plan: Browser Automation** -- Phase 3 browser-driven reconciliation via agent-browser
3. **Future plan: Advanced Matching** -- Token Set Ratio, AU bank description parser, multi-dimensional index, weighted confidence scoring

## Findings

- Current scope: 8 TS modules + 4 commands + 5 test files + 2 scripts + configs = ~25 files
- Nathan confirmed: MVP is auth + reconciliation only
- Browser automation, advanced matching, OpenAPI type generation are all post-MVP
- Simpler matching (exact amount + contact substring + manual queue) hits 60-80% of transactions
- CSV export handles the rest for MVP

**Source:** Skeptic review (Pass 2) + Nathan's triage decision

## Recommended Action

Split the current plan into 3 documents:

### Plan 1: MVP (auth + reconcile)
`docs/plans/2026-02-26-feat-xero-reconciliation-mvp-plan.md`
- Auth (PKCE + Keychain)
- Fetch unreconciled transactions
- Simple matching (exact amount + contact substring)
- Create payments (batched)
- CSV export for unmatched
- State file for idempotency
- 1 command (`xero-reconcile`) with `--auth`, `--dry-run`, `--execute`, `--export` flags
- ~12 files total
- Ship in 1-2 days

### Plan 2: Browser Automation (future)
`docs/plans/2026-02-26-feat-xero-browser-reconciliation-plan.md`
- agent-browser headed mode
- Session persistence
- Dashboard navigation
- Snapshot-then-act pattern
- All Phase 3 content from current plan

### Plan 3: Advanced Matching (future)
`docs/plans/2026-02-26-feat-xero-advanced-matching-plan.md`
- Token Set Ratio algorithm
- Australian bank description parser (5 regex patterns)
- Multi-dimensional invoice index
- Weighted confidence scoring
- OpenAPI type generation (openapi-typescript + openapi-fetch)

## Acceptance Criteria

- [x] MVP plan exists as standalone document with everything needed to ship
- [x] Browser automation extracted to separate future plan
- [x] Advanced matching extracted to separate future plan
- [x] Original plan archived or replaced
- [x] MVP achievable within 1-2 days of starting implementation

## Work Log

### 2026-02-26 - Filed from Codex Review + Triage

**By:** Claude Code

**Actions:**
- Skeptic review challenged scope across all dimensions
- Nathan confirmed during triage: "all I care about for MVP is auth and reconciliation"
- Nathan requested splitting into MVP + separate future feature plans

**Learnings:**
- 3 rounds of "deepening" and 15 review findings added net complexity to the plan
- Plan accretion is a real risk -- each enhancement round adds but rarely subtracts
- Splitting into separate plans keeps focus and lets future features be evaluated independently
