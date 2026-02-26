---
status: pending
priority: p2
issue_id: "051"
tags: [code-review, quality]
dependencies: ["047"]
---

# Extract CLI Parser Flag Helper (~100 LOC Savings)

## Problem Statement

The 895-line CLI parser repeats ~14 lines of boilerplate for each value-taking flag (`--flag value` / `--flag=value` dual pattern). There are 10 such flags, producing ~140 lines of near-identical code.

## Findings

- **Source:** TypeScript Reviewer, Code Simplicity Reviewer
- **File:** `src/cli/command.ts` (lines 155-405)

## Proposed Solutions

### Option A: `parseValueFlag` helper
```typescript
function parseValueFlag(token, flag, args, i): { value; skip } | { error } | null
```
Each flag becomes 1-2 lines instead of 14.
- Pros: ~100 LOC savings, easier to add new flags
- Cons: Slight indirection
- Effort: Small
- Risk: Low

## Acceptance Criteria

- [ ] All existing CLI tests pass
- [ ] Adding a new value flag requires <5 lines of code

## Work Log

| Date | Action | Learnings |
|------|--------|-----------|
| 2026-02-27 | Created from code review | TypeScript Reviewer + Simplicity Reviewer |
