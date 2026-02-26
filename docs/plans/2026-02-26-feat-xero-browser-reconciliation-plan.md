---
title: "feat: Xero browser-driven reconciliation via agent-browser"
type: feat
status: future
date: 2026-02-26
prerequisite: 2026-02-26-feat-xero-reconciliation-mvp-plan.md
---

# Xero Browser-Driven Reconciliation

## Overview

Handle transactions that can't be reconciled via the Xero API by driving Xero's web UI using agent-browser in headed mode. This includes complex matches, transfers, manual categorisation, and anything the simple matching in the MVP plan can't handle.

**Prerequisite:** The MVP plan (`2026-02-26-feat-xero-reconciliation-mvp-plan.md`) must be implemented first. This plan builds on the auth, state, and export infrastructure from the MVP.

**Split from:** `2026-02-26-feat-xero-bank-reconciliation-plan-SUPERSEDED.md`

---

## Proposed Solution

### Files

- `.claude/commands/xero-browse.md` - Browser automation command using agent-browser
- MVP's `src/xero/export.ts` remains the fallback when agent-browser is unavailable

### Workflow

1. Check if `agent-browser` is installed via `commandExists()` from `@side-quest/core/spawn`; if not, fall back to `export.ts` and output file path
2. Launch `agent-browser --headed --profile ~/.xero-session` (cookie persistence across runs)
3. Navigate to Xero - detect login page vs. dashboard
4. If login page: prompt user "Please log in to Xero in the browser, then press Enter to continue"
5. After login: verify org name in page matches `.xero-config.json` tenant
6. Navigate via dashboard (not hardcoded URLs) - click Accounting > Bank Reconciliation
7. For each remaining transaction:
   - Snapshot interactive elements (`agent-browser snapshot -i`)
   - Locate the matching row by amount/date/description
   - Choose action based on match type:
     - **Find & Match** - for transactions with invoice matches
     - **Create** - for expenses needing account code assignment
     - **Transfer** - for inter-account movements
   - Fill matching details using element refs (`@e1`, `@e2`, etc.)
   - Confirm reconciliation
   - Update state file
8. Use event-driven waits (not fixed pauses)
9. On error: screenshot for debugging, skip to next transaction

**Screenshots:** Opt-in via `--screenshots` flag (not default). Default: log action + timestamp + transaction ID.

---

## Browser Automation Patterns

### Session Persistence

`--profile ~/.xero-session` stores cookies between runs. Users log in once; subsequent runs skip authentication:

```bash
# First run - user logs in manually
agent-browser --headed --profile ~/.xero-session

# Subsequent runs - session cookies are reused
agent-browser --headed --profile ~/.xero-session  # already authenticated
```

### Login Detection

```
# Check if we're on the login page or dashboard
agent-browser snapshot -i
# Look for refs containing "Login" or "Sign in" vs. "Dashboard" or "Organisation"
```

### Navigation via Dashboard

Navigate using dashboard links (not hardcoded URLs - Xero URLs change):

```
# From dashboard, navigate to reconciliation
agent-browser click @e[accounting-menu]
agent-browser wait --text "Bank Reconciliation"
agent-browser click @e[bank-reconciliation-link]
agent-browser wait --load networkidle
```

### Snapshot-then-Act Pattern

ALWAYS re-snapshot after any DOM mutation:

```
# 1. Snapshot to discover elements
agent-browser snapshot -i
# 2. Act on an element
agent-browser click @e5
# 3. Re-snapshot (DOM has changed)
agent-browser snapshot -i
# 4. Continue with new refs
```

### Event-Driven Waits

Never use `sleep`:

```
agent-browser wait --text "Reconciled"       # wait for text to appear
agent-browser wait --load networkidle        # wait for network to settle
agent-browser wait --fn "!document.querySelector('.spinner')"  # custom JS condition
```

### Error Recovery

- On element not found: re-snapshot, retry once with fresh refs
- On navigation error: return to dashboard, start fresh for that transaction
- On timeout: screenshot + skip transaction + log for manual review
- Never retry the same click more than once - DOM may have changed

---

## Browser Session Hardening Notes

- Xero sessions expire after ~30 minutes of inactivity
- The `--profile` flag persists cookies but not necessarily active sessions
- Plan for re-authentication mid-session if processing many transactions
- Consider a "check session alive" step before starting batch processing
- Xero may show CAPTCHA or MFA challenges on new sessions

### Session Security

`~/.xero-session` stores Xero session cookies on disk. These cookies grant full authenticated access to the Xero account and must be protected.

**Before launching agent-browser, the automation must:**

1. **Enforce directory permissions (0700)** - Before any use of `~/.xero-session`, verify and set permissions to `0700` (owner read/write/execute only). This prevents other local processes or users from reading session cookies.
   ```bash
   mkdir -p ~/.xero-session
   chmod 0700 ~/.xero-session
   ```

2. **Exclude from Time Machine** - Session cookies should never be backed up. Use `tmutil addexclusion` to prevent Time Machine from capturing credentials.
   ```bash
   tmutil addexclusion ~/.xero-session
   ```

3. **Exclude from iCloud sync** - Ensure `~/.xero-session` is not synced via iCloud Drive. Since the directory lives under `~` (not `~/Library/Mobile Documents` or `~/Desktop`/`~/Documents` when iCloud Desktop & Documents is enabled), this is unlikely by default, but if the home directory layout changes, add a `.nosync` marker or move the profile to a path outside iCloud's scope (e.g., `/tmp` or `~/.local/state/xero-session`).

4. **Consider ephemeral profiles** - For maximum security, use a fresh profile directory per session (e.g., a temp directory) and delete it after the reconciliation batch completes. This avoids cookies persisting on disk entirely. The trade-off is that the user must re-authenticate each run. A middle ground is a time-boxed profile that auto-deletes after N hours of inactivity.

---

## Dependencies & Risks

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| Xero UI changes break browser automation | Medium | agent-browser refs are more resilient than CSS selectors. Re-snapshot and adapt. |
| Session expiry mid-batch | Medium | Detect login page, prompt user to re-authenticate, continue from where we left off |
| agent-browser not installed | Low | Fall back to CSV export (MVP's export.ts) |

### Dependencies

```bash
# Runtime (in addition to MVP dependencies)
# agent-browser CLI must be installed globally
bunx agent-browser --version
```

### Tools
- [agent-browser CLI](https://www.npmjs.com/package/agent-browser) (Vercel) - ref-based browser automation

---

## Acceptance Criteria

- [ ] MVP plan is fully implemented (prerequisite)
- [ ] Browser automation handles transactions that can't be reconciled via API
- [ ] Session persistence works across runs
- [ ] Fallback to CSV export when agent-browser is unavailable
- [ ] Error recovery doesn't crash the batch - skip and continue
- [ ] State file is updated after each browser reconciliation
- [ ] `~/.xero-session` directory permissions enforced at `0700` before each use
- [ ] `~/.xero-session` excluded from Time Machine via `tmutil addexclusion`
- [ ] `~/.xero-session` excluded from iCloud sync
- [ ] Ephemeral profile option documented as a security enhancement
