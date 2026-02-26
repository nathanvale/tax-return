---
status: done
priority: p1
issue_id: "016"
tags: [architecture, auth, typescript]
dependencies: []
---

# Fix broken auth contract -- ensureFreshToken() signature contradiction

## Problem Statement

The plan has `ensureFreshToken()` returning `Promise<void>` (line 240) but `xeroFetch()` calls `const token = await ensureFreshToken()` expecting a string (line 374). These contradictory signatures will break at compile time.

## Findings

- `ensureFreshToken(): Promise<void>` at plan line 240 (mutex section)
- `const token = await ensureFreshToken()` at plan line 374 (xeroFetch wrapper)
- The openapi-fetch middleware also calls `ensureFreshToken()` expecting a string return (line 177)
- Two different callers need two different things: middleware needs a token string, mutex callers just need freshness guarantee

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Return the access token string

**Approach:** Change signature to `ensureFreshToken(): Promise<string>`. After ensuring freshness (refresh if needed), return the current access token from Keychain.

**Pros:**
- Single function serves both use cases
- Callers don't need to know about Keychain

**Cons:**
- Mixes "ensure fresh" side effect with "get token" read

**Effort:** 15 minutes

**Risk:** Low

### Option 2: Split into two functions

**Approach:** `ensureFreshToken(): Promise<void>` for the mutex/refresh, `getAccessToken(): Promise<string>` for reading from Keychain. Callers compose as needed.

**Pros:**
- Clean separation of concerns
- Each function does one thing

**Cons:**
- Two function calls where one would do
- Risk of calling getAccessToken without ensuring freshness first

**Effort:** 20 minutes

**Risk:** Low

## Recommended Action

To be filled during triage.

## Acceptance Criteria

- [x] Single consistent function signature across plan
- [x] All callers (openapi-fetch middleware, xeroFetch wrapper) use the same contract
- [x] Plan code examples compile conceptually (no type errors)

## Work Log

### 2026-02-26 - Resolved signature contradiction

**By:** Claude Code

**Actions:**
- Changed `ensureFreshToken()` return type from `Promise<void>` to `Promise<string>` in mutex code block
- Updated all early-return paths to return the access token via `loadFromKeychain('access_token')`
- Fixed prose reference in Phase 1 files list: `withFreshToken()` -> `ensureFreshToken()` with note that it returns the access token
- Verified all 3 references in the plan are now consistent (definition, prose, xeroFetch caller)
- Did NOT remove `xeroFetch()` wrapper (that is todo #017's scope)

**Learnings:**
- The function returning the token serves both use cases: callers get freshness guarantee AND the token value in one call

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Identified contradiction between mutex section and xeroFetch wrapper
- Filed from Architect review (Pass 1, Critical issue #1)

**Learnings:**
- Plan has been edited by 15+ parallel agents which created inconsistencies
