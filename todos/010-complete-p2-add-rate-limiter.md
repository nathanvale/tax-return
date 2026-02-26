---
status: complete
priority: p2
issue_id: "010"
tags: [code-review, performance]
dependencies: []
---

# No rate limiter -- cascading 429 failures likely at scale

## Problem Statement

The plan explicitly excluded a rate limiter module as YAGNI, but the Performance Oracle projects that a typical reconciliation run can easily hit 300+ API calls. At 60 calls/min, this is a 5-minute minimum with perfect pacing -- but without a limiter, calls spike early and cascade into 429 retries that consume even more budget.

## Findings

- Performance Oracle: "Without this, production failures are a matter of time"
- Estimated calls per run: ~50 pages + idempotency checks + payment creation = 300+
- The plan's inline retry on 429 (max 3) does not prevent hitting the limit in the first place
- The YAGNI exclusion was reasonable for Phase 1 (reads only), but Phase 2 (writes) changes the equation

## Proposed Solutions

### Option 1: Simple sliding window limiter (15 lines)

**Approach:** Add a minimal rate limiter that paces calls to 55/min (safety margin below 60).

```typescript
class RateLimiter {
  private timestamps: number[] = []
  constructor(private maxCalls: number, private windowMs: number) {}
  async acquire(): Promise<void> {
    const now = Date.now()
    this.timestamps = this.timestamps.filter(t => now - t < this.windowMs)
    if (this.timestamps.length >= this.maxCalls) {
      const waitMs = this.timestamps[0] + this.windowMs - now + 50
      await new Promise(resolve => setTimeout(resolve, waitMs))
      return this.acquire()
    }
    this.timestamps.push(now)
  }
}
```

**Pros:**
- 15 lines, no dependencies
- Prevents cascading 429s
- Paces the entire run smoothly

**Cons:**
- Contradicts YAGNI exclusion in plan (but Phase 2 changes the calculus)
- Adds a few seconds to total run time

**Effort:** 30 minutes

**Risk:** Low

---

### Option 2: Keep inline retry, add to Phase 2 only if needed

**Approach:** Start without a limiter. If 429s occur in practice, add one then.

**Pros:**
- Truly YAGNI
- Zero upfront work

**Cons:**
- First real reconciliation run may fail
- Debugging rate limit issues wastes more time than the 30-min fix

**Effort:** 0 now, 30 min later

**Risk:** Medium

## Recommended Action

**To be filled during triage.**

## Technical Details

**Affected files:**
- `src/xero/api.ts` -- wrap all API calls with `limiter.acquire()`

## Acceptance Criteria

- [ ] Decision made: add limiter now or defer
- [ ] If added: all Xero API calls go through limiter
- [ ] 429 responses still respected (limiter + retry are complementary)

## Work Log

### 2026-02-26 - Initial Discovery

**By:** Claude Code (Performance Oracle)

**Actions:**
- Re-evaluated YAGNI exclusion in context of Phase 2 write volume
- Proposed 15-line sliding window limiter
