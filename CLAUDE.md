# DriftCheck

Hackathon project: AI tooling drift detector using TinyFish live scraping + OpenAI GPT-4o.
**Event:** TinyFish × OpenAI Hackathon, March 28 2026, Singapore, 6 hours. Solo (Wilson).

Current repo scope is the stateless hackathon build. For the next-phase product framing, three-mode architecture, Context7 placement, and storage roadmap, see [`docs/architecture-v2.md`](./docs/architecture-v2.md).

---

## How to Navigate This Repo

1. Read [`ARCHITECTURE.md`](./ARCHITECTURE.md) first — it is the current-state codemap. Use it to find where logic lives before changing anything.
2. Read this file (`CLAUDE.md`) for product brief, scope constraints, and conventions.
3. Read [`docs/architecture-v2.md`](./docs/architecture-v2.md) only when the task touches future product direction.

---

## Skill Registry

Project-scoped skills should use progressive disclosure: load only the skill name and short description at session start, and open the full `SKILL.md` only when the current task clearly needs it.

- `coding-standards`: use for TypeScript contracts, schemas, and predictable data flow
- `backend-patterns`: use for API routes, server utilities, and orchestration logic
- `frontend-patterns`: use for React/Next.js UI structure and rendering patterns
- `cost-aware-llm-pipeline`: use for model routing, spend control, and fallback decisions
- `strategic-compact`: use for long sessions or context-pressure management

Keyword matching may stay fuzzy, but keep trigger guidance compact. Do not inline full skill bodies or long synonym tables in this file.

---

## Stack

- **Next.js 14+** App Router, TypeScript, Tailwind CSS
- **TinyFish API** for web scraping (env: `TINYFISH_API_KEY`) — central, load-bearing, judges will verify
- **OpenAI GPT-4o** for reasoning: entity extraction, authoritative parsing, config diff (env: `OPENAI_API_KEY`)
- **OpenAI Codex** for patch generation — MOCKED for demo (show diff, Apply button non-functional)
- **No database.** Stateless. No separate backend service.

---

## Architecture: 6-Stage Pipeline

```
Stage 1: Discovery       — TinyFish scrapes HN front page → GPT-4o extracts entities
Stage 1b: Skills Diff    — git fetch submodules, diff SKILL.md changes → GPT-4o extracts entities (free, no TinyFish)
Stage 2: Resolution      — TinyFish scrapes authoritative whitelist URLs in parallel → GPT-4o parses
Stage 3: Diff            — GPT-4o compares authoritative findings against user's uploaded config
Stage 4: Confidence Tier — Each finding gets HIGH/MEDIUM/LOW/CONFLICT + justification
Stage 5: Output          — Changelog digest + split-pane diff view + mocked Apply button
```

Stages 1 and 1b run in parallel. Stage 2 resolves sources in parallel. Stage 3 depends on Stage 2 output.

### Three Entry Modes

| Mode | Input | Output |
|------|-------|--------|
| **Quick Check** | Natural-language question | Advisory recommendations (no patch unless config also uploaded) |
| **Config Diff** | Uploaded/pasted config file | Real split-pane diff view with suggested edits |
| **Repo Diff** | Local folder or public GitHub URL | Repo-aware recommendations (advisory only, no fake patch) |

All three modes share the same 6-stage pipeline. Mode affects scope inference and output rendering, not the pipeline structure.

### Source Trust Tiers
| Source | Tier | Rationale |
|--------|------|-----------|
| Official changelog / GitHub Releases (semver + date) | HIGH | First-party, versioned |
| `anthropics/skills` repo updates | HIGH | Anthropic-owned repo |
| `obra/superpowers`, `neolab-context-kit`, `everything-claude-code` diffs | MEDIUM | Community-maintained, versioned |
| HN front page mentions | LOW → validates to MEDIUM/HIGH via Stage 2 |
| CONFLICT: noisy source claims X, authoritative says otherwise | CONFLICT | Flag prominently |

### Authoritative Source Whitelist (hardcoded)
```typescript
const AUTHORITATIVE_SOURCES = {
  openai:          { url: "https://platform.openai.com/docs/changelog",               tier: "HIGH",   label: "OpenAI Platform Changelog" },
  "openai-cookbook":{ url: "https://github.com/openai/openai-cookbook",               tier: "MEDIUM", label: "OpenAI Cookbook" },
  langgraph:       { url: "https://github.com/langchain-ai/langgraph/releases",       tier: "HIGH",   label: "LangGraph Releases" },
  instructor:      { url: "https://github.com/instructor-ai/instructor/releases",     tier: "HIGH",   label: "Instructor Releases" },
  crewai:          { url: "https://github.com/crewAIInc/crewAI/releases",             tier: "HIGH",   label: "CrewAI Releases" },
  // Skills repos (git diff, not TinyFish)
  "anthropics-skills": { repo: "anthropics/skills",                                   tier: "HIGH",   label: "Anthropic Official Skills" },
  "obra-superpowers":  { repo: "obra/superpowers",                                    tier: "MEDIUM", label: "Obra Superpowers" },
  "ecc":               { repo: "affaan-m/everything-claude-code",                     tier: "MEDIUM", label: "Everything Claude Code" },
} as const;
```

### Skills Repo Integration (Stage 1b)
- Location: `~/Downloads/Projects/claude-skills/_sources/`
- Process: `git fetch` per submodule → `git diff PINNED..origin/main -- '*.md'` → feed to GPT-4o entity extraction
- No TinyFish calls needed. Free discovery source.
- Git diff gives: changed skill files, commit messages, version bumps, breaking change notes

---

## Key Files

For the full codemap see [`ARCHITECTURE.md`](./ARCHITECTURE.md). Core files:

```
src/app/api/pipeline/route.ts       # Top-level SSE orchestrator — start here for pipeline changes
src/app/api/discover/route.ts       # Stage 1: noisy discovery
src/app/api/skills-diff/route.ts    # Stage 1b: git/submodule evidence
src/app/api/resolve/route.ts        # Stage 2: authoritative resolution
src/app/api/diff/route.ts           # Stage 3: drift diff
src/app/api/repo-inventory/route.ts # Repo Diff inventory
src/app/api/repo-upload/route.ts    # Local folder upload materialization
src/app/page.tsx                    # Main UI, SSE handling, mode orchestration, client sanitization

src/lib/types.ts                    # All TypeScript types — read before adding new shapes
src/lib/openai.ts                   # Model calls, validation, feedback loops, finding normalization
src/lib/prompts.ts                  # All GPT-4o prompts — edit here, not in routes
src/lib/tinyfish.ts                 # TinyFish client wrapper
src/lib/fallbacks.ts                # Fallback classification and authoritative change normalization
src/lib/feedback-loops.ts          # Feedback-loop summary helpers
src/lib/sources.ts                  # Authoritative source whitelist + skills repos
src/lib/quick-check.ts              # Scope inference and narrowing for Quick Check mode
src/lib/repo-diff.ts                # Repo materialization, inventory, subject detection
src/lib/skills-git.ts               # git diff and submodule evidence extraction
src/lib/rate-limit.ts               # In-memory rate limiting

scripts/verify-pipeline.mjs        # Pipeline harness verification script

src/fixtures/parsed-authoritative.ts # Deterministic parsed fallback for Stage 2 (no OpenAI dep)
```

---

## Harness Engineering Boundaries

The repo has four active harness boundaries. Do not break them when making changes.

| Boundary | What it guards | Key files |
|----------|---------------|-----------|
| **Model boundary** | JSON parse + schema validation + one corrective retry before accepting LLM output | `src/lib/openai.ts`, `src/lib/prompts.ts`, `src/lib/types.ts` |
| **External API** | TinyFish and git calls degrade visibly via fixture fallback; `source: "live"/"cached"/"unavailable"` surfaced in UI | `src/lib/tinyfish.ts`, `src/lib/fallbacks.ts`, route files |
| **UI boundary** | Page-level sanitization before UI state is set; no raw LLM payload rendered directly | `src/app/page.tsx`, `src/components/FindingCard.tsx`, `src/components/DiffView.tsx` |
| **Verification** | `lint → build → verify:pipeline` before closing any pipeline-affecting task | `scripts/verify-pipeline.mjs` |

---

## Verification Commands

Run these in order after any pipeline-touching change:

```bash
npm run lint                 # must pass
npm run build                # must pass
npm run verify:pipeline      # run when pipeline behavior changes
```

Self-correction loop: if a check fails, fix the issue and rerun — do not skip or bypass.

---

## Current Invariants

Rules that must hold when modifying the code:

- The main truth path is TinyFish + OpenAI. Repo diffs are supplementary context.
- Fallback state (`source: "cached"`) must remain visible in the UI — never silently degrade.
- `Quick Check` without uploaded config → advisory recommendations only, no patch rendering.
- `Repo Diff` without uploaded config → advisory only, no fake patch rendering.
- Only findings with `replacement_text` should modify the suggested config file in diff view.
- LLM outputs must be validated and normalized server-side before the client renders them.

---

## Current Known Gaps

- Multiple findings on the same line collapse to one applied edit in the patch view.
- TinyFish live timeout is fixed at 20 seconds (no per-source dynamic timeout).
- No live authoritative response cache.
- `repo-upload` route still triggers a Turbopack/NFT trace warning.

---

## Conventions

- All GPT-4o calls return JSON. Always `JSON.parse` with try/catch + one retry. Fall back to fixture.
- TinyFish calls: always check `status === "COMPLETED"` before using `result`.
- SSE stream from `/api/pipeline` to frontend for real-time pipeline stage updates.
- Confidence tier justifications are **1-sentence strings**, not numbers.
- Skills repo path: `~/Downloads/Projects/claude-skills/_sources/` — do not hardcode user home, use `process.env.SKILLS_REPO_PATH` or resolve at runtime.
- UI: dark theme, monospace-forward. Pipeline visualization is the hero. Diff view is secondary.
- TinyFish `browser_profile`: `"lite"` for normal sites, `"stealth"` for bot-protected sites.

---

## Skill Cherry-Picking (run at project start)

When asked to cherry-pick skills for a project:
1. Read project requirements first (brief, CLAUDE.md, AGENTS.md)
2. Select only skills directly relevant to the tech stack and tasks
3. Install into `.claude/skills/` inside the project root — **never** `~/.claude/skills/`
4. Skills are progressive disclosure by default — name+description only until invoked via Skill tool
5. Do NOT install project skills globally; they must be scoped to the project directory

```bash
# Correct install path
mkdir -p .claude/skills
cp -r ~/Downloads/Projects/claude-skills/_sources/<repo>/skills/<skill-name> .claude/skills/
```

---

## Do NOT

- Add a database
- Add a separate FastAPI/Express service
- Scrape Twitter/X or Discord
- Auto-apply code changes (mock it — show diff, button is non-functional)
- Over-engineer error handling outside the demo happy path
- Use `git submodule update --remote` destructively — use `git fetch` + diff only, don't mutate pinned SHAs
- Spend TinyFish credits on sources that have git repos (use git diff instead)

---

## GPT-4o Prompts (in src/lib/prompts.ts)

### Prompt 1 — Entity Extraction (Stage 1 + 1b)
```
You are analyzing content from a tech source (HackerNews / skill repo git diffs).
Extract named entities related to AI tooling, agent workflows, developer infrastructure.
For each entity return: name, category (model|api_parameter|framework|pattern|config|library), signal_strength (mentions/upvotes proxy), context (1-sentence).
Return ONLY valid JSON array. No markdown, no preamble.
```

### Prompt 2 — Authoritative Parsing (Stage 2)
```
You are reading content from an authoritative source (official changelog / GitHub releases / Anthropic skills repo).
For each change: entity, change_type (breaking|additive|deprecation|best_practice), description (1-2 sentences), date (ISO), version, source_url.
Return ONLY valid JSON array.
```

### Prompt 3 — Config Diff (Stage 3)
```
Compare developer config against authoritative findings.
Identify: what's affected, whether it's outdated/deprecated/missing/renamed, the specific line/section, the suggested change.
Return ONLY valid JSON array of Finding objects.
```

---

## Post-Hackathon State

Hackathon completed March 28 2026. The build is functional. All pre-work items were completed during the Codex phase. Subsequent work with Claude Code should focus on iteration, correctness, and addressing the **Current Known Gaps** listed above.
