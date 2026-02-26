1. **Verdict**: **REQUEST CHANGES**

2. **Strengths**
- Dry-run-first with explicit `--execute` is the right operational safety baseline.
- State persistence intent plus server-side duplicate checks shows awareness of re-run safety.
- Batch + fallback strategy acknowledges real API instability instead of assuming happy path.
- Scope is constrained to a narrow matcher, which reduces blast radius for MVP.

3. **Critical issues (must fix)**
- **No durable run journal, so recovery is ambiguous after interruption.**  
  You need a per-run ledger (e.g., `.xero-reconcile-runs/<runId>.jsonl`) recording `planned`, `attempted`, `succeeded(paymentId)`, `failed(error)` per transaction before and after each API call. Without this, a crash between API success and state write creates an unrecoverable gray zone.
- **Idempotency strategy is underspecified for write calls.**  
  State-file idempotency alone is not enough. Use deterministic idempotency keys per bank transaction/payment intent on Xero write requests so retries after network timeouts cannot double-create.
- **No explicit resume mode semantics.**  
  “Best effort” is vague operationally. You need `--resume <runId>` behavior that retries only unresolved/failed items and prints exact counts: `success=40 failed=10 skipped=...`.
- **Dry-run and execute are not tied to a stable input snapshot.**  
  If data changes between dry-run and execute, user confidence is false. Persist a snapshot hash or explicit candidate list from dry-run, and warn/block execute when drift is detected unless `--force`.
- **No defined rollback/audit workflow for bad writes.**  
  Since API undo is unavailable, the tool must emit a machine-readable “created payments report” with deep links/IDs, timestamp, invoice, bank transaction, amount, and operator instructions for manual reversal.

4. **Important observations (should fix)**
- Add **preflight checks** before execute: token validity, tenant reachability, API health probe, writable state path, writable export path, and lock/run collision check.
- Define **exit codes** (e.g., `0` all success, `2` partial success, `3` auth failure, `4` config/env failure) so failures are scriptable and obvious.
- Add **operator-focused output modes**: concise summary by default + `--verbose` with per-item diagnostics and correlation IDs.
- Define CSV export behavior: output directory, timestamped filename convention, overwrite policy, and whether export is append/snapshot/deduped.
- `--auth` UX should be explicit: `--auth` forces re-auth, while normal run should attempt current tokens first and only prompt if invalid.
- OAuth callback port handling needs operational fallback: configurable `--auth-port`, auto-select alternative port option, and actionable error text.

5. **Nice-to-haves**
- `--plan` command to print exact candidate actions and risk summary before `--execute`.
- `--since` / `--until` filters to narrow operational blast radius.
- Optional JSON output artifact for each run to support later reconciliation/audit.
- `doctor` command for environment diagnostics (keychain access, filesystem perms, callback availability).

6. **Questions for the author**
1. What exact terminal output appears for partial success (40/50)? Show the final summary format and where failure details are persisted.
2. How does rerun behavior differ between default run and explicit resume? Which set is retried?
3. Where is the server-side duplicate check executed in the reconciliation loop: pre-match, pre-write, or post-failure recovery?
4. What deterministic idempotency key will you use for payment creation?
5. What is the exact recovery flow when refresh fails mid-run after some writes have already succeeded?
6. What is the CSV filename/path convention, and how do you prevent accidental overwrite or duplicate ambiguity across runs?
7. What exact error/help text appears when auth callback port 5555 is occupied, and can users override the port from CLI/env?

7. **Synthesis**
Across all three passes, the major architecture and security pitfalls are now well surfaced, but operational safety is still underdefined for real-world failure handling. The remaining highest risk is not “can it call Xero,” but “can Nathan reliably recover from interrupted or partial writes without guessing.” If you add durable per-run journaling, deterministic idempotency keys, explicit resume semantics, and concrete runbook-grade output/exit behavior, this plan is likely de-risked enough for MVP implementation.