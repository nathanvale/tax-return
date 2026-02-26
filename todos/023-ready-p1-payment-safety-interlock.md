---
status: done
priority: p1
issue_id: "023"
tags: [security, payments, safety]
dependencies: []
---

# Add payment execution safety interlock -- require --execute flag

## Problem Statement

The plan has `--dry-run` as an opt-in flag, meaning live payment execution is the DEFAULT behavior. For a tool that creates real payments in Xero (real money), accidental execution without `--dry-run` could create unwanted payments. The Security reviewer says this is insufficient for financial tooling.

## Findings

- `--dry-run` is a flag, not the default (plan line 415, 644)
- Claude command "asks for confirmation" but this is in the markdown command, not TypeScript code
- If someone runs the TypeScript module directly (not via Claude command), there's no confirmation
- Xero payments are real financial transactions -- mistakes cost real money
- The confirmation step is in the UX layer (Claude command) not the safety layer (TypeScript)

**Source:** Security Engineer review (Pass 3)

## Proposed Solutions

### Option 1: Default to dry-run, require --execute for live (recommended)

**Approach:** Invert the flag. Default behavior shows what WOULD happen. Add `--execute` or `--live` flag to actually create payments. TypeScript code checks for the flag, not the Claude command.

**Pros:**
- Safe by default
- Can't accidentally create payments
- Safety at the code level, not just UX

**Cons:**
- Slightly more friction for live runs

**Effort:** 30 minutes

**Risk:** Low

### Option 2: Add typed confirmation in TypeScript code

**Approach:** Before creating payments, require the user to type the org name + payment count + total amount. This works even when called outside Claude commands.

**Pros:**
- Very explicit confirmation
- Works at code level

**Cons:**
- More complex to implement
- Interactive input in TypeScript

**Effort:** 1 hour

**Risk:** Low

## Recommended Action

Option 1 implemented -- default to dry-run, require `--execute` for live.

## Acceptance Criteria

- [x] Default mode is dry-run (no payments created without explicit flag)
- [x] Safety interlock exists in TypeScript code, not just Claude command
- [x] Impossible to accidentally create payments by running the wrong command

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Security reviewer flagged payment execution default as dangerous
- Filed from Security Engineer review (Pass 3, Critical #4)

**Learnings:**
- Financial tools should be safe-by-default -- require explicit opt-in for money-moving actions

### 2026-02-26 - Resolved

**By:** Claude Code

**Actions:**
- Implemented Option 1 in the MVP plan
- Changed default behavior from live execution to dry-run (no `--dry-run` flag needed)
- Added `--execute` flag as REQUIRED for live payment creation
- Added `assertExecuteFlag()` safety interlock in `reconcile.ts` (TypeScript level, not just Claude command)
- Updated all references: Key Decisions, Architecture diagram, Project Structure, Phase 2 files, Verification steps, Acceptance Criteria
- Removed `--dry-run` from flag lists (it is now the default, not a flag)
- Added 3 new acceptance criteria covering the safety interlock

**Learnings:**
- Safety interlocks for financial operations must exist at the code level, not just the UX layer. Anyone calling the TypeScript module directly (scripts, tests, imports) gets the same protection.
