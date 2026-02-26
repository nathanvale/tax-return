---
status: ready
priority: p1
issue_id: "033"
tags: [security, keychain, tokens]
dependencies: []
---

# Fix token leakage via security CLI process arguments

## Problem Statement

`security add-generic-password -w <json>` passes the full token JSON blob as a command-line argument. Command-line arguments are visible to all local processes via `ps aux`, briefly exposing access tokens, refresh tokens, and previous refresh tokens in the process list.

## Findings

- Security Engineer review (Pass 2, Critical #1)
- `Bun.spawn(['security', ..., '-w', json])` makes tokens visible in process listing
- Even brief exposure is a security concern for financial API credentials

**Source:** Security Engineer review (Pass 2)

## Proposed Solutions

### Option 1: Pipe tokens via stdin (recommended)

**Approach:** Use `security add-generic-password -w` without the value argument -- it reads from stdin. Pipe the JSON via `proc.stdin.write()`. No argv exposure.

```typescript
const proc = Bun.spawn(['security', 'add-generic-password',
  '-s', KEYCHAIN_SERVICE, '-a', KEYCHAIN_ACCOUNT, '-U', '-w'], {
  stdin: 'pipe',
})
proc.stdin.write(json)
proc.stdin.end()
await proc.exited
```

**Effort:** 15 minutes | **Risk:** Low (needs testing that security CLI reads -w from stdin correctly)

## Acceptance Criteria

- [ ] Tokens never appear in process arguments (verify with `ps aux`)
- [ ] Tokens piped via stdin to security CLI
- [ ] Save and load both work correctly with stdin approach

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 2, Critical #1)
