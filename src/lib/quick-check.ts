import { AUTHORITATIVE_SOURCES } from "./sources"
import type { AuthoritativeChange, Entity, QuickCheckScope } from "./types"

const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "be",
  "check",
  "compare",
  "config",
  "current",
  "does",
  "for",
  "from",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "local",
  "me",
  "my",
  "of",
  "on",
  "or",
  "out",
  "tell",
  "the",
  "this",
  "to",
  "up",
  "use",
  "using",
  "what",
  "whether",
  "with",
  "would",
])

type SourceCandidate = {
  key: string
  label: string
  subject: string
  aliases: string[]
}

function normalize(value: string): string {
  return value.toLowerCase().trim()
}

function tokenize(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9.+/_-]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOPWORDS.has(token))
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function extractQuotedSubjects(query: string): string[] {
  return [...query.matchAll(/["“]([^"”]{2,80})["”]/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}

function extractNamedSubjects(query: string): string[] {
  return [...query.matchAll(/\b(skill|plugin|tool|dependency|extension|library|repo(?:sitory)?)\s+([a-zA-Z0-9._/+:-]{2,80})/g)]
    .map((match) => match[2].trim())
    .filter(Boolean)
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle || needle.length < 2) return 0
  let count = 0
  let index = 0

  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1
    index += needle.length
  }

  return count
}

function buildSourceCandidates(): SourceCandidate[] {
  return Object.entries(AUTHORITATIVE_SOURCES).map(([key, source]) => {
    const subject = key
      .replace(/[-_/]+/g, " ")
      .replace(/\b(changelog|releases?|cookbook|official|skills?)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim() || source.label
    const aliasTerms = unique(
      [
        key,
        subject,
        source.label,
        "repo" in source ? source.repo : "",
        "url" in source ? source.url : "",
        ...tokenize(key),
        ...tokenize(source.label),
        ...("repo" in source ? tokenize(source.repo) : []),
        ...("url" in source ? tokenize(source.url.replace(/^https?:\/\//, "")) : []),
      ]
        .map((alias) => normalize(alias))
        .filter((alias) => alias.length > 1)
    )

    return {
      key,
      label: source.label,
      subject,
      aliases: aliasTerms,
    }
  })
}

function scoreSourceCandidate(candidate: SourceCandidate, query: string, configContent: string): number {
  return candidate.aliases.reduce((score, alias) => {
    const queryHits = countOccurrences(query, alias)
    const configHits = countOccurrences(configContent, alias)
    return score + queryHits * 18 + configHits * 6
  }, 0)
}

function fallbackSubjects(query: string): string[] {
  return unique([
    ...extractQuotedSubjects(query),
    ...extractNamedSubjects(query),
    ...tokenize(query).slice(0, 3),
  ]).slice(0, 3)
}

function matchesSearchTerms(value: string, searchTerms: string[]): boolean {
  const normalizedValue = normalize(value)

  return searchTerms.some((term) => {
    const normalizedTerm = normalize(term)
    return (
      normalizedValue.includes(normalizedTerm) ||
      normalizedTerm.includes(normalizedValue) ||
      tokenize(normalizedValue).some((token) => token === normalizedTerm)
    )
  })
}

export function inferQuickCheckScope(
  query: string,
  configContent = "",
  syntheticConfig = false
): QuickCheckScope | null {
  const normalizedQuery = normalize(query)

  if (!normalizedQuery) {
    return null
  }

  const candidates = buildSourceCandidates()
  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreSourceCandidate(candidate, normalizedQuery, normalize(configContent)),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)

  const selectedCandidates = rankedCandidates.slice(0, 3)
  const explicitSubjects = unique([
    ...extractQuotedSubjects(query),
    ...extractNamedSubjects(query),
  ])
  const selectedSubjects = unique([
    ...selectedCandidates.map((candidate) => candidate.subject),
    ...explicitSubjects,
  ]).slice(0, 4)

  const searchTerms = unique([
    ...selectedCandidates.flatMap((candidate) => candidate.aliases),
    ...selectedSubjects.flatMap((subject) => tokenize(subject)),
    ...fallbackSubjects(query),
  ]).slice(0, 24)

  const narrowed =
    rankedCandidates.length > selectedCandidates.length ||
    explicitSubjects.length > Math.max(selectedSubjects.length - selectedCandidates.length, 0)

  const explanation: string[] = []

  if (selectedCandidates.length > 0) {
    explanation.push(
      `Matched known sources from your request: ${selectedCandidates.map((candidate) => candidate.label).join(", ")}.`
    )
  } else {
    explanation.push("No exact authority match was found, so the run falls back to general subject terms from the request.")
  }

  if (selectedSubjects.length > 0) {
    explanation.push(`Checking these subjects: ${selectedSubjects.join(", ")}.`)
  }

  if (narrowed) {
    explanation.push("The request was broader than the initial scope, so the run was narrowed to the strongest candidates.")
  }

  if (syntheticConfig) {
    explanation.push("No config file was uploaded, so Quick Check uses the request itself as the local state to compare against live changes.")
  }

  return {
    mode: "quick-check",
    query: query.trim(),
    syntheticConfig,
    selectedSubjects: selectedSubjects.length > 0 ? selectedSubjects : fallbackSubjects(query),
    authoritySourceKeys: selectedCandidates.map((candidate) => candidate.key),
    searchTerms,
    narrowed,
    explanation,
  }
}

export function filterEntitiesByQuickCheckScope(
  entities: Entity[],
  scope: QuickCheckScope | null
): Entity[] {
  if (!scope || scope.searchTerms.length === 0) {
    return entities
  }

  return entities.filter((entity) => matchesSearchTerms(entity.name, scope.searchTerms))
}

export function filterChangesByQuickCheckScope(
  changes: AuthoritativeChange[],
  scope: QuickCheckScope | null
): AuthoritativeChange[] {
  if (!scope || scope.searchTerms.length === 0) {
    return changes
  }

  return changes.filter((change) => {
    return (
      matchesSearchTerms(change.entity, scope.searchTerms) ||
      matchesSearchTerms(change.description, scope.searchTerms) ||
      matchesSearchTerms(change.source_label, scope.searchTerms)
    )
  })
}

export function buildQuickCheckConfigContent(scope: QuickCheckScope): string {
  return [
    "# DriftCheck Quick Check",
    "",
    `Question: ${scope.query}`,
    `Selected subjects: ${scope.selectedSubjects.join(", ") || "general AI tooling"}`,
    "",
    "Treat this request as the developer's current local state for a stateless check.",
    "Only surface findings that directly help answer whether the selected subjects look outdated, changed, or risky.",
  ].join("\n")
}
