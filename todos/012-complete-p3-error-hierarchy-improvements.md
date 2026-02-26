---
status: complete
priority: p3
issue_id: "012"
tags: [code-review, typescript, quality]
dependencies: []
---

# Error hierarchy missing name, cause, and readonly modifiers

## Problem Statement

The error class hierarchy is the right approach but missing TypeScript best practices: `this.name` should be set to the constructor name (for logs), `ErrorOptions` with `cause` should be accepted (for error chaining), and `retryAfter` should be `readonly`.

## Findings

- TypeScript Reviewer proposed improved pattern
- Without `this.name`, error logs show "Error" instead of "XeroRateLimitError"
- Without `cause`, original errors are lost when wrapping

## Proposed Solutions

### Option 1: Add name, cause, readonly

```typescript
class XeroError extends Error {
  constructor(message: string, public readonly statusCode?: number, options?: ErrorOptions) {
    super(message, options)
    this.name = this.constructor.name
  }
}
class XeroRateLimitError extends XeroError {
  constructor(message: string, public readonly retryAfter: number, options?: ErrorOptions) {
    super(message, 429, options)
  }
}
```

**Effort:** 15 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/errors.ts`

## Acceptance Criteria

- [ ] All error classes set `this.name`
- [ ] All constructors accept `ErrorOptions` with `cause`
- [ ] Mutable fields are `readonly`

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (TypeScript Reviewer)
