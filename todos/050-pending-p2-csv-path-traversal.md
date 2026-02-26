---
status: pending
priority: p2
issue_id: "050"
tags: [code-review, security]
dependencies: []
---

# CSV Path Traversal in --from-csv Flag

## Problem Statement

The `loadCsv()` function accepts any file path from `--from-csv` without restriction. In the agent-native context, a compromised agent could pass `--from-csv /etc/passwd` to read arbitrary files. Content would fail CSV parsing but error messages might leak partial file contents.

## Findings

- **Source:** Security Sentinel (MEDIUM-2)
- **File:** `src/cli/commands/reconcile.ts` (line 356)
- **Impact:** Low for local-only CLI (user has filesystem access), but relevant for agent-native context

## Proposed Solutions

### Option A: Path boundary check
- `path.resolve(pathname).startsWith(process.cwd())` + require `.csv` extension
- Pros: Simple, effective
- Cons: May need `--allow-absolute-path` escape hatch
- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] `--from-csv /etc/passwd` returns a validation error
- [ ] `--from-csv ../../../etc/passwd` returns a validation error
- [ ] `--from-csv ./data.csv` works as expected

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | Security Sentinel MEDIUM-2 |
