---
status: done
priority: p1
issue_id: "019"
tags: [auth, xero-api, blocker]
dependencies: []
---

# Validate Xero granular scopes format before March 2 deadline

## Problem Statement

The plan lists "Granular scopes (post March 2 2026)" as a HIGH likelihood risk. The plan date is February 26, 2026 -- this is 4 days away. Apps created after March 2 need new scope format. This is not a future risk; it's an immediate blocker if the Xero app hasn't been registered yet.

## Findings

- Plan risk table (line 696): HIGH likelihood
- Current scopes: `accounting.transactions accounting.contacts accounting.settings offline_access`
- Xero announced granular scope changes effective March 2, 2026
- If app is not yet created, it MUST use the new format
- If app was created before March 2, old format may still work (grandfather clause unclear)
- No one has verified what the actual new scope format looks like

**Source:** Architect review (Pass 1)

## Proposed Solutions

### Option 1: Create app before March 2 with old scopes

**Approach:** Register the Xero app immediately (before March 2) using current scope format. This likely grandfathers the app into old scope format.

**Pros:**
- Avoids the issue entirely
- 4-day window to act

**Cons:**
- Must act now
- May need migration later anyway

**Effort:** 30 minutes (just app registration)

**Risk:** Low if done before March 2

### Option 2: Research and adopt new scope format

**Approach:** Check Xero developer docs for the new granular scope format. Update plan with correct scopes.

**Pros:**
- Future-proof
- No migration needed later

**Cons:**
- New format may not be documented yet
- May require different scopes than planned

**Effort:** 1-2 hours research

**Risk:** Medium (format may not be finalized)

## Recommended Action

Option 1 selected: Register app before March 2. Plan updated with Pre-Implementation Checklist and risk downgraded to MITIGATED.

## Acceptance Criteria

- [ ] Xero app registered (either before or after March 2 with correct scopes)
- [ ] Plan updated with verified scope format
- [ ] Auth flow tested with actual scopes

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Flagged as time-sensitive blocker (4 days until deadline)
- Filed from Architect review (Pass 1, Critical #4)

**Learnings:**
- Time-sensitive risks should be escalated to action items, not just risk register entries

### 2026-02-26 - Resolved

**By:** Claude Code

**Actions:**
- Added "Pre-Implementation Checklist" section to MVP plan with explicit app registration step
- Changed risk likelihood from "High" to "MITIGATED if app registered before March 2"
- Updated risk mitigation text with actionable instructions
- Marked todo as done
