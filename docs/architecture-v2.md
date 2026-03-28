# DriftCheck V2

Specific product framing and technical architecture for the next phase of DriftCheck.
This document extends the current hackathon build. It does not claim that the repo already implements everything below.

## Status

- Current repo: stateless demo pipeline with `discovery` -> `skills-diff` -> `resolution` -> `diff` -> `confidence` -> `output`
- Current strengths: TinyFish integration, OpenAI parsing, fixture fallbacks, transparent degraded-run UI, schema and quality feedback loops
- Current gap: the product is still framed like a pipeline demo, not yet like a durable user-facing assistant

## Market Framing

### Positioning

DriftCheck should be framed as a personal toolchain drift assistant for AI-native developers.

It helps a developer answer:
- what changed in the tools, skills, plugins, and configs I actually use
- which of my current setups are now stale, risky, or out of date
- what should I change, and how confident is the evidence

This is stronger than a generic "fresh docs" product and narrower than a generic "second brain."

### Ideal User

- solo builders and small teams moving quickly across AI tooling
- power users with custom skills, agent configs, plugins, MCP servers, and local knowledge bases
- developers who can tolerate assisted recommendations but do not want silent mutation

### Job To Be Done

When the AI tooling ecosystem changes faster than I can track manually, tell me what in my setup drifted, show me the evidence, and give me a safe next step.

### Core Promise

- personal: anchored to the tools and configs the user actually uses
- truthful: authoritative sources outrank noisy chatter
- actionable: every important finding should end in a concrete next step
- safe: no silent auto-apply, no pretending cached data is live

### Non-Goals

- generic "search all my notes" assistant
- autonomous code mutation bot
- social-media scraping product
- enterprise observability platform

### Behavioral Guidelines For Implementation

- Default to the user's actual toolchain, not the entire market.
- Prefer correctness over coverage, transparency over polish, and suggestion over mutation.
- Use noisy sources only to discover candidates, never to establish truth.
- Spend live scraping budget only after the system knows what it is trying to verify.
- Add persistence only when it unlocks concrete user value: history, watchlists, repeated queries, or scheduled refresh.

## Product Modes

DriftCheck should explicitly support three modes. Keeping them separate avoids a confused UI and keeps the trust model honest.

| Mode | Primary Input | Persistence | Best For | Main Tradeoff |
| --- | --- | --- | --- | --- |
| `Quick Check` | natural-language question, pasted config, uploaded file | none | fast one-off checks | limited memory and no historical context |
| `Repo Diff` | repo URL, repo archive, or later synced local repo | none at first | project-wide drift and submodule inspection | higher latency and more relevance filtering |
| `Connected Workspace` | synced tools, skills, notes, configs, repos | required | recurring monitoring and longitudinal questions | highest infra, privacy, and consent cost |

### `Quick Check`

Use when the user asks something like:
- "is my skill A up to date?"
- "does this config use deprecated OpenAI settings?"

Why it belongs:
- lowest-friction entry point
- preserves the original stateless demo strength

Tradeoffs:
- no memory between runs
- no historical comparison
- user must provide enough context each time

### `Repo Diff`

Use when the user wants to throw in a repository such as `claude-skills` and inspect:
- manifests
- config files
- imported libraries
- submodule drift
- skill markdown changes

Why it belongs:
- materially different input and scope from `Quick Check`
- reuses the existing `skills-git.ts` logic instead of hiding repo analysis inside a vague mode

Tradeoffs:
- slower than `Quick Check`
- more false positives unless inventory is relevance-aware
- browser-only UX cannot read local folders directly, so uploads, Git URLs, or a helper sync are needed

### `Connected Workspace`

Use when the user wants:
- "keep my tools up to date over time"
- "watch my second brain and skills"
- "show me what drifted since last week"

Why it belongs:
- enables history, watchlists, scheduled refresh, and cross-run questions

Tradeoffs:
- requires storage
- requires a consent model and clear retention policy
- turns DriftCheck into a product, not just a demo pipeline

## Shared Architecture

The same logic should power all three modes. The difference is where the subject state comes from and whether it is persisted.

### Stage 0: Intake And Scope Routing

Purpose:
- infer the user's intent
- select the right mode
- determine what the system is actually checking

Inputs:
- natural-language question
- uploaded config or repo
- optional connected workspace identifier

Outputs:
- `mode`
- `subject set`
- `authority candidates`

Tradeoffs:
- broad interpretation feels smart but creates noise
- narrow interpretation may miss related drift

Feedback-loop trigger:
- trigger a scope loop when the subject is too broad, ambiguous, or maps to multiple likely tools

Continue when:
- the subject set is explicit enough to name the target tools, skills, plugins, or files

If the loop fails:
- narrow automatically to the top candidate and mark the run as narrowed, or ask the user a clarifying question if the ambiguity would materially change the result

### Stage 1: Subject Inventory

Purpose:
- determine what the user actually uses

Mode-specific inputs:
- `Quick Check`: parse the pasted file or question for tools, versions, config keys, and skill names
- `Repo Diff`: inspect manifests, imports, config files, `.gitmodules`, and relevant markdown
- `Connected Workspace`: load the latest indexed snapshot for the workspace

Outputs:
- normalized subject inventory

Suggested normalized shape:

```ts
type SubjectInventory = {
  tools: Array<{ name: string; version?: string; evidence: string[] }>
  skills: Array<{ name: string; repo?: string; evidence: string[] }>
  plugins: Array<{ name: string; source?: string; evidence: string[] }>
  configs: Array<{ key: string; value: string; file: string }>
  submodules: Array<{ path: string; pinnedSha?: string; remote?: string }>
}
```

Tradeoffs:
- scanning more files increases recall but also false positives
- restricting to manifests is cheaper but misses actual usage

Feedback-loop trigger:
- trigger an inventory loop when the system finds too many weak candidates or cannot map a candidate to any known authority

Continue when:
- every surfaced subject has at least one concrete evidence trail such as a file path, import, manifest entry, or explicit user mention

If the loop fails:
- downscope to first-order signals only: direct dependencies, explicit config keys, explicit submodules, direct imports

### Stage 2: Candidate Signal Collection

Purpose:
- gather low-trust change signals before spending authority-resolution budget

Allowed sources:
- Hacker News
- trusted git diff signals
- user-supplied post or link lists

Later-only sources:
- additional noisy social sources, but only if policy-compliant and treated as low trust

Outputs:
- candidate entities and candidate claims

Tradeoffs:
- more noisy sources improve recall
- noisy sources materially raise hallucination and prompt-injection risk

Feedback-loop trigger:
- trigger a candidate loop when the signal set is sparse, contradictory, or dominated by unsupported chatter

Continue when:
- the system has enough candidate entities to justify authoritative resolution, or when direct subject inventory already points to authoritative sources and the noisy stage can be skipped

If the loop fails:
- bypass noisy discovery and resolve directly from the subject inventory

### Stage 3: Authoritative Resolution

Purpose:
- verify candidate changes against first-party or clearly versioned sources

Inputs:
- subject inventory
- candidate entities
- hardcoded or registry-backed authority mappings

Execution:
- web sources via TinyFish
- git sources via non-destructive diff

Outputs:
- normalized authoritative changes
- per-source provenance
- degraded/live metadata

Tradeoffs:
- authoritative resolution is slower and costs credits
- broad source fan-out increases latency and failure surface

Feedback-loop trigger:
- trigger a resolution loop when:
  - a source returns malformed content
  - a mapped authority does not mention the target subject
  - two authoritative sources conflict

Continue when:
- every surfaced claim is either backed by an authoritative source or explicitly marked unverified

If the loop fails:
- retry once with a narrower extraction goal
- if still unresolved, degrade that source and lower confidence; do not silently keep going as if the run were fully live

### Stage 4: Drift Diff

Purpose:
- compare the user's current state to the authoritative state

Inputs:
- normalized subject inventory
- normalized authoritative changes

Outputs:
- candidate findings

Tradeoffs:
- earlier diffing is faster but weaker
- waiting for richer evidence is slower but more trustworthy

Feedback-loop trigger:
- schema validation failure
- weak or vague findings
- missing file anchors
- unsupported confidence rationale

Continue when:
- the findings pass both schema validation and quality validation

If the loop fails:
- use the existing corrective retry path in `src/lib/openai.ts`
- if it still fails, surface a stage error or degraded result instead of pretending the findings are trustworthy

### Stage 5: Context7 Cross-Reference

Purpose:
- enrich already-supported findings with current docs and examples
- improve remediation detail
- optionally support confidence scoring when docs align with the authoritative change

Important rule:
- Context7 is not allowed to create a drift finding on its own
- Context7 is supporting evidence, not the source of truth

Inputs:
- schema-valid findings
- authoritative change set

Outputs:
- improved suggested changes
- doc-backed examples
- corroboration notes for confidence scoring

Tradeoffs:
- better remediation quality
- more latency and another dependency
- potential confusion if docs lag or diverge from changelogs

Feedback-loop trigger:
- only trigger Context7 when a finding is valid but remediation is weak, missing, or ambiguous

Continue when:
- Context7 either clarifies the remediation or fails harmlessly

If the loop fails:
- keep the authoritative finding, reduce explanation richness, and mark the run as not doc-enriched

### Stage 6: Confidence And Remediation Synthesis

Purpose:
- assign the final confidence tier and explanation
- decide whether the system can suggest, download, or only warn

Inputs:
- validated findings
- provenance chain
- authoritative corroboration count
- optional Context7 support

Outputs:
- final findings with tiers, provenance, and recommended action type

Recommended decision logic:
- `HIGH`: direct match against authoritative source plus concrete local evidence
- `MEDIUM`: strong authoritative evidence but incomplete local anchoring, or strong local evidence with weaker corroboration
- `LOW`: noisy or indirect evidence only
- `CONFLICT`: authoritative disagreement or materially contradictory evidence

Tradeoffs:
- simple rules are explainable but coarse
- complex scoring feels sophisticated but is harder to debug and trust

Feedback-loop trigger:
- provenance is incomplete
- tier does not match the evidence
- conflict exists but the system still tries to emit a strong recommendation

Continue when:
- every surfaced finding has a defensible tier and provenance chain

If the loop fails:
- lower the tier or convert to `CONFLICT`

### Stage 7: Output And Action Layer

Purpose:
- render results truthfully
- decide how far the product should go operationally

Current actions:
- explain findings
- show provenance
- show degraded/live state
- allow review and download of a suggested file

Future actions:
- export patch package
- open PR draft
- create watch item

Tradeoffs:
- higher automation is attractive
- higher automation raises trust and rollback requirements sharply

Feedback-loop trigger:
- the system cannot tie a proposed mutation to a specific authoritative change and specific local evidence

Continue when:
- the UI explicitly communicates whether the run was live, degraded, partial, or unsupported

If the loop fails:
- keep the result advisory only

## Where Context7 Fits

Context7 belongs after authoritative resolution and after initial diffing, not before.

Recommended placement:
- Stage 4 produces candidate findings from authoritative evidence
- Stage 5 uses Context7 to refine remediation and optionally strengthen confidence reasoning

Why this order is correct:
- it preserves authoritative sources as the truth layer
- it prevents docs retrieval from manufacturing drift
- it keeps Context7 complementary rather than making DriftCheck feel like a duplicate product

Tradeoffs:
- later placement gives less influence over initial extraction
- earlier placement gives more guidance but risks overweighting documentation over release truth

Recommendation:
- start with later-stage enrichment only
- revisit earlier placement only if the product proves it needs doc-derived code examples before diff quality becomes acceptable

## Mode-Specific Architecture

### `Quick Check`

Recommended flow:
1. Stage 0 scope the request from text or a pasted file
2. Stage 1 extract the local subject inventory
3. Stage 3 resolve only the relevant authoritative sources
4. Stage 4 produce findings
5. Stage 5 optionally enrich with Context7
6. Stage 6 and 7 render the answer

Tradeoffs:
- cheapest path
- easiest to explain
- limited because the user must supply the local context every time

Why keep it:
- it remains the fastest demo and the safest default product entry point

### `Repo Diff`

Recommended flow:
1. Stage 0 classify repo input
2. Stage 1 inventory manifests, imports, config files, markdown, and submodules
3. Stage 2 optionally use noisy discovery only for the tools already present in the repo
4. Stage 3 resolve authoritative sources
5. Stage 4 diff repo state against authority state
6. Stage 5 optionally enrich with Context7
7. Stage 6 and 7 output findings and suggested file/package updates

Implementation notes:
- first version should accept GitHub repo URLs or uploaded archives
- submodule analysis should generalize `src/lib/skills-git.ts` instead of remaining hardcoded to `claude-skills/_sources`
- do not mutate pinned SHAs or run destructive git automation

Tradeoffs:
- more useful than a single-file check
- more expensive and prone to false positives
- requires strong relevance filtering to avoid surfacing transitive dependency churn as user-facing drift

### `Connected Workspace`

Recommended flow:
1. Stage 0 resolve query against a workspace
2. Stage 1 load or refresh workspace inventory
3. Stage 3 resolve authoritative sources for watched tools
4. Stage 4 and 5 produce findings plus historical comparison
5. Stage 6 and 7 create watch items, digests, and alerts

Why storage is needed here:
- history
- repeated natural-language queries across prior snapshots
- watchlists
- scheduled refresh
- comparing current state to prior state

Tradeoffs:
- highest user value for retention and recurring use
- highest privacy, storage, and infrastructure cost

## Storage Decision

### No Database Needed Yet

Keep `Quick Check` and the first version of `Repo Diff` stateless.

Why:
- the user already provides the input
- results can be computed in memory
- this preserves the current repo strengths and keeps demo risk low

Tradeoff:
- no history
- no scheduled jobs
- repeated runs do repeated work

### Database Needed For `Connected Workspace`

Once the product stores tools, skills, notes, or repo snapshots over time, a database becomes necessary.

Recommended storage split:
- relational database for workspaces, scans, findings, provenance, and watch items
- object storage for uploaded bundles and raw snapshots
- optional vector or full-text index later for semantic lookups across notes and skill docs

Suggested minimum tables:
- `workspaces`
- `source_connections`
- `scan_runs`
- `file_snapshots`
- `inventory_items`
- `findings`
- `provenance_records`
- `watch_items`

Tradeoffs:
- more infra and security surface
- but necessary for the "second brain" promise to be real

### Cron Jobs

Do not add cron jobs before persistent storage exists.

Reason:
- a stateless cron job with no durable output mostly burns credits

When cron becomes justified:
- refresh watched authorities
- rescan connected workspaces
- compute "what changed since last run"
- send drift digests or alerts

## Implementation Roadmap With Gated Iterations

The next implementation steps should be justified by feedback loops, not by feature appetite.

### Iteration 1: Harden The Current Demo

Build:
- fail-closed pipeline terminal semantics
- discovery fallback reason classification
- truthful per-source provenance for `skills-diff`
- explicit feedback-loop telemetry in stage output

Tradeoff:
- less flashy than adding new modes
- but necessary because all later modes inherit the same trust model

Gate to continue:
- fallback and live runs are clearly distinguished
- `PIPELINE_COMPLETE` is never emitted after critical-stage failure
- the UI matches the actual evidence state

### Iteration 2: Expand `Quick Check`

Build:
- natural-language intent parsing
- subject scoping for questions like "is my skill A up to date?"
- mode router that decides between plain config diff and a targeted drift query

Tradeoff:
- natural-language flexibility improves adoption
- but intent ambiguity can degrade correctness fast

Gate to continue:
- the router can explain what subject it chose
- ambiguous requests are narrowed visibly instead of guessed silently

### Iteration 3: Add `Repo Diff`

Build:
- repo input flow
- inventory stage for manifests, imports, config files, and submodules
- generalized git-diff utility beyond the current fixed `claude-skills` path

Tradeoff:
- large jump in product usefulness
- but a large jump in false-positive risk unless inventory is first-order only at the start

Gate to continue:
- repo scans distinguish direct evidence from inferred evidence
- submodule drift is non-destructive and truthfully reported

### Iteration 4: Add Context7 Enrichment

Build:
- later-stage docs enrichment for supported findings
- remediation detail improvement
- doc-backed confidence notes

Tradeoff:
- better remediation quality
- extra dependency and latency

Gate to continue:
- authoritative sources still determine whether drift exists
- Context7 never manufactures a finding by itself

### Iteration 5: Add `Connected Workspace`

Build:
- workspace model
- snapshot persistence
- optional local sync or Git-backed connection flow
- watchlists and historical comparison

Tradeoff:
- this is the beginning of a real product
- but it is also the point where privacy, auth, and retention become unavoidable engineering work

Gate to continue:
- the product can state what data it stores, for how long, and why
- at least one repeated-query workflow is materially better than stateless mode

## Recommended North Star

The right north star is not "keep up with everything."

The right north star is:

DriftCheck tells you when the toolchain you actually rely on has drifted from current reality, shows the evidence, and gives you a safe next step.

That framing should drive implementation choices:
- user-owned context before market-wide crawling
- authoritative resolution before clever confidence scoring
- reviewable suggestions before auto-mutation
- stateless first, persistence only when it unlocks repeated value
