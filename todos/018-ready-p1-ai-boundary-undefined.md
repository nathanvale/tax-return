---
status: done
priority: p1
issue_id: "018"
tags: [architecture, ai, scope]
dependencies: []
---

# Clarify AI boundary -- remove or define the "AI Layer" in architecture

## Problem Statement

The architecture diagram shows an "AI Layer" with Claude analysis, and the plan claims "Claude enhances with reasoning: parse descriptions, suggest account codes, flag duplicates" (line 422). But there is no code, prompt design, or module showing how Claude is invoked at runtime. Both the Architect and Skeptic reviewers flagged this independently.

If there's no actual LLM inference at runtime, the architecture diagram is misleading and should be corrected. If there IS inference, it needs a module boundary.

## Findings

- Architecture diagram (line 43-58) shows 3 layers: API, AI, Browser
- Line 422: "Claude enhances with reasoning" -- no corresponding code or interface
- Line 64-66: Claude commands described as "thin" -- just calling TypeScript functions
- No `src/ai.ts` or prompt template anywhere in the plan
- The matching is fully deterministic TypeScript (Token Set Ratio, confidence scoring)
- The "AI" appears to be Claude Code itself reading output and presenting it to the user
- Both Pass 1 (Architect) and Pass 2 (Skeptic) flagged this as critical

**Source:** Architect review (Pass 1) + Skeptic review (Pass 2)

## Proposed Solutions

### Option 1: Remove AI claims, treat Claude as UX (recommended)

**Approach:** Update architecture diagram to 2 layers (API + Browser). Remove "AI Layer" column. Clarify that Claude commands are UX wrappers that call TypeScript and present results. The intelligence is in the matching algorithm, not LLM inference.

**Pros:**
- Honest about what the tool actually does
- Simpler mental model
- No phantom module to confuse implementation

**Cons:**
- Less impressive sounding

**Effort:** 15 minutes

**Risk:** Low

### Option 2: Define a real AI interface

**Approach:** Add `src/xero/ai.ts` with typed input/output for Claude inference. Define prompt templates for: description parsing, account code suggestion, duplicate detection. Add timeout/fallback.

**Pros:**
- Delivers on the architecture promise
- Could improve matching quality

**Cons:**
- Adds scope and complexity
- Needs API key or tool-use integration
- Skeptic reviewer says this is unnecessary for v1

**Effort:** 4-6 hours

**Risk:** Medium

## Recommended Action

Option 1 was implemented. The MVP plan (`2026-02-26-feat-xero-reconciliation-mvp-plan.md`) was split from the superseded plan and already has the correct 2-layer architecture (API + CLI). No AI Layer references exist. Claude commands are documented as thin orchestrators that call TypeScript modules.

## Acceptance Criteria

- [x] Architecture diagram accurately reflects runtime behavior
- [x] No claims of LLM inference unless backed by code/interface
- [x] Clear description of what Claude commands actually do

## Work Log

### 2026-02-26 - Filed from Codex Review

**By:** Claude Code

**Actions:**
- Both reviewers independently flagged same issue
- Filed from Architect (Pass 1, Critical #3) + Skeptic (Pass 2, Critical #4)

**Learnings:**
- The "AI layer" was aspirational from the original plan but never specified

### 2026-02-26 - Resolved

**By:** Claude Code

**Actions:**
- Verified the MVP plan (`2026-02-26-feat-xero-reconciliation-mvp-plan.md`) already has the correct 2-layer architecture (API Layer + CLI Layer)
- No "AI Layer", "Claude enhances with reasoning", or similar claims exist in the MVP plan
- Architecture diagram (lines 39-53) correctly shows API Layer (fetch) and CLI Layer (flags)
- Line 59 correctly states "Claude commands are thin -- Workflow logic lives in TypeScript modules"
- The original 3-layer architecture was in the superseded plan, which this MVP plan replaced

**Resolution:** Option 1 -- AI claims removed, Claude treated as UX wrapper. Already done during MVP plan creation.
