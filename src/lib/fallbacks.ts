import type {
  AuthoritativeChange,
  AuthoritativeSupportingSource,
  FallbackReason,
} from "./types"

export const FALLBACK_REASON_LABELS: Record<FallbackReason, string> = {
  forced_fallback: "forced fallback",
  tinyfish_timeout: "TinyFish timeout",
  tinyfish_scrape_failure: "TinyFish scrape failure",
  openai_request_failure: "OpenAI request failure",
  openai_parse_failure: "OpenAI parse failure",
  git_diff_failure: "git diff failure",
  unknown_failure: "unknown failure",
}

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().replace(/\s+/g, " ")
}

function normalizeUrl(value: string): string {
  const trimmed = normalizeText(value)

  try {
    const url = new URL(trimmed)
    url.hash = ""
    url.pathname = url.pathname.replace(/\/+$/, "") || "/"
    return url.toString()
  } catch {
    return trimmed.replace(/\/+$/, "")
  }
}

function normalizeDate(value: string): string {
  return normalizeText(value)
}

function normalizeVersion(value?: string): string {
  return normalizeText(value).toLowerCase()
}

function normalizeEntity(value: string): string {
  return normalizeText(value).toLowerCase()
}

function tokenizeDescription(value: string): string[] {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2)
}

function supportingSourceFor(change: AuthoritativeChange): AuthoritativeSupportingSource {
  return {
    source_url: normalizeUrl(change.source_url),
    source_label: normalizeText(change.source_label),
    date: normalizeDate(change.date),
    version: change.version ? normalizeText(change.version) : undefined,
  }
}

function sameVersionOrDate(a: AuthoritativeChange, b: AuthoritativeChange): boolean {
  const aVersion = normalizeVersion(a.version)
  const bVersion = normalizeVersion(b.version)

  if (aVersion || bVersion) {
    return aVersion !== "" && aVersion === bVersion
  }

  return normalizeDate(a.date).toLowerCase() === normalizeDate(b.date).toLowerCase()
}

function descriptionsMatch(a: string, b: string): boolean {
  const left = normalizeText(a).toLowerCase()
  const right = normalizeText(b).toLowerCase()

  if (!left || !right) return left === right
  if (left === right || left.includes(right) || right.includes(left)) {
    return true
  }

  const leftTokens = tokenizeDescription(left)
  const rightTokens = tokenizeDescription(right)

  if (leftTokens.length === 0 || rightTokens.length === 0) {
    return false
  }

  const rightSet = new Set(rightTokens)
  const overlap = leftTokens.filter((token) => rightSet.has(token)).length
  const baseline = Math.min(leftTokens.length, rightTokens.length)

  return overlap / baseline >= 0.7
}

function shouldMergeChanges(existing: AuthoritativeChange, incoming: AuthoritativeChange): boolean {
  return (
    normalizeEntity(existing.entity) === normalizeEntity(incoming.entity) &&
    existing.change_type === incoming.change_type &&
    sameVersionOrDate(existing, incoming) &&
    descriptionsMatch(existing.description, incoming.description)
  )
}

function mergeChange(existing: AuthoritativeChange, incoming: AuthoritativeChange): AuthoritativeChange {
  const existingDescription = normalizeText(existing.description)
  const incomingDescription = normalizeText(incoming.description)
  const combinedSources = [
    ...(existing.supporting_sources ?? [supportingSourceFor(existing)]),
    ...(incoming.supporting_sources ?? [supportingSourceFor(incoming)]),
  ]
  const dedupedSources = dedupeSupportingSources(combinedSources)

  return {
    ...existing,
    description:
      incomingDescription.length > existingDescription.length
        ? incomingDescription
        : existingDescription,
    version: existing.version ?? incoming.version,
    source_label: normalizeText(existing.source_label) || normalizeText(incoming.source_label),
    source_url: normalizeUrl(existing.source_url) || normalizeUrl(incoming.source_url),
    supporting_sources: dedupedSources,
    source_count: dedupedSources.length,
  }
}

function dedupeSupportingSources(
  sources: AuthoritativeSupportingSource[]
): AuthoritativeSupportingSource[] {
  const deduped = new Map<string, AuthoritativeSupportingSource>()

  for (const source of sources) {
    const normalized: AuthoritativeSupportingSource = {
      source_url: normalizeUrl(source.source_url),
      source_label: normalizeText(source.source_label),
      date: normalizeDate(source.date),
      version: source.version ? normalizeText(source.version) : undefined,
    }
    const key = [
      normalized.source_url.toLowerCase(),
      normalized.source_label.toLowerCase(),
      normalized.date.toLowerCase(),
      normalizeVersion(normalized.version),
    ].join("::")

    if (!deduped.has(key)) {
      deduped.set(key, normalized)
    }
  }

  return [...deduped.values()]
    .sort((left, right) => left.source_label.localeCompare(right.source_label))
}

export function normalizeAuthoritativeChanges(changes: AuthoritativeChange[]): AuthoritativeChange[] {
  const normalizedChanges: AuthoritativeChange[] = []

  for (const rawChange of changes) {
    const normalized: AuthoritativeChange = {
      ...rawChange,
      entity: normalizeText(rawChange.entity),
      description: normalizeText(rawChange.description),
      date: normalizeDate(rawChange.date),
      version: rawChange.version ? normalizeText(rawChange.version) : undefined,
      source_url: normalizeUrl(rawChange.source_url),
      source_label: normalizeText(rawChange.source_label),
      supporting_sources: dedupeSupportingSources([
        ...(rawChange.supporting_sources ?? []),
        supportingSourceFor(rawChange),
      ]),
    }
    normalized.source_count = (normalized.supporting_sources ?? []).length

    const existingIndex = normalizedChanges.findIndex((candidate) =>
      shouldMergeChanges(candidate, normalized)
    )

    if (existingIndex === -1) {
      normalizedChanges.push(normalized)
      continue
    }

    normalizedChanges[existingIndex] = mergeChange(normalizedChanges[existingIndex], normalized)
  }

  return normalizedChanges
}

export function classifyTinyFishFallbackReason(detail?: string | null): FallbackReason {
  const normalized = normalizeText(detail ?? "").toLowerCase()

  if (
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("aborted due to timeout")
  ) {
    return "tinyfish_timeout"
  }

  return "tinyfish_scrape_failure"
}

export function classifyOpenAIFallbackReason(detail?: string | null): FallbackReason {
  const normalized = normalizeText(detail ?? "").toLowerCase()

  if (
    normalized.includes("api.openai.com") ||
    normalized.includes("openai api error") ||
    normalized.includes("openai_api_key") ||
    normalized.includes("fetch failed") ||
    normalized.includes("enotfound")
  ) {
    return "openai_request_failure"
  }

  return "openai_parse_failure"
}

export function classifyDiscoveryFallbackReason(detail?: string | null): FallbackReason {
  const normalized = normalizeText(detail ?? "").toLowerCase()

  if (
    normalized.includes("api.openai.com") ||
    normalized.includes("openai api error") ||
    normalized.includes("openai_api_key") ||
    normalized.includes("fetch failed") ||
    normalized.includes("enotfound") ||
    normalized.includes("gpt-4o")
  ) {
    return classifyOpenAIFallbackReason(detail)
  }

  if (
    normalized.includes("tinyfish") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out") ||
    normalized.includes("scrape")
  ) {
    return classifyTinyFishFallbackReason(detail)
  }

  return "unknown_failure"
}

export function fallbackReasonLabel(reason: FallbackReason): string {
  return FALLBACK_REASON_LABELS[reason]
}
