# DriftCheck — Codex Agent Guide

Repository-specific guidance for Codex when working on DriftCheck.
This file replaces Claude-specific routing with Codex-native agent roles, model choices, and delivery rules.

---

## How Codex Should Use This Repo

- Treat [`CLAUDE.md`](./CLAUDE.md) as the product brief and source of truth for scope, architecture, and demo constraints.
- Treat [`ARCHITECTURE.md`](./ARCHITECTURE.md) as the current-state codemap for the repo. Read it first when you need to know where logic lives today.
- Treat [`docs/architecture-v2.md`](./docs/architecture-v2.md) as the forward-looking product framing and implementation roadmap for the post-demo multi-mode version.
- Treat this file as the execution guide for Codex: agent delegation, ownership boundaries, verification, and repo-specific guardrails.
- Keep work stateless and demo-safe. Prefer fixture-backed fallbacks over partial live integrations.
- Do not add infrastructure that the brief explicitly excludes: no database, no extra backend service, no destructive git automation.

## Product North Star

- Default framing: DriftCheck is a personal toolchain drift assistant for AI-native developers, not a generic notes search product.
- Prioritize correctness, transparency, and reviewable suggestions over broad coverage or silent automation.
- When choosing between feature ideas, prefer the one that helps the user understand drift in the tools they actually use.

---

## Codex Best Practice For This Repo

- Work locally by default. Delegate only when the task can run independently, has clear bounded scope, and the parallelism benefit is likely to outweigh sub-agent spin-up cost.
- Prefer `explorer` agents for tightly scoped codebase questions.
- Prefer `worker` agents for bounded implementation with a disjoint write scope.
- Keep the critical path local. Do not delegate the next blocking step if the main agent needs the answer immediately.
- When delegating code changes, assign explicit file ownership and remind agents not to overwrite unrelated edits.
- Do not spawn sub-agents for one-step operational requests such as simple shell commands, repo creation, straightforward status checks, or single-file grep/read tasks unless the user specifically asks for parallelism.
- Remember that each sub-agent starts with fresh context and must reload repo instructions, so delegation should be reserved for disjoint slices where that overhead is justified.

---

## Model Routing

| Model | Use for |
|-------|---------|
| `gpt-5.4` | Reserve for architecture, orchestration, high-ambiguity reviews, prompt design, and final integration |
| `gpt-5.3-codex` | Default implementation model for routes, utilities, UI work, refactors, and TypeScript-heavy changes |
| `gpt-5.4-mini` | Cheap sidecar analysis, fixture generation, codebase exploration, small isolated edits, and copy cleanup |
| `gpt-5.2-codex` | Fallback coding model when you want Codex-style edits but do not need top-tier reasoning |

Default policy:
- Do not send `gpt-5.4` to routine implementation tasks.
- Start with `gpt-5.3-codex` for almost all code-writing work in this repo.
- Use `gpt-5.4-mini` for exploration, fixture generation, narrow helpers, and low-risk sidecars.
- Escalate to `gpt-5.4` only when the task is cross-cutting, ambiguous, or integration-critical.

Escalate to `gpt-5.4` when one or more of these are true:
- The task changes architecture or data contracts across multiple stages.
- The task requires resolving tradeoffs, not just implementing a known shape.
- The task is the final orchestration layer, such as pipeline sequencing or end-to-end review.
- A cheaper model already produced an unclear or weak result.

Keep `gpt-5.3-codex` when:
- The task is scoped to one route, one utility, one component cluster, or one fixture set.
- The desired output is concrete and already specified by the brief or existing types.
- The main work is editing code rather than deciding product direction.

---

## Suggested Delegation Map

Only use these when delegation is actually warranted.

### Scaffolding

| Agent | Role | Ownership | Model |
|-------|------|-----------|-------|
| `types-worker` | worker | `src/lib/types.ts` | `gpt-5.3-codex` |
| `sources-worker` | worker | `src/lib/sources.ts` | `gpt-5.4-mini` |
| `tinyfish-worker` | worker | `src/lib/tinyfish.ts` | `gpt-5.3-codex` |
| `openai-worker` | worker | `src/lib/openai.ts`, `src/lib/prompts.ts` | `gpt-5.3-codex` |
| `fixtures-worker` | worker | `src/fixtures/*` | `gpt-5.4-mini` |

### API Routes

| Agent | Role | Ownership | Model |
|-------|------|-----------|-------|
| `discover-worker` | worker | `src/app/api/discover/route.ts` | `gpt-5.4-mini` |
| `skills-diff-worker` | worker | `src/app/api/skills-diff/route.ts`, `src/lib/skills-git.ts` | `gpt-5.3-codex` |
| `resolve-worker` | worker | `src/app/api/resolve/route.ts` | `gpt-5.3-codex` |
| `diff-worker` | worker | `src/app/api/diff/route.ts` | `gpt-5.3-codex` |
| `pipeline-worker` | worker | `src/app/api/pipeline/route.ts` | `gpt-5.4` |

### UI

| Agent | Role | Ownership | Model |
|-------|------|-----------|-------|
| `pipeline-ui-worker` | worker | `src/components/Pipeline.tsx`, `src/components/StageNode.tsx` | `gpt-5.3-codex` |
| `diff-ui-worker` | worker | `src/components/DiffView.tsx` | `gpt-5.3-codex` |
| `findings-ui-worker` | worker | `src/components/FindingCard.tsx`, `src/components/ConfidenceBadge.tsx`, `src/components/ProvenanceChain.tsx` | `gpt-5.3-codex` |
| `support-ui-worker` | worker | `src/components/FileUpload.tsx`, `src/components/SourcesPanel.tsx`, `src/components/StageDetail.tsx` | `gpt-5.4-mini` |

### Review And Verification

| Agent | Role | Ownership | Model |
|-------|------|-----------|-------|
| `api-explorer` | explorer | route contracts, payload flow, fallback behavior | `gpt-5.4-mini` |
| `ui-explorer` | explorer | component props, rendering flow, state wiring | `gpt-5.4-mini` |
| `integration-reviewer` | worker | final integration review, no broad rewrites | `gpt-5.4` |

---

## Parallelism Rules

- Stages 1 and 1b can run independently.
- Stage 2 source resolution should run in parallel per source.
- UI component work can be parallelized when write scopes do not overlap.
- Do not parallelize Stage 3 diffing against incomplete Stage 2 output.
- Do not parallelize confidence synthesis before findings are stable.

---

## Implementation Guardrails

- Prefer narrow route handlers and plain TypeScript utilities over framework-heavy abstractions.
- All LLM calls should request strict JSON outputs and validate parse failures with a retry path.
- Use a feedback loop before accepting work as done: run the relevant harness (`lint`, `build`, `verify:pipeline`, focused manual checks), treat failures as input, fix them, and rerun without waiting for human intervention when the correction path is clear.
- Prefer typed boundaries and runtime validation at LLM and route edges. TypeScript catches a class of mistakes early, but model outputs still need schema checks and one corrective retry loop.
- Every live stage needs a fixture fallback that is visibly surfaced in the UI.
- Preserve the hardcoded authoritative source whitelist from [`CLAUDE.md`](./CLAUDE.md).
- Treat TinyFish usage as load-bearing for the demo, but spend credits only where the brief says live scraping matters.
- Keep the mocked apply flow clearly mocked. Show diffs, not silent mutation.
- Treat project-scoped skills as progressive disclosure. Keep only name-and-description registries in repo instructions, and open full `SKILL.md` files only when the active task needs them.
- Do not add verbose keyword-trigger tables for project skills in Codex-facing repo docs. They add session-start context cost without improving Codex's built-in skill workflow.

---

## Verification Checklist

Before closing a substantial task, Codex should verify:

- `npm run lint`
- `npm run build` for integration-sensitive changes
- Fixture fallback path still works when env vars are absent
- SSE event shape matches the frontend consumer
- At least one finding per major tier still renders in the golden path demo

Self-correction loop:
- If `lint` fails, fix the code and rerun `lint`.
- If `build` fails, fix the contract/type/runtime issue and rerun `build`.
- If pipeline verification fails, inspect the failing stage, adjust the contract or fallback path, and rerun verification.
- If browser/manual checks contradict the UI copy, prefer changing the UI to be more truthful rather than explaining the mismatch away.

If a check cannot run, state that explicitly in the final response.
