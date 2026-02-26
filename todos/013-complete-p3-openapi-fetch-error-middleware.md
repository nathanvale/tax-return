---
status: complete
priority: p3
issue_id: "013"
tags: [code-review, typescript, architecture]
dependencies: []
---

# Add onResponse error middleware to openapi-fetch client

## Problem Statement

The openapi-fetch client has auth middleware (`onRequest`) but no centralized error handling (`onResponse`). Each call site would need to check for 401, 429, 500 individually. A response middleware handles this once, using the typed error hierarchy.

## Findings

- TypeScript Reviewer: "Consider adding an onResponse middleware to handle error status codes centrally"
- Also flagged: auth middleware lacks try/catch around `ensureFreshToken()` -- an auth failure surfaces as an unhandled rejection with no context

## Proposed Solutions

### Option 1: Add error response middleware

```typescript
const errorMiddleware: Middleware = {
  async onResponse({ response }) {
    if (response.ok) return response
    switch (response.status) {
      case 401: throw new XeroAuthError('Unauthorized')
      case 429: throw new XeroRateLimitError('Rate limited', Number(response.headers.get('Retry-After') ?? 60))
      case 500: case 503: throw new XeroServerError(`Server error: ${response.status}`)
      default: throw new XeroError(`API error: ${response.status}`, response.status)
    }
  },
}
xero.use(authMiddleware)
xero.use(errorMiddleware)
```

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/api.ts` -- add error middleware

## Acceptance Criteria

- [ ] Error responses handled in middleware, not per-call-site
- [ ] Auth middleware wraps `ensureFreshToken()` in try/catch

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (TypeScript Reviewer)
