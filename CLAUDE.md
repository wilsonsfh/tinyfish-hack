# DriftCheck

Hackathon project: AI tooling drift detector using TinyFish live scraping + OpenAI GPT-4o.
**Event:** TinyFish × OpenAI Hackathon, March 28 2026, Singapore, 6 hours. Solo (Wilson). Goal: 1st place.

Current repo scope is the stateless hackathon build. For the next-phase product framing, three-mode architecture, Context7 placement, and storage roadmap, see [`docs/architecture-v2.md`](./docs/architecture-v2.md).

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

## Architecture: 5-Stage Pipeline

```
Stage 1: Discovery       — TinyFish scrapes HN front page → GPT-4o extracts entities
Stage 1b: Skills Diff    — git fetch submodules, diff SKILL.md changes → GPT-4o extracts entities (free, no TinyFish)
Stage 2: Resolution      — TinyFish scrapes authoritative whitelist URLs in parallel → GPT-4o parses
Stage 3: Diff            — GPT-4o compares authoritative findings against user's uploaded config
Stage 4: Confidence Tier — Each finding gets HIGH/MEDIUM/LOW/CONFLICT + justification
Stage 5: Output          — Changelog digest + split-pane diff view + mocked Apply button
```

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

```
src/
├── app/
│   ├── page.tsx                    # Main pipeline UI
│   └── api/
│       ├── pipeline/route.ts       # Orchestrator — SSE stream, runs all stages
│       ├── discover/route.ts       # Stage 1: TinyFish HN scrape + GPT-4o entity extraction
│       ├── skills-diff/route.ts    # Stage 1b: git submodule diff + GPT-4o extraction
│       ├── resolve/route.ts        # Stage 2: TinyFish authoritative scrape + GPT-4o parse
│       └── diff/route.ts           # Stage 3: GPT-4o config diff
├── lib/
│   ├── tinyfish.ts                 # TinyFish API client
│   ├── openai.ts                   # GPT-4o client
│   ├── prompts.ts                  # All GPT-4o prompts as template literals
│   ├── sources.ts                  # Authoritative source whitelist + skills repos
│   ├── skills-git.ts               # git submodule fetch + diff extraction
│   └── types.ts                    # TypeScript types
├── components/
│   ├── Pipeline.tsx                # 5-stage pipeline visualization
│   ├── StageNode.tsx               # idle/running/complete state per stage
│   ├── DiffView.tsx                # Split-pane diff viewer
│   ├── FindingCard.tsx             # Finding + confidence badge + provenance
│   ├── ConfidenceBadge.tsx         # GREEN/AMBER/GRAY/RED-OUTLINE badges
│   ├── ProvenanceChain.tsx         # Source trail: HN → changelog → config → fix
│   ├── SourcesPanel.tsx            # All scraped URLs with timestamps
│   ├── FileUpload.tsx              # Config file upload/paste
│   └── StageDetail.tsx             # Raw I/O inspector per stage
└── fixtures/
    ├── sample-hn-scrape.json       # Cached HN scrape (fallback)
    ├── sample-openai-changelog.json # Cached changelog scrape (fallback)
    ├── sample-skills-diff.json     # Cached submodule diffs (fallback)
    └── sample-config.md            # Golden-path AGENTS.md for demo
```

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

## Pre-Work Checklist (before hackathon day)

- [ ] Next.js project scaffolded with Tailwind + TypeScript
- [ ] `src/lib/types.ts` — all TypeScript types defined
- [ ] `src/lib/prompts.ts` — all 3 GPT-4o prompts written and tested
- [ ] `src/lib/tinyfish.ts` — TinyFish client with error handling
- [ ] `src/lib/skills-git.ts` — git diff extraction utility
- [ ] `src/lib/sources.ts` — authoritative whitelist
- [ ] `src/fixtures/` — cached JSON for all sources (HN, changelog, skills diff, sample config)
- [ ] Pipeline UI shell — 5 connected nodes, idle/running/complete states
- [ ] DiffView, FindingCard, ConfidenceBadge components
- [ ] Golden-path demo config files (AGENTS.md with outdated patterns)
- [ ] End-to-end test of prompts against fixture data
