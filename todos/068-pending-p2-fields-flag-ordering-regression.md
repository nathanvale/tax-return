---
status: pending
priority: p2
issue_id: "068"
tags: [code-review, quality, cli]
dependencies: []
---

# Fix `--fields` parsing regression for history/invoices

`parseCli` rejects `--fields` before it reaches the `history` and `invoices` command branches, despite usage text saying these commands support `--fields`.

## Findings

- Guard at [src/cli/command.ts](/Users/nathanvale/code/tax-return/src/cli/command.ts:512) triggers usage error whenever `fieldsRaw` is present.
- `history` and `invoices` branches that parse fields are after that guard ([src/cli/command.ts](/Users/nathanvale/code/tax-return/src/cli/command.ts:519), [src/cli/command.ts](/Users/nathanvale/code/tax-return/src/cli/command.ts:541)).
- Blast radius: functional regression for field projection options on two commands.

## Proposed Solutions

### Option 1: Move or narrow the guard (Recommended)

**Approach:** Apply the guard only for commands that do not support `--fields`.

**Pros:** Minimal diff; aligns behavior with docs.

**Cons:** Needs parser test additions.

**Effort:** Small

**Risk:** Low

---

### Option 2: Command-specific parser map

**Approach:** Define per-command supported flags and validate after command resolution.

**Pros:** Future-proof against ordering bugs.

**Cons:** Larger refactor.

**Effort:** Medium

**Risk:** Medium

---

### Option 3: Remove global guard entirely

**Approach:** Let each command parser own unsupported-flag validation.

**Pros:** Simple control flow.

**Cons:** Easy to miss unsupported combos.

**Effort:** Small

**Risk:** Medium

## Recommended Action


## Technical Details

- Affected files:
- [src/cli/command.ts](/Users/nathanvale/code/tax-return/src/cli/command.ts:512)

## Resources

- PR branch: `feat/xero-cli-agent-native`

## Acceptance Criteria

- [ ] `history --fields ...` parses successfully.
- [ ] `invoices --fields ...` parses successfully.
- [ ] Unsupported commands still reject `--fields`.
- [ ] Parser tests cover all command/flag permutations.

## Work Log

### 2026-02-27 - Initial Discovery

**By:** Codex

**Actions:**
- Reviewed parse order and command branches.
- Confirmed logic contradiction in parser flow.

**Learnings:**
- Centralized pre-guard introduces command-order coupling.

## Notes

- This is a correctness issue and should be fixed before broad CLI adoption.
