# DriftCheck architecture

This document is the current-state codemap for the repo at:

`/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack`

It is meant to answer two questions quickly:

1. "How does the system work today?"
2. "Where exactly does that logic live?"

This is different from [`docs/architecture-v2.md`](./docs/architecture-v2.md). That file is the forward-looking product and roadmap doc. This file is the current implementation map.

## system shape

DriftCheck is a stateless Next.js app that checks drift between a user's current AI-tooling setup and current source evidence.

It supports three entry modes:

- `Quick Check`: start from a natural-language question
- `Config Diff`: start from pasted or uploaded local config or notes
- `Repo Diff`: start from a local repo folder or a public GitHub repo URL

The runtime pipeline is still one shared six-stage flow:

1. `discovery`
2. `skills-diff`
3. `resolution`
4. `diff`
5. `confidence`
6. `output`

## harness engineering, as implemented here

The repo already follows a harness-engineering pattern in a few concrete places.

### 1. model boundary harness

LLM output is not trusted just because it is JSON.

Current guardrails:

- JSON parse with one corrective retry
- schema validation on extracted payloads
- quality validation for findings
- one corrective feedback loop when schema fails
- one corrective feedback loop when quality fails
- server-side normalization before the client renders findings

Code:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/openai.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/prompts.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/types.ts`

### 2. external API harness

TinyFish and git-based inputs degrade visibly instead of silently.

Current guardrails:

- per-stage fallback classification
- fixture-backed degraded paths
- source metadata includes `live`, `cached`, or `unavailable`
- fallback reasons are exposed in the UI
- Stage 2 fixture fallback no longer depends on OpenAI

Code:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/tinyfish.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/fallbacks.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/discover/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/resolve/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/skills-diff/route.ts`

### 3. UI boundary harness

The browser does not render raw LLM payloads directly anymore.

Current guardrails:

- page-level finding and source sanitization before UI state is set
- defensive rendering around invalid tiers, provenance, and missing URLs
- patch-like diff UI only for real uploaded config baselines
- advisory-only rendering for Quick Check without config and Repo Diff inventory runs

Code:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/page.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/ConfidenceBadge.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/FindingCard.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/ProvenanceChain.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/SourcesPanel.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/DiffView.tsx`

### 4. verification harness

The expected development loop in this repo is:

1. make the smallest plausible change
2. run `npm run lint`
3. run `npm run build`
4. run `npm run verify:pipeline` when pipeline behavior changes
5. treat failures as input and correct them before moving on

Code:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/scripts/verify-pipeline.mjs`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/AGENTS.md`

## runtime flow

### request entry

The browser sends one request to `/api/pipeline`. That route orchestrates everything else and streams progress back as SSE.

Primary entrypoint:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/pipeline/route.ts`

What it does:

- infers `Quick Check` scope
- materializes repo input for `Repo Diff`
- runs `discovery` and `skills-diff` in parallel
- runs `resolution`
- runs `diff`
- enriches `confidence`
- sends final findings and sources to the UI

### stage 1: discovery

Two possible implementations exist:

- noisy web discovery
- deterministic repo inventory

Files:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/discover/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/repo-inventory/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/repo-diff.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/quick-check.ts`

### stage 1b: skills-diff

This stage collects git and submodule evidence. It is supportive context, not the final truth path.

Files:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/skills-diff/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/skills-git.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/repo-diff.ts`

### stage 2: resolution

This is the authoritative source step.

Files:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/resolve/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/tinyfish.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/openai.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/fallbacks.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/sources.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/parsed-authoritative.ts`

### stage 3: diff

This stage compares local state against resolved authoritative changes.

Files:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/diff/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/openai.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/prompts.ts`

### stage 4: confidence

This is lightweight enrichment and provenance completion, not a separate model call.

Files:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/pipeline/route.ts`

### stage 5: output

The final SSE payload lands in the client and gets rendered into tabs.

Files:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/page.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/Pipeline.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/StageNode.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/FindingCard.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/DiffView.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/SourcesPanel.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/StageDetail.tsx`

## mode behavior

### Quick Check

What it is:

- natural-language scoped entry point into the same pipeline

Where it lives:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/quick-check.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/page.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/pipeline/route.ts`

Current output behavior:

- advisory recommendations when no uploaded config exists
- patch-like diff only when paired with a real uploaded config

### Config Diff

What it is:

- uploaded or pasted text used as the editable local baseline

Where it lives:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/FileUpload.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/page.tsx`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/diff/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/DiffView.tsx`

Current output behavior:

- real split-pane diff view
- only findings with `replacement_text` modify the suggested file
- advisory findings still appear, but they do not mutate the patch output

### Repo Diff

What it is:

- repo inventory plus optional git/submodule evidence, then authoritative verification

Where it lives:

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/repo-diff.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/repo-inventory/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/skills-diff/route.ts`
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/pipeline/route.ts`

Current output behavior:

- repo-aware recommendations
- no fake patch rendering when there is no editable uploaded config

## codemap by file

This section is the literal file-level map of the current repo. It focuses on meaningful code and documentation files, not generated artifacts like `.tsbuildinfo` or `.DS_Store`.

### root docs and config

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/README.md`: product framing, setup, demo guidance
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/ARCHITECTURE.md`: current-state architecture and codemap
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/AGENTS.md`: repo-specific Codex execution guide
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/CLAUDE.md`: product brief and hackathon constraints
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/CODEX.md`: local Codex-facing notes
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/.env.example`: env var template
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/package.json`: scripts and dependencies
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/package-lock.json`: locked dependency tree
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/next.config.ts`: Next.js config
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/tsconfig.json`: TypeScript config
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/eslint.config.mjs`: ESLint config
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/postcss.config.mjs`: PostCSS config
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/next-env.d.ts`: Next.js type declarations
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/.gitignore`: git ignore rules

### docs

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/docs/architecture-v2.md`: future-facing product and architecture roadmap
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/docs/skills-progressive-disclosure.md`: skill-loading guidance

### scripts

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/scripts/verify-pipeline.mjs`: pipeline harness verification script

### app shell

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/layout.tsx`: root layout and metadata
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/page.tsx`: main client UI, SSE handling, mode orchestration, client-side sanitization
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/globals.css`: global styling
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/favicon.ico`: app icon

### API routes

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/pipeline/route.ts`: top-level SSE orchestrator
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/discover/route.ts`: noisy discovery route
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/skills-diff/route.ts`: git/submodule evidence route
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/resolve/route.ts`: authoritative resolution route
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/diff/route.ts`: drift-diff route
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/repo-inventory/route.ts`: repo inventory route for Repo Diff
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/app/api/repo-upload/route.ts`: local folder upload materialization route

### UI components

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/Pipeline.tsx`: stage pipeline visualization (light theme)
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/StageNode.tsx`: one pipeline stage node (light theme)
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/FileUpload.tsx`: config upload and sample loader (light theme)
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/FindingCard.tsx`: finding card with provenance toggle (light theme)
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/RunSummary.tsx`: natural-language summary tab — headline sentence, impact groups, source quality bar
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/ConfidenceBadge.tsx`: reusable confidence badge
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/ProvenanceChain.tsx`: provenance chain UI
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/DiffView.tsx`: editable diff view plus advisory recommendation view
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/SourcesPanel.tsx`: source transparency table
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/components/StageDetail.tsx`: per-stage inspection panel (light theme, sectioned)

### library code

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/types.ts`: core runtime and contract types
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/sources.ts`: authoritative source registry
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/tinyfish.ts`: TinyFish client wrapper
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/openai.ts`: model calls, validation, feedback loops, finding normalization
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/prompts.ts`: model prompts and diff prompt template
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/fallbacks.ts`: fallback classification and authoritative change normalization
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/feedback-loops.ts`: feedback-loop summary helpers
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/quick-check.ts`: scope inference and narrowing logic
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/repo-diff.ts`: repo materialization, inventory, subject detection, repo-scope building
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/skills-git.ts`: git diff and submodule evidence extraction
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/lib/rate-limit.ts`: in-memory single-instance rate limiting

### fixtures

- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-config.ts`: imported sample config string
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-config.txt`: file-backed sample config
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-hn-scrape.json`: discovery fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-skills-diff.json`: skills-diff fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-openai-changelog.json`: raw authoritative scrape fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-openai-cookbook.json`: raw authoritative scrape fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-langgraph-releases.json`: raw authoritative scrape fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-instructor-releases.json`: raw authoritative scrape fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/sample-crewai-releases.json`: raw authoritative scrape fixture
- `/Users/WilsonSoon/Downloads/tinyfish/tinyfish-hack/src/fixtures/parsed-authoritative.ts`: deterministic parsed fallback changes for Stage 2

## current invariants

These are the rules that currently matter most if you change the code:

- The main truth path is TinyFish plus OpenAI, not repo diffs alone.
- Fallback state must stay visible in the UI.
- `Quick Check` without uploaded config is advisory-only.
- `Repo Diff` without uploaded config is advisory-only.
- Only findings with `replacement_text` should modify the suggested config file.
- LLM outputs should be validated and normalized before client rendering.

## current known gaps

These are the main remaining correctness and architecture gaps:

- multiple findings on the same line still collapse to one applied edit in the patch view
- TinyFish live timeout is still fixed at 20 seconds
- there is still no live authoritative response cache
- `repo-upload` still triggers the existing Turbopack/NFT trace warning
- TinyFish timeout classification was fixed: `AbortSignal.timeout()` throws a `DOMException` with `name="TimeoutError"` and `message="The operation was aborted."` — the string `"TinyFish timeout:"` is now prepended during normalization in `tinyfish.ts` (`normalizeRejectionError`) and `discover/route.ts` catch blocks so `classifyTinyFishFallbackReason` correctly routes them to `tinyfish_timeout`

## how to use this document

If you are changing the repo:

1. read this file first for the current codemap
2. read [`AGENTS.md`](./AGENTS.md) for execution rules
3. read [`docs/architecture-v2.md`](./docs/architecture-v2.md) only when the task touches future product direction

If you add, remove, or move a core file, update this codemap in the same change.

