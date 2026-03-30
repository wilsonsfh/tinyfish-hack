/**
 * DriftCheck — Core TypeScript Types
 * Single source of truth for all types across the project.
 */

// ---------------------------------------------------------------------------
// Primitive enumerations
// ---------------------------------------------------------------------------

/** Confidence assigned to a finding based on source quality and corroboration. */
export type ConfidenceTier = "HIGH" | "MEDIUM" | "LOW" | "CONFLICT"

/** Nature of a detected change — drives UI colour and urgency. */
export type ImpactType = "breaking" | "additive" | "deprecation" | "best_practice"

/** Broad category for an extracted entity. */
export type EntityCategory =
  | "model"
  | "api_parameter"
  | "framework"
  | "pattern"
  | "config"
  | "library"

// ---------------------------------------------------------------------------
// Stage IDs & status
// ---------------------------------------------------------------------------

/** Identifies one of the six pipeline stages. */
export type StageId =
  | "discovery"
  | "skills-diff"
  | "resolution"
  | "diff"
  | "confidence"
  | "output"

export type StageStatus = "idle" | "running" | "complete" | "error"

/** Explicit reason why a stage degraded to fixture/cached data. */
export type FallbackReason =
  | "forced_fallback"
  | "tinyfish_timeout"
  | "tinyfish_scrape_failure"
  | "openai_request_failure"
  | "openai_parse_failure"
  | "git_diff_failure"
  | "unknown_failure"

export type SourceStatus = "live" | "cached" | "unavailable"

export type FeedbackLoopStatus =
  | "not_applicable"
  | "accepted_on_first_pass"
  | "corrected_after_schema_feedback"
  | "corrected_after_quality_feedback"
  | "corrected_after_schema_and_quality_feedback"
  | "mixed"

export interface FeedbackLoopMeta {
  label: string
  status: Exclude<FeedbackLoopStatus, "not_applicable" | "mixed">
  schema_attempts: number
  quality_attempts: number
}

export interface StageFeedbackSummary {
  status: FeedbackLoopStatus
  details: string[]
  loops?: FeedbackLoopMeta[]
}

export interface QuickCheckScope {
  mode: "quick-check"
  query: string
  syntheticConfig: boolean
  selectedSubjects: string[]
  authoritySourceKeys: string[]
  searchTerms: string[]
  narrowed: boolean
  explanation: string[]
}

export interface RepoDiffScope {
  mode: "repo-diff"
  repoPath: string
  repoLabel: string
  inventorySummary: string
  selectedSubjects: string[]
  authoritySourceKeys: string[]
  searchTerms: string[]
  manifestFiles: string[]
  submodules: string[]
  explanation: string[]
}

// ---------------------------------------------------------------------------
// Stage 1 — Entity extracted from a noisy signal source
// ---------------------------------------------------------------------------

/** Raw entity surfaced from HackerNews or a skills repo git diff. */
export interface Entity {
  name: string
  category: EntityCategory
  /** Mention count / upvotes used as a rough signal proxy. */
  signal_strength: number
  /** One-sentence summary of why this entity is relevant. */
  context: string
  source: "hackernews" | "skills_diff" | "repo_inventory"
}

// ---------------------------------------------------------------------------
// Stage 2 — Change parsed from an authoritative source
// ---------------------------------------------------------------------------

/** A concrete change extracted from an official changelog or GitHub Releases page. */
export interface AuthoritativeChange {
  entity: string
  change_type: ImpactType
  /** One-to-two sentence description of the change. */
  description: string
  /** ISO 8601 date string. */
  date: string
  version?: string
  source_url: string
  source_label: string
  /** Other authoritative sources that corroborated the same normalized change. */
  supporting_sources?: AuthoritativeSupportingSource[]
  /** Number of authoritative records collapsed into this normalized change. */
  source_count?: number
}

export interface AuthoritativeSupportingSource {
  source_url: string
  source_label: string
  date: string
  version?: string
}

// ---------------------------------------------------------------------------
// Stage 3–4 — Finding with confidence tier and provenance
// ---------------------------------------------------------------------------

/**
 * A single actionable drift finding produced after diffing the user's config
 * against authoritative sources and assigning a confidence tier.
 */
export interface Finding {
  entity: string
  /** What changed, stated plainly. */
  claim: string
  tier: ConfidenceTier
  /** One-sentence human-readable reason for the assigned tier. */
  justification: string
  source_url: string
  /** ISO 8601 date string for when the authoritative change was published. */
  source_date: string
  impact: ImpactType
  affected_file: string
  affected_line?: number
  suggested_change: string
  /** Exact literal replacement text for a single-line edit, if one can be identified safely. */
  replacement_text?: string
  /** Full source trail from noisy signal → authoritative → config → fix. */
  provenance: ProvenanceStep[]
}

/** One step in a finding's provenance chain. */
export interface ProvenanceStep {
  /** Human-readable source name, e.g. "HackerNews", "OpenAI Changelog". */
  source: string
  url?: string
  /** ISO 8601 date string. */
  date?: string
  /** What this source contributed to the finding. */
  summary: string
  tier: ConfidenceTier
}

// ---------------------------------------------------------------------------
// Source metadata (transparency panel)
// ---------------------------------------------------------------------------

/** Metadata for every URL scraped during the pipeline run. */
export interface SourceMeta {
  stage: StageId
  url: string
  label: string
  /** ISO 8601 timestamp of when this source was fetched. */
  scraped_at: string
  source_type: "tinyfish" | "git_diff" | "fixture" | "repo_inventory"
  /** "live" = fresh data; "cached" = fixture fallback; "unavailable" = no trustworthy source payload could be produced. */
  status: SourceStatus
  fallback_reason?: FallbackReason
  fallback_detail?: string
}

export interface ResolutionSummary {
  total_sources: number
  live_sources: number
  cached_sources: number
  raw_change_count: number
  normalized_change_count: number
  duplicates_collapsed: number
}

export interface ResolveResponse {
  changes: AuthoritativeChange[]
  sources: SourceMeta[]
  degraded: boolean
  fallbackReasons: FallbackReason[]
  summary: ResolutionSummary
  feedbackSummary?: StageFeedbackSummary
}

export interface DiscoverResponse {
  entities: Entity[]
  source: SourceMeta
  feedbackSummary?: StageFeedbackSummary
  scope?: QuickCheckScope
  repoDiff?: RepoDiffScope
}

export interface SkillsDiffResponse {
  entities: Entity[]
  sources: SourceMeta[]
  changes?: AuthoritativeChange[]
  feedbackSummary?: StageFeedbackSummary
}

export interface DiffResponse {
  findings: Finding[]
  feedbackSummary?: StageFeedbackSummary
}

// ---------------------------------------------------------------------------
// Pipeline stage state (frontend)
// ---------------------------------------------------------------------------

/** Runtime state for a single pipeline stage, held in frontend React state. */
export interface StageState {
  id: StageId
  status: StageStatus
  label: string
  /** ISO 8601 timestamp. */
  startedAt?: string
  /** ISO 8601 timestamp. */
  completedAt?: string
  output?: unknown
  error?: string
  /** True when this stage fell back to fixture data. */
  usedFallback: boolean
  fallbackReasons?: FallbackReason[]
  degradedSources?: SourceMeta[]
  feedbackSummary?: StageFeedbackSummary
}

// ---------------------------------------------------------------------------
// SSE events emitted by /api/pipeline
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all server-sent events the pipeline route can emit.
 * Frontend consumers should exhaustively switch on `type`.
 */
export type PipelineEvent =
  | { type: "STAGE_START";       stage: StageId; timestamp: string }
  | { type: "STAGE_PROGRESS";    stage: StageId; message: string }
  | {
      type: "STAGE_COMPLETE"
      stage: StageId
      output: unknown
      fallback?: boolean
      fallbackReasons?: FallbackReason[]
      degradedSources?: SourceMeta[]
      feedbackSummary?: StageFeedbackSummary
    }
  | {
      type: "STAGE_ERROR"
      stage: StageId
      error: string
      fallback: boolean
      fallbackReason?: FallbackReason
      degradedSources?: SourceMeta[]
    }
  | { type: "PIPELINE_COMPLETE"; findings: Finding[]; sources: SourceMeta[] }
  | { type: "PIPELINE_ERROR";    error: string }

// ---------------------------------------------------------------------------
// Authoritative source configuration (sources.ts whitelist)
// ---------------------------------------------------------------------------

/** A web URL scraped via TinyFish. */
export interface AuthoritativeSourceWeb {
  type: "web"
  url: string
  tier: ConfidenceTier
  label: string
  browser_profile: "lite" | "stealth"
}

/** A GitHub repository diffed via git submodule (no TinyFish credits consumed). */
export interface AuthoritativeSourceGit {
  type: "git"
  repo: string
  submodule_path: string
  tier: ConfidenceTier
  label: string
}

export type AuthoritativeSource = AuthoritativeSourceWeb | AuthoritativeSourceGit

// ---------------------------------------------------------------------------
// TinyFish API types
// ---------------------------------------------------------------------------

/** Request body sent to the TinyFish scraping API. */
export interface TinyFishRequest {
  url: string
  goal: string
  browser_profile: "lite" | "stealth"
}

/** Response returned by TinyFish after a scrape run completes. */
export interface TinyFishResponse {
  run_id: string
  status: "COMPLETED" | "FAILED"
  started_at: string
  finished_at: string
  num_of_steps: number
  result: unknown
  error: string | null
}

// ---------------------------------------------------------------------------
// TinyFish SSE events (streamed during a live scrape run)
// ---------------------------------------------------------------------------

export type TinyFishSSEEvent =
  | { type: "STARTED";       run_id: string; timestamp: string }
  | { type: "STREAMING_URL"; run_id: string; streaming_url: string }
  | { type: "PROGRESS";      run_id: string; purpose: string }
  | { type: "COMPLETE";      run_id: string; status: string; result: unknown }
