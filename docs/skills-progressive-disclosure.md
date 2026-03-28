# Skills Progressive Disclosure

## Verification

Codex already uses progressive disclosure for skills.

Evidence from local Codex session metadata under `~/.codex/sessions/...jsonl`:
- the session instructions list skills as `name + description + file path`
- the instructions explicitly say `How to use a skill (progressive disclosure)`
- the workflow says to open `SKILL.md` only after deciding to use the skill

This means Codex itself is not supposed to preload every `SKILL.md` body into context at session start.

## What Was Wrong

The conflicting behavior was not the Codex skill loader. It was the surrounding project and global guidance.

Two sources were adding avoidable overhead:
- repo docs that previously included long skill-trigger tables and synonym examples
- the global file `~/.codex/AGENTS.md`, which previously told project-scoped skills to auto-invoke on keyword triggers and recommended generating project `Skill Triggers` sections

That global guidance conflicts with Codex's built-in progressive-disclosure workflow because it encourages larger project instructions and more auto-trigger text than necessary.

## Repo-Level Fix Applied

This repo now follows a compact policy:
- keep only a short skill registry in project docs
- treat `.codex/skills` as progressive-disclosure material
- open a skill's full `SKILL.md` only when the active task clearly needs it
- avoid verbose keyword-trigger tables in Codex-facing repo docs

Files updated in this repo:
- `CLAUDE.md`
- `CODEX.md`
- `AGENTS.md`
- `.codex/skills/README.md`

## Desired Global Policy

When skills are added for a project, the default should be:

1. Install only the minimum relevant skills into the project-local skill folder.
2. Record only `name + short description` in project instructions.
3. Do not generate large keyword-trigger tables or synonym lists for project skills.
4. Open `SKILL.md` only on demand when a task clearly matches the skill.
5. Keep global skills explicit and project skills lightweight.

## Global Change Applied

The global skill guidance in `~/.codex/AGENTS.md` has now been updated.

Removed:
- project-scoped skills auto-invoke on keyword triggers
- instructions to create project `Skill Triggers` sections
- instructions to generate fuzzy keyword-trigger tables for installed project skills

Replaced with:
- explicit progressive-disclosure guidance
- compact project skill registries
- on-demand opening of `SKILL.md`
- a default rule to keep session-start context minimal

## Recommended Replacement Text

The applied global policy is:

```md
## Skill Invocation Strategy

Use skills with progressive disclosure.

- Global skills: keep explicit and invoke when needed.
- Project-scoped skills: keep project docs compact and list only skill name, short description, and path where relevant.
- Do not generate verbose keyword-trigger tables or synonym lists for project skills.
- When a task clearly matches a skill, open its `SKILL.md` at that point and read only enough to follow the workflow.
- Prefer minimal context at session start; defer full skill bodies until they are actually needed.

## Skill Cherry-Picking For New Projects

When cherry-picking skills for a project:

1. Read project requirements first.
2. Install only skills directly relevant to the stack and likely tasks.
3. Install them into the project-local skill folder.
4. Add a compact skill registry to project docs with name and short description only.
5. Do not add long keyword-trigger tables unless a tool absolutely requires them.
```

## Practical Outcome

For Codex:
- progressive disclosure is already the intended runtime behavior
- the best fix is to reduce instruction bloat around the skills, not to duplicate the skill bodies elsewhere

For this repo:
- that compact pattern is now in place

For the global Codex setup:
- the conflicting auto-trigger guidance has been removed from `~/.codex/AGENTS.md`
