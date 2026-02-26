**Verdict**  
REQUEST CHANGES

**Strengths**
- Clear MVP outcome: dry-run default, explicit `--execute`, and CSV export make operational risk visible.
- Choosing direct `fetch()` avoids SDK lock-in and keeps control over request/response behavior.
- PKCE + Keychain storage is a strong baseline for local CLI auth hygiene.
- Matching logic scope is intentionally narrow (amount + contact), which is appropriate for v1.

**Critical Issues (must fix)**
- `api.ts`/`auth.ts` boundary is currently unsafe.  
  `xeroFetch()` calling `ensureFreshToken()` while refresh logic needs HTTP creates a likely dependency cycle (`src/xero/api.ts` ↔ `src/xero/auth.ts`).  
  Fix: introduce a third module (`src/xero/http.ts`) for raw transport; auth uses raw transport for token refresh; API methods receive a token provider interface.
- `xeroFetch()` is over-coupled for testing and growth.  
  Baking auth + retry + domain error mapping into one wrapper makes every API test integration-heavy.  
  Fix: separate concerns:
  1. `transportFetch(request, token)` (pure-ish),
  2. `withAuth(getToken)` decorator,
  3. `withRetry(policy)` decorator,
  4. endpoint functions.
- State persistence is not concurrency-safe.  
  Atomic rename prevents torn writes, not concurrent logical races. Two simultaneous runs can both pass pre-checks and create duplicate payments.  
  Fix: add process lock (`.xero-reconcile-state.lock` using exclusive open) and fail-fast if locked.
- Batch fallback strategy can become pathological.  
  50 invalid items => ~55s serial calls at 1100ms, with little value if errors are deterministic validation issues.  
  Fix: for known validation failures, parse/report per item from batch response where possible; only retry individual for ambiguous/transient failures.

**Important Observations (should fix)**
- `matcher.ts` “pure module” claim is inaccurate if it mutates candidate collections. Keep it either explicitly imperative or truly immutable. Prefer returning `{matches, unmatchedTxns, unmatchedInvoices}` without in-place mutation.
- 12 files is slightly over-decomposed for this MVP.  
  `src/xero/export.ts` and `src/xero/state.ts` can be merged into `src/xero/reconcile.ts` initially, then extracted when complexity appears.
- Error taxonomy may be heavy for v1. `XeroAuthError` + `XeroApiError` is enough; defer deeper classification until you see real failure modes.
- Rate-limit handling should be explicit policy, not side-effect warnings inside fetch wrapper. At least centralize threshold config and emit structured warnings for CLI summary.

**Nice-to-Haves**
- Add a reconciliation “run manifest” JSON output (counts, matched, created, skipped, errors) for auditability.
- Add `--max-payments` guardrail for first live runs.
- Add `--since` or statement-date filter to reduce accidental broad fetches.
- Consider a lightweight ledger DB (SQLite) if idempotency/state requirements grow beyond single-machine CLI use.

**Questions for the Author**
- How exactly will you break the `auth`/`api` cycle in code structure before implementation?
- What is the lock strategy for accidental double-run from two terminals?
- Are you expecting batch create error responses to include per-item details from Xero, or are you assuming item-level retries are required?
- Do you want this tool to stay single-user local only, or should architecture allow future CI/automation runs?
- What is your testing split (unit vs integration) for OAuth callback server, Keychain access, and retry behavior?