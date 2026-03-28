import type {
  AuthoritativeSource,
  AuthoritativeSourceWeb,
  AuthoritativeSourceGit,
} from "./types";

// ---------------------------------------------------------------------------
// Authoritative source whitelist
// Web sources are scraped via TinyFish; git sources are diffed via git only.
// ---------------------------------------------------------------------------

export const AUTHORITATIVE_SOURCES = {
  openai: {
    type: "web",
    url: "https://platform.openai.com/docs/changelog",
    tier: "HIGH",
    label: "OpenAI Platform Changelog",
    browser_profile: "lite",
  },
  "openai-cookbook": {
    type: "web",
    url: "https://github.com/openai/openai-cookbook",
    tier: "MEDIUM",
    label: "OpenAI Cookbook",
    browser_profile: "lite",
  },
  langgraph: {
    type: "web",
    url: "https://github.com/langchain-ai/langgraph/releases",
    tier: "HIGH",
    label: "LangGraph Releases",
    browser_profile: "lite",
  },
  instructor: {
    type: "web",
    url: "https://github.com/instructor-ai/instructor/releases",
    tier: "HIGH",
    label: "Instructor Releases",
    browser_profile: "lite",
  },
  crewai: {
    type: "web",
    url: "https://github.com/crewAIInc/crewAI/releases",
    tier: "HIGH",
    label: "CrewAI Releases",
    browser_profile: "lite",
  },
  "anthropics-skills": {
    type: "git",
    repo: "anthropics/skills",
    submodule_path: "anthropics-skills",
    tier: "HIGH",
    label: "Anthropic Official Skills",
  },
  "obra-superpowers": {
    type: "git",
    repo: "obra/superpowers",
    submodule_path: "obra-superpowers",
    tier: "MEDIUM",
    label: "Obra Superpowers",
  },
  ecc: {
    type: "git",
    repo: "affaan-m/everything-claude-code",
    submodule_path: "everything-claude-code",
    tier: "MEDIUM",
    label: "Everything Claude Code",
  },
} as const satisfies Record<string, AuthoritativeSource>;

// ---------------------------------------------------------------------------
// Filtered views
// ---------------------------------------------------------------------------

export const WEB_SOURCES = Object.fromEntries(
  Object.entries(AUTHORITATIVE_SOURCES).filter(
    ([, source]) => source.type === "web"
  )
) as Record<string, AuthoritativeSourceWeb>;

export const GIT_SOURCES = Object.fromEntries(
  Object.entries(AUTHORITATIVE_SOURCES).filter(
    ([, source]) => source.type === "git"
  )
) as Record<string, AuthoritativeSourceGit>;

// ---------------------------------------------------------------------------
// Noisy discovery source — HN front page (Stage 1, TinyFish scrape)
// Not authoritative; signals are validated against AUTHORITATIVE_SOURCES in Stage 2.
// ---------------------------------------------------------------------------

export const NOISY_SOURCES = {
  hn: {
    type: "web",
    url: "https://news.ycombinator.com",
    tier: "LOW",
    label: "HackerNews Front Page",
    browser_profile: "lite",
  },
} as const satisfies Record<string, AuthoritativeSourceWeb>;
