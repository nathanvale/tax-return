---
status: pending
priority: p3
issue_id: "071"
tags: [code-review, architecture, agent-native, auth]
dependencies: []
---

# Provide non-interactive auth path for agent-native parity

Current auth flow assumes an interactive desktop (`open` command + localhost callback). This limits parity for headless agents that need the same capability in CI/server environments.

## Findings

- Browser launch is hardcoded to `open` ([src/xero/auth.ts](/Users/nathanvale/code/tax-return/src/xero/auth.ts:82)).
- Callback waits on local HTTP redirect flow only ([src/xero/auth.ts](/Users/nathanvale/code/tax-return/src/xero/auth.ts:424)).
- Blast radius: reduced agent capability outside local interactive sessions.

## Proposed Solutions

### Option 1: Add device-code or manual-copy auth mode (Recommended)

**Approach:** Support a headless mode that prints verification URL/code and polls token endpoint.

**Pros:** Full agent parity across environments.

**Cons:** Additional OAuth branch and UX handling.

**Effort:** Medium

**Risk:** Medium

---

### Option 2: Add `--no-open` + callback URL output

**Approach:** Skip automatic browser open; print URL and instructions.

**Pros:** Small change, improves remote usability.

**Cons:** Still needs browser + callback from user environment.

**Effort:** Small

**Risk:** Low

---

### Option 3: Keep interactive-only flow

**Approach:** No change.

**Pros:** Minimal implementation.

**Cons:** Agent-native parity remains incomplete.

**Effort:** None

**Risk:** Medium

## Recommended Action


## Technical Details

- Affected files:
- [src/xero/auth.ts](/Users/nathanvale/code/tax-return/src/xero/auth.ts:82)
- [src/xero/auth.ts](/Users/nathanvale/code/tax-return/src/xero/auth.ts:424)

## Resources

- PR branch: `feat/xero-cli-agent-native`

## Acceptance Criteria

- [ ] Auth can be completed without GUI/browser auto-open.
- [ ] New mode is documented in CLI help.
- [ ] Tests cover non-interactive auth path behavior.

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Codex

**Actions:**
- Ran agent-native parity pass across command capabilities.
- Checked auth control flow and environment assumptions.

**Learnings:**
- Most command actions are agent-friendly; auth remains the main parity gap.

## Notes

- This is not a merge blocker for local-first workflows.
