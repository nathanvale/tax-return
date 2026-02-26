---
status: pending
priority: p2
issue_id: "067"
tags: [code-review, security, input-validation, xero]
dependencies: []
---

# Sanitize OData filter values in list commands

User-provided CLI flags are interpolated directly into Xero `where` expressions without escaping, allowing malformed queries or injected filter fragments.

## Findings

- Accounts type filter interpolation: [src/cli/commands/accounts.ts](/Users/nathanvale/code/tax-return/src/cli/commands/accounts.ts:149).
- Invoices status/type interpolation: [src/cli/commands/invoices.ts](/Users/nathanvale/code/tax-return/src/cli/commands/invoices.ts:157).
- History contact/account-code interpolation: [src/cli/commands/history.ts](/Users/nathanvale/code/tax-return/src/cli/commands/history.ts:224).
- Blast radius: query tampering, broken requests, hard-to-debug behavior when agents pass raw text.

## Proposed Solutions

### Option 1: Add shared OData literal escaping helper (Recommended)

**Approach:** Encode or escape `"` and reserved operators before composing `where` clauses.

**Pros:** Centralized and reusable.

**Cons:** Requires careful unit tests for escaping edge cases.

**Effort:** Small

**Risk:** Low

---

### Option 2: Strict allowlists per flag

**Approach:** Accept only known enums for `type/status` and strict regex for contact/account.

**Pros:** Strong security posture.

**Cons:** May reject valid but uncommon values.

**Effort:** Medium

**Risk:** Medium

---

### Option 3: Remove user-driven where filters

**Approach:** Fetch broader data then filter locally.

**Pros:** Avoids query-construction risks.

**Cons:** Larger payloads and slower execution.

**Effort:** Medium

**Risk:** Medium

## Recommended Action


## Technical Details

- Affected files:
- [src/cli/commands/accounts.ts](/Users/nathanvale/code/tax-return/src/cli/commands/accounts.ts:149)
- [src/cli/commands/invoices.ts](/Users/nathanvale/code/tax-return/src/cli/commands/invoices.ts:157)
- [src/cli/commands/history.ts](/Users/nathanvale/code/tax-return/src/cli/commands/history.ts:224)

## Resources

- PR branch: `feat/xero-cli-agent-native`

## Acceptance Criteria

- [ ] Unsafe characters in filter inputs are escaped or rejected.
- [ ] Unit tests cover quote/operator injection payloads.
- [ ] Existing valid filter inputs still work.

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Codex

**Actions:**
- Traced all `where` builders across list commands.
- Verified direct string interpolation of user-provided values.

**Learnings:**
- The same bug pattern exists across multiple command modules.

## Notes

- Flag as security-important, but not immediate data-loss risk.
