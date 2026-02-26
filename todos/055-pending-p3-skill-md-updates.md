---
status: pending
priority: p3
issue_id: "055"
tags: [code-review, documentation]
dependencies: ["046"]
---

# SKILL.md Documentation Gaps

## Problem Statement

Several CLI capabilities are not documented in the agent skill runbook.

## Findings

- **Source:** Agent-Native Reviewer
- **Items:**
  - Invoices command defaults to `Status=="AUTHORISED"` -- not documented
  - `--page` and `--limit` for transactions not mentioned
  - Auth command requires human interaction (browser OAuth) -- should note explicitly
  - Auth should emit structured `authUrl` in JSON mode for agent consumption

## Acceptance Criteria

- [ ] SKILL.md documents invoices default filter
- [ ] SKILL.md documents --page/--limit for transactions
- [ ] SKILL.md notes auth requires human-in-the-loop
- [ ] Auth command emits authUrl as structured JSON data

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | Agent-Native Reviewer |
