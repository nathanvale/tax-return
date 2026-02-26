---
status: done
priority: p1
issue_id: "017"
tags: [architecture, api, deduplication]
dependencies: []
---

# Consolidate dual HTTP clients into single openapi-fetch implementation

## Problem Statement

The plan shows two different HTTP client abstractions for the same Xero API: an `openapi-fetch` client with auth middleware (lines 170-191) and a manual `xeroFetch()` convenience wrapper (lines 371-390). Having two clients creates confusion about which is canonical and will lead to inconsistent error handling.

## Findings

- `openapi-fetch` client with middleware at plan lines 170-191 (typed, clean)
- Manual `xeroFetch()` wrapper at plan lines 371-390 (raw fetch with auth headers)
- The openapi-fetch approach is clearly superior (typed responses, URL autocomplete, middleware hooks)
- `xeroFetch()` exists because it was written in the PKCE deep-dive section before the openapi-fetch section was added
- Both handle auth headers, both handle errors, both hit the same base URL

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Keep only openapi-fetch (recommended)

**Approach:** Remove `xeroFetch()` entirely. Move retry and error handling into openapi-fetch middleware. All API calls go through the typed client.

**Pros:**
- Single client, single source of truth
- Full type safety on all endpoints
- Middleware handles cross-cutting concerns (auth, retry, errors)

**Cons:**
- Need to verify openapi-fetch middleware can handle all the error cases (429, 401, 500)

**Effort:** 30 minutes

**Risk:** Low

## Recommended Action

To be filled during triage.

## Acceptance Criteria

- [x] Plan has exactly ONE HTTP client abstraction
- [x] All API call examples use the same client
- [x] Error handling (401, 429, 500) handled in middleware
- [x] Auth token injection handled in middleware

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Identified two competing HTTP clients in plan
- Filed from Architect review (Pass 1, Critical issue #2)

**Learnings:**
- Deep-dive sections added code that conflicted with the main API section

### 2026-02-26 - Resolved

**By:** Claude Code

**Actions:**
- The MVP plan had already deferred `openapi-fetch` to the advanced matching plan (YAGNI), so the resolution kept `xeroFetch()` as the single client
- Marked the "Research Insights: Why Not xero-node" code example as illustrative-only (not implementation code) to prevent confusion with `xeroFetch()`
- Enhanced `xeroFetch()` to include built-in retry for 429/503 via `retry()` from `@side-quest/core/utils`
- Added `xeroPost()` convenience wrapper that delegates to `xeroFetch()` (same auth/retry/error handling)
- Updated Phase 1 `api.ts` description to document `xeroFetch()` as the single HTTP client
- Updated Phase 2 `api.ts` description to clarify all new functions use the same client
- Updated "Rate limiting" section to reference `xeroFetch()` built-in retry

**Learnings:**
- The original todo assumed `openapi-fetch` was in the MVP plan, but it had already been deferred. The correct resolution was to consolidate around `xeroFetch()` instead.
