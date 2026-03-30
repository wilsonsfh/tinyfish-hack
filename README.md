# DriftCheck

DriftCheck is a personal AI assistant for keeping agentic-tool setups current.

If you use Codex, Claude Code, MCP servers, custom skills, plugin ecosystems, and fast-moving AI dependencies, you already know the maintenance problem. Your local setup starts to drift. A setting gets renamed. A skill repo updates examples. A provider changes the recommended API path. A changelog lands, but your config stays the same because nobody has time to watch every source by hand.

DriftCheck checks that gap. It looks at your current local state, checks live authoritative sources on the open web, and tells you what changed, what it affects, and what you should update.

This repo is a hackathon build for the TinyFish x OpenAI Hackathon on March 28, 2026.

If you want the current implementation map, read [`ARCHITECTURE.md`](./ARCHITECTURE.md). If you want the future-facing roadmap, read [`docs/architecture-v2.md`](./docs/architecture-v2.md).

## why this exists

Agentic coding is great at producing code quickly. It also creates a quiet maintenance tax.

People now build around:

- agent configs
- custom skills
- prompt references
- tool-specific conventions
- provider SDKs
- repo-level glue code

That stack changes constantly. The problem usually isn't "I don't know how to code this." The problem is "I don't know what changed three days ago, which parts of my setup are stale, and whether the fix I saw on a random post is actually correct."

DriftCheck is built for that exact job.

## the short version

DriftCheck takes one of three starting points:

1. a natural-language question
2. a pasted or uploaded config or skill file
3. a repo, either from a local folder or a public GitHub URL

Then it does six things:

1. scopes the subject
2. gathers signals
3. checks authoritative sources
4. compares those changes against your local state
5. scores confidence and provenance
6. shows findings and suggested updates

The product is opinionated about one thing: it should be honest. If a run degrades to fallback data, the UI says so. If a source is cached or unavailable, the UI says so. If a repo diff contributes local evidence, that is treated as supplemental evidence, not as the final source of truth.

## what DriftCheck is

DriftCheck is a personal maintenance assistant for AI-native developers.

It is built for people who rely on:

- Claude Code
- Codex
- OpenAI APIs and SDKs
- skill repos
- MCP-friendly workflows
- fast-changing tool references and config conventions

It is meant to answer questions like:

- "Is my OpenAI setup up to date?"
- "Did this repo drift from the current docs?"
- "Which part of my config is stale?"
- "What changed in the tools I actually use?"

## what DriftCheck is not

DriftCheck is not a generic docs chatbot.

It is not a memory product. It does not try to be your second brain.

It is not an autonomous code mutation bot. It does not silently rewrite files, auto-commit changes, or pretend that a suggestion is the same thing as a safe update.

It is a drift checker with receipts.

## product framing

The market story is pretty simple.

In the age of agentic coding, developers don't just manage code. They manage a personal toolchain that includes models, configs, prompts, skills, references, plugins, and repo conventions. That toolchain drifts faster than most people can track manually.

DriftCheck is a personal AI assistant for that maintenance work.

The promise is direct:

"Tell me what in my current setup drifted from reality, show me the evidence, and give me a safe next step."

That matters because the cost of stale setup is real. You lose time chasing changelogs, debugging old examples, or trying to understand whether a breaking change is real or just noisy internet chatter.

## current modes

The app currently supports three entry points.

| Mode | Input | Best use | Directional time savings |
| --- | --- | --- | --- |
| Quick Check | Natural-language question | Fast one-off checks on a tool, skill, dependency, or reference | ~60% less lookup time |
| Config Diff | Uploaded file or pasted text | Comparing local config, notes, or skill files against current reality | ~45% less manual review time |
| Repo Diff | Local folder or public GitHub repo URL | Checking repos, manifests, submodules, and tool references for drift | ~70% less maintenance triage time |

Those percentages are product-direction estimates used in the demo UI. They are not benchmarked claims.

### Quick Check

Quick Check is the fastest path through the product.

You ask a question in plain English, something like:

- "Is my OpenAI setup up to date?"
- "Did LangGraph change recently?"
- "Has everything-claude-code drifted?"

DriftCheck narrows the run to a subject set, picks likely authoritative sources, and runs the same pipeline with that scope.

If you don't upload a config, the app builds a synthetic local baseline from the question. That makes it useful as a stateless check instead of forcing every run to start from a file.

### Config Diff

Config Diff is the most direct mode.

You upload or paste:

- a config file
- a skill file
- notes
- a snippet of local setup

DriftCheck compares that local state against verified changes and produces findings plus suggested edits. This is the mode that feels closest to "tell me exactly what I should fix."

### Repo Diff

Repo Diff is the broadest mode in the current build.

You can point DriftCheck at:

- a local folder
- a public GitHub repo URL

It inventories direct repo evidence such as manifests, imports, markdown, config files, and submodule metadata. Then it checks supported tools against live authoritative sources. Git and submodule drift are useful here, but they are still local evidence. The authoritative truth path is still TinyFish plus OpenAI over supported source pages.

## how it works

The current pipeline has six stages:

1. discovery
2. skills-diff
3. resolution
4. diff
5. confidence
6. output

Here is what each stage does.

### 1. discovery

This stage gathers candidate signals.

Depending on the mode, that means:

- TinyFish scraping a noisy or discovery-oriented source
- deterministic repo inventory for Repo Diff
- Quick Check subject routing

The output is a narrowed list of entities or subjects worth checking.

### 2. skills-diff

This stage looks at git-based evidence, mostly for skill repos and submodules.

It checks local pinned state versus remote drift and turns the useful parts of that diff into structured candidates. This is supplemental evidence. It helps answer "what changed in the repo world around this tool?" before the app goes to the web for confirmation.

### 3. resolution

This is the most important stage.

TinyFish scrapes supported authoritative pages. OpenAI parses those pages into typed changes. The result is a cleaner set of "this actually changed" records with dates, URLs, and provenance.

### 4. diff

OpenAI compares your local state against the resolved changes.

This is where DriftCheck turns source evidence into findings, suggested updates, and practical explanations.

### 5. confidence

This stage enriches findings with trust signals.

It checks provenance, fallback state, and source quality. The point is simple: the app should tell you how much confidence to place in a finding, not just print a nice-looking card.

### 6. output

The last stage prepares the UI output.

You get:

- findings
- source list
- stage detail
- degraded-run honesty
- a diff view

## why TinyFish and OpenAI are central

This project only works because TinyFish and OpenAI are used at the center of the product, not as decoration.

TinyFish does the hard part of getting current information from the open web. It is used in live source discovery and, more importantly, in authoritative source resolution.

OpenAI does the hard part of turning messy inputs into structured decisions:

- extracting entities
- parsing authoritative changes
- comparing those changes to local config or repo state
- generating findings and suggested edits

The product logic depends on both.

The repo does have git-based and repo-based paths, but those are support signals. The main story is still: live web verification with TinyFish, then typed interpretation and comparison with OpenAI.

## current build, by the numbers

These are concrete details from the current implementation:

- 3 user-facing entry modes
- 6 pipeline stages
- 2 external systems at the core, TinyFish and OpenAI
- 1 explicit degraded-run model with visible cached and unavailable source states
- 2 feedback loops at the model boundary, one for schema repair and one for finding-quality repair
- 1 in-memory rate limiter, currently set to 4 pipeline requests per 2 minutes per client, with 1 concurrent full pipeline run per client

In local testing, fallback-heavy runs usually land around 10–20 seconds. Live runs vary more. When upstream calls are slow, they can stretch past 50 seconds. That variance is normal for a product that waits on both live scraping and LLM processing.

## why this is useful

People using agentic tools are doing quiet maintenance work all the time.

They scan changelogs. They re-read docs because examples changed. They compare their setup to a repo they copied three weeks ago. They wonder whether a breaking change is real, whether a new SDK path matters, or whether a random post is ahead of the official docs.

DriftCheck collapses that work into one place.

It saves time, yes, but the bigger value is confidence. You get a narrower search space, a source trail, and a clearer answer about what actually needs attention.

That's a real product surface, especially for:

- solo builders shipping with AI tools every day
- small teams with custom agent workflows
- people maintaining skill libraries and agent configs across multiple projects

## example user flows

### "Is my OpenAI setup up to date?"

You type the question. Quick Check scopes it to OpenAI-related subjects. TinyFish checks supported OpenAI sources. OpenAI parses the resulting changes and compares them against any config you uploaded, or against a synthetic baseline if you didn't upload anything. The output shows the findings and the source trail.

### "Here is my skill file, tell me what drifted"

You paste or upload the skill file. DriftCheck resolves the relevant tool references, checks live sources, and then tells you what in the file looks stale or mismatched.

### "Check this repo"

You choose a local folder or paste a public GitHub URL. DriftCheck inventories the repo, checks submodule and git signals, identifies supported tool subjects, and then runs those subjects through live authoritative verification.

## honesty and fallback behavior

The app is designed to degrade visibly.

That means:

- cached sources are marked as cached
- unavailable sources are marked as unavailable
- degraded stages are named explicitly
- fallback reasons are surfaced in the UI

If the app cannot produce a trustworthy live payload, it does not quietly pretend everything is fine.

That choice matters for the demo and for the product. A drift checker that hides degraded runs is not useful.

## current constraints

This is still a hackathon build. The current repo is intentionally narrow.

Right now it is:

- stateless
- database-free
- without a separate backend service
- without destructive git automation
- without silent auto-apply

You can download suggested updates from the diff view, but the app does not directly mutate your local files.

## local development

Install dependencies and start the app:

```bash
npm install
npm run dev
```

Optional live credentials:

- `OPENAI_API_KEY`
- `TINYFISH_API_KEY`

Without those keys, the app can still run in fallback mode for development and demo use.

### useful commands

```bash
npm run lint
npm run build
npm run verify:pipeline
```

## recommended demo path

For a 4-minute demo, pick one path and run it cleanly.

The best flow is usually:

1. say the problem in one sentence
2. run Quick Check, Config Diff, or Repo Diff
3. show the pipeline briefly
4. show the findings
5. open the sources tab and show provenance
6. close on why this matters for developers using agentic tooling every day

If live sources degrade during the demo, lean into the honesty model and show the cached/unavailable source states. That is part of the product story.

## pre-existing work disclosure

If you are submitting this project for judging, be explicit about what existed before the hackathon and what was built during it.

Reasonable examples of hackathon-day contributions in this repo include:

- fixing the OpenAI prompt and parser contract
- adding source-specific fallback fixtures
- implementing transparent degraded-run UI
- adding schema and quality feedback loops
- adding Quick Check
- adding Repo Diff
- adding GitHub URL repo input
- adding rate limiting
- tightening the product framing and demo flow

Adjust that list to match what your team actually built.

## where this can go next

The next obvious extension is later-stage cross-reference with systems like Context7 for remediation help and confidence support. That belongs after authoritative verification, not before it.

There is also room for a broader product here. People are building personal AI toolchains now, not just apps. A personal assistant that helps keep those toolchains current is a pretty natural product once enough people feel the maintenance pain.

For now, DriftCheck is focused on one thing: tell me what drifted, tell me why you think so, and don't lie about the evidence.
