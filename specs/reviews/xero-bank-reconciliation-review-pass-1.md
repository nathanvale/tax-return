1. **Verdict: REQUEST CHANGES**

2. **Strengths**
- Clear layering intent (API/matching/browser) and sensible YAGNI exclusions for v1.
- Good call to avoid `xero-node` and use typed REST contracts with generated OpenAPI types.
- Idempotency is treated seriously (state + server-side checks + dry-run), which is correct for reconciliation.
- Risk register is explicit and dates external volatility (OAuth scopes, UI drift).

3. **Critical issues (must fix before implementation)**
- **Auth contract is internally broken** (`ensureFreshToken()` vs `xeroFetch()`; lines 238-249 vs 374).  
  Define one contract now:
  - `ensureFreshToken(): Promise<string>` (returns access token), or
  - `ensureFreshToken(): Promise<void>` + `getAccessTokenOrThrow(): Promise<string>`.
  Today you have both semantics simultaneously. This will leak auth logic across modules.
- **Two HTTP-client abstractions for one API** (`openapi-fetch` middleware at lines 170-191 and manual `xeroFetch()` at 371-390).  
  Pick one implementation. Architecturally, keep `openapi-fetch` as the single gateway and move retry/auth into middleware wrappers. Delete manual wrapper or make it internal to the same client factory.
- **AI boundary is undefined** (line 422 claims Claude “reasoning” but no inference interface exists).  
  Decide whether matching is deterministic TS only, or includes LLM inference. If LLM is real, add a module boundary now (e.g., `src/ai.ts` with typed input/output, prompt/versioning, timeout/fallback). If not, remove AI claims from the plan and treat Claude commands as UX wrappers only.
- **Granular scopes risk is immediate, not future** (line 696).  
  Today is **February 26, 2026**; change lands around **March 2, 2026**. This is a launch blocker for any app registration after that date. Scope format and migration path must be validated before Phase 1 starts.
- **Batch-fallback can self-DDOS under Xero rate limits** (lines 556-567).  
  A failed batch of 50 followed by 50 singles can exceed 60 req/min and cascade retries. Fallback must be rate-aware (token bucket/leaky queue), classify retryable vs non-retryable errors, and cap fallback fan-out.
- **State durability assumptions are ambiguous** (`loadJsonStateSync`/`saveJsonStateSync` vs “atomic write”, lines 69-90 and 225).  
  If `@side-quest/core/fs` is not guaranteed atomic + fsync-safe, `state.ts` must implement temp-file+rename itself. Do not assume atomicity for idempotency-critical data.

4. **Important observations (should fix)**
- **Phase coupling is stronger than stated**: Phase 2 depends on finalized auth/client semantics from Phase 1; Phase 3 depends on reconciliation action model from Phase 2. Add explicit interface freeze gates between phases.
- **Scope vs complexity for solo tool**: 4 commands + 8 modules is near the upper bound for v1. Consider collapsing command surface to 2 commands (`xero-auth`, `xero-reconcile`) and keep browse/status as flags/subcommands.
- **Browser fallback acceptance is weak for tax completeness**: if `agent-browser` is unavailable, CSV export-only means unresolved items accumulate. Define a “cannot complete return” status and hard fail summary, not silent degradation.
- **Config hygiene gap**: `.xero-config.json` and `.xero-reconcile-state.json` must be added to `.gitignore` in Phase 1 acceptance criteria.
- **Dependency blast radius**: `@side-quest/core` is private and broad. Wrap it behind local adapters (`src/lib/sidequest.ts`) so replacement is cheap if API drifts.

5. **Nice-to-haves**
- Add a minimal reconciliation event log (`attempted`, `created`, `skipped`, `failed`) for auditability.
- Version state schema (`stateVersion`) with migration hook to avoid future lock-in.
- Add contract tests for generated OpenAPI client against recorded fixtures to detect spec drift early.

6. **Questions for the author**
1. What is the single source of truth for auth token retrieval: middleware, wrapper, or auth module?
2. Is LLM inference actually part of matching decisions, or only explanation/UI text?
3. What exact fallback policy do you want when batch fails: classify by HTTP status, then stagger singles with rate limiting?
4. Does `saveJsonStateSync()` guarantee atomic replace on APFS, and does it fsync directory metadata?
5. What is the success criterion when browser automation is unavailable: partial completion allowed, or hard stop?
6. Have you validated the post-**March 2, 2026** Xero scope model in a real app registration flow?