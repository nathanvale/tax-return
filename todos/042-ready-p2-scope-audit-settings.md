---
status: ready
priority: p2
issue_id: "042"
tags: [security, oauth, scope]
dependencies: []
---

# Audit whether accounting.settings scope is needed for MVP

## Problem Statement

The OAuth scope includes `accounting.settings` but no MVP endpoint clearly requires it. Over-privileged scopes increase risk surface. Should be least-privilege.

## Findings

- Security Engineer review (Pass 2, Important)
- MVP endpoints: BankTransactions (accounting.transactions), Invoices (accounting.transactions), Payments (accounting.transactions), Contacts (accounting.contacts), Connections (no scope needed)
- accounting.settings may be needed for organisation/account info -- needs verification

**Source:** Security Engineer review (Pass 2)

## Proposed Solutions

### Option 1: Test without accounting.settings and add only if needed

**Approach:** Remove accounting.settings from scope. If any endpoint fails with 403, add it back. Document which endpoint requires it.

**Effort:** 10 minutes | **Risk:** Low

## Acceptance Criteria

- [ ] Scope is least-privilege for MVP endpoints
- [ ] If accounting.settings is needed, document which endpoint requires it
- [ ] If not needed, remove from plan and auth code

## Work Log

### 2026-02-26 - Filed from Review

**By:** Claude Code
**Actions:** Filed from Security Engineer review (Pass 2, Important)
