import type { Entity, AuthoritativeChange, FeedbackLoopMeta, Finding, ProvenanceStep } from "./types";
import {
  ENTITY_EXTRACTION_PROMPT,
  AUTHORITATIVE_PARSING_PROMPT,
  buildConfigDiffPrompt,
} from "./prompts";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";
const MODEL = "gpt-4o";

interface EntityExtractionResponse {
  entities: Entity[]
}

interface AuthoritativeParsingResponse {
  changes: AuthoritativeChange[]
}

interface ConfigDiffResponse {
  findings: Finding[]
}

interface LLMResponse<T> {
  payload: T
  feedbackLoop: FeedbackLoopMeta
}

type ValidationResult = {
  ok: true
} | {
  ok: false
  issues: string[]
}

async function callGPT4o(
  systemPrompt: string,
  userContent: string
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");

  const res = await fetch(OPENAI_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  return data.choices[0].message.content as string;
}

export async function extractJSON<T>(
  systemPrompt: string,
  userContent: string
): Promise<T> {
  const raw = await callGPT4o(systemPrompt, userContent);

  try {
    return JSON.parse(raw) as T;
  } catch {
    // One retry with corrective instruction
    const retryContent =
      userContent +
      "\n\nYour previous response was not valid JSON. Return ONLY valid JSON matching the requested object shape, with no markdown.";
    const retryRaw = await callGPT4o(systemPrompt, retryContent);

    try {
      return JSON.parse(retryRaw) as T;
    } catch (err) {
      throw new Error(
        `GPT-4o returned invalid JSON after retry. Last response: ${retryRaw.slice(0, 200)}. Parse error: ${err}`
      );
    }
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function isImpactType(value: unknown): value is Finding["impact"] {
  return value === "breaking" || value === "additive" || value === "deprecation" || value === "best_practice"
}

function isConfidenceTier(value: unknown): value is Finding["tier"] {
  return value === "HIGH" || value === "MEDIUM" || value === "LOW" || value === "CONFLICT"
}

function normalizeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback
}

function normalizeOptionalString(value: unknown): string | undefined {
  const normalized = normalizeString(value)
  return normalized === "" ? undefined : normalized
}

function normalizeConfidenceTier(value: unknown): Finding["tier"] {
  return isConfidenceTier(value) ? value : "LOW"
}

function normalizeImpactType(value: unknown): Finding["impact"] {
  return isImpactType(value) ? value : "best_practice"
}

function normalizeAffectedLine(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined
}

function normalizeProvenanceStep(step: unknown, index: number): ProvenanceStep {
  if (!isObject(step)) {
    return {
      source: `Source ${index + 1}`,
      summary: "No provenance summary was provided.",
      tier: "LOW",
    }
  }

  return {
    source: normalizeString(step.source, `Source ${index + 1}`),
    url: normalizeOptionalString(step.url),
    date: normalizeOptionalString(step.date),
    summary: normalizeString(step.summary, "No provenance summary was provided."),
    tier: normalizeConfidenceTier(step.tier),
  }
}

function normalizeFinding(finding: unknown, index: number): Finding {
  if (!isObject(finding)) {
    return {
      entity: `Finding ${index + 1}`,
      claim: "Malformed finding payload received.",
      tier: "LOW",
      justification: "The model returned an unexpected finding shape, so DriftCheck normalized it.",
      source_url: "",
      source_date: "",
      impact: "best_practice",
      affected_file: "unknown",
      suggested_change: "Review the underlying source and update this file manually.",
      provenance: [],
    }
  }

  return {
    entity: normalizeString(finding.entity, `Finding ${index + 1}`),
    claim: normalizeString(finding.claim, "No claim provided."),
    tier: normalizeConfidenceTier(finding.tier),
    justification: normalizeString(
      finding.justification,
      "No justification was provided for this finding."
    ),
    source_url: normalizeString(finding.source_url),
    source_date: normalizeString(finding.source_date),
    impact: normalizeImpactType(finding.impact),
    affected_file: normalizeString(finding.affected_file, "unknown"),
    affected_line: normalizeAffectedLine(finding.affected_line),
    suggested_change: normalizeString(
      finding.suggested_change,
      "Review the underlying source and update this file manually."
    ),
    replacement_text: normalizeOptionalString(finding.replacement_text),
    provenance: Array.isArray(finding.provenance)
      ? finding.provenance.map(normalizeProvenanceStep)
      : [],
  }
}

function validateEntityResponse(payload: unknown): ValidationResult {
  if (!isObject(payload) || !Array.isArray(payload.entities)) {
    return { ok: false, issues: ['Top-level object must include an "entities" array.'] }
  }

  const issues: string[] = []

  payload.entities.forEach((entity, index) => {
    if (!isObject(entity)) {
      issues.push(`entities[${index}] must be an object.`)
      return
    }

    if (typeof entity.name !== "string" || entity.name.trim() === "") {
      issues.push(`entities[${index}].name must be a non-empty string.`)
    }
    if (typeof entity.category !== "string") {
      issues.push(`entities[${index}].category must be a string.`)
    }
    if (typeof entity.signal_strength !== "number") {
      issues.push(`entities[${index}].signal_strength must be a number.`)
    }
    if (typeof entity.context !== "string" || entity.context.trim() === "") {
      issues.push(`entities[${index}].context must be a non-empty string.`)
    }
  })

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

function validateAuthoritativeResponse(payload: unknown): ValidationResult {
  if (!isObject(payload) || !Array.isArray(payload.changes)) {
    return { ok: false, issues: ['Top-level object must include a "changes" array.'] }
  }

  const issues: string[] = []

  payload.changes.forEach((change, index) => {
    if (!isObject(change)) {
      issues.push(`changes[${index}] must be an object.`)
      return
    }

    if (typeof change.entity !== "string" || change.entity.trim() === "") {
      issues.push(`changes[${index}].entity must be a non-empty string.`)
    }
    if (!isImpactType(change.change_type)) {
      issues.push(`changes[${index}].change_type must be one of the supported impact types.`)
    }
    if (typeof change.description !== "string" || change.description.trim() === "") {
      issues.push(`changes[${index}].description must be a non-empty string.`)
    }
    if (typeof change.date !== "string" || change.date.trim() === "") {
      issues.push(`changes[${index}].date must be a non-empty string.`)
    }
    if (typeof change.source_url !== "string" || change.source_url.trim() === "") {
      issues.push(`changes[${index}].source_url must be a non-empty string.`)
    }
  })

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

function validateFindingResponse(payload: unknown): ValidationResult {
  if (!isObject(payload) || !Array.isArray(payload.findings)) {
    return { ok: false, issues: ['Top-level object must include a "findings" array.'] }
  }

  const issues: string[] = []

  payload.findings.forEach((finding, index) => {
    if (!isObject(finding)) {
      issues.push(`findings[${index}] must be an object.`)
      return
    }

    if (typeof finding.entity !== "string" || finding.entity.trim() === "") {
      issues.push(`findings[${index}].entity must be a non-empty string.`)
    }
    if (typeof finding.claim !== "string" || finding.claim.trim() === "") {
      issues.push(`findings[${index}].claim must be a non-empty string.`)
    }
    if (!isConfidenceTier(finding.tier)) {
      issues.push(`findings[${index}].tier must be a supported confidence tier.`)
    }
    if (typeof finding.justification !== "string" || finding.justification.trim() === "") {
      issues.push(`findings[${index}].justification must be a non-empty string.`)
    }
    if (typeof finding.source_url !== "string" || finding.source_url.trim() === "") {
      issues.push(`findings[${index}].source_url must be a non-empty string.`)
    }
    if (typeof finding.source_date !== "string" || finding.source_date.trim() === "") {
      issues.push(`findings[${index}].source_date must be a non-empty string.`)
    }
    if (!isImpactType(finding.impact)) {
      issues.push(`findings[${index}].impact must be one of the supported impact types.`)
    }
    if (finding.affected_file != null && typeof finding.affected_file !== "string") {
      issues.push(`findings[${index}].affected_file must be a string when provided.`)
    }
    if (
      finding.affected_line != null &&
      (typeof finding.affected_line !== "number" ||
        !Number.isInteger(finding.affected_line) ||
        finding.affected_line <= 0)
    ) {
      issues.push(`findings[${index}].affected_line must be a positive integer when provided.`)
    }
    if (typeof finding.suggested_change !== "string" || finding.suggested_change.trim() === "") {
      issues.push(`findings[${index}].suggested_change must be a non-empty string.`)
    }
    if (
      finding.replacement_text != null &&
      typeof finding.replacement_text !== "string"
    ) {
      issues.push(`findings[${index}].replacement_text must be a string when provided.`)
    }
    if (!Array.isArray(finding.provenance)) {
      issues.push(`findings[${index}].provenance must be an array.`)
    } else {
      finding.provenance.forEach((step, stepIndex) => {
        if (!isObject(step)) {
          issues.push(`findings[${index}].provenance[${stepIndex}] must be an object.`)
          return
        }

        if (typeof step.source !== "string" || step.source.trim() === "") {
          issues.push(`findings[${index}].provenance[${stepIndex}].source must be a non-empty string.`)
        }
        if (step.url != null && typeof step.url !== "string") {
          issues.push(`findings[${index}].provenance[${stepIndex}].url must be a string when provided.`)
        }
        if (step.date != null && typeof step.date !== "string") {
          issues.push(`findings[${index}].provenance[${stepIndex}].date must be a string when provided.`)
        }
        if (typeof step.summary !== "string" || step.summary.trim() === "") {
          issues.push(`findings[${index}].provenance[${stepIndex}].summary must be a non-empty string.`)
        }
        if (!isConfidenceTier(step.tier)) {
          issues.push(`findings[${index}].provenance[${stepIndex}].tier must be a supported confidence tier.`)
        }
      })
    }
  })

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

function validateFindingQuality(payload: unknown): ValidationResult {
  if (!isObject(payload) || !Array.isArray(payload.findings)) {
    return { ok: false, issues: ['Top-level object must include a "findings" array.'] }
  }

  const issues: string[] = []

  payload.findings.forEach((finding, index) => {
    if (!isObject(finding)) {
      issues.push(`findings[${index}] must be an object.`)
      return
    }

    const claim = typeof finding.claim === "string" ? finding.claim.trim() : ""
    const justification = typeof finding.justification === "string" ? finding.justification.trim() : ""
    const suggestedChange =
      typeof finding.suggested_change === "string" ? finding.suggested_change.trim() : ""
    const replacementText =
      typeof finding.replacement_text === "string" ? finding.replacement_text.trim() : ""
    const provenance = Array.isArray(finding.provenance) ? finding.provenance : []
    const sourceUrl = typeof finding.source_url === "string" ? finding.source_url.trim() : ""
    const sourceDate = typeof finding.source_date === "string" ? finding.source_date.trim() : ""
    const tier = finding.tier

    if (claim.length < 18) {
      issues.push(`findings[${index}].claim is too short to be specific.`)
    }

    if (/^(this|it|something)\s/i.test(claim)) {
      issues.push(`findings[${index}].claim should name the concrete tool, API, or config item.`)
    }

    if (justification.length < 16) {
      issues.push(`findings[${index}].justification is too short to explain the tier.`)
    }

    if (suggestedChange.length < 20) {
      issues.push(`findings[${index}].suggested_change is too short to be actionable.`)
    }

    const hasConcreteEditLanguage = /(->|→|replace|change|set|rename|remove|add|use|migrate|update)/i.test(
      suggestedChange
    )
    const hasActionLanguage = /(review|confirm|check|inspect|align|verify|switch|prefer|move|adopt)/i.test(
      suggestedChange
    )

    if (!hasConcreteEditLanguage && !(finding.affected_line == null && hasActionLanguage)) {
      issues.push(`findings[${index}].suggested_change should describe a concrete edit.`)
    }

    if (
      finding.affected_line != null &&
      replacementText === "" &&
      !/(->|→)/.test(suggestedChange)
    ) {
      issues.push(`findings[${index}] should include replacement_text or a clear before→after edit when affected_line is set.`)
    }

    if (provenance.length === 0) {
      issues.push(`findings[${index}].provenance should include at least one source step.`)
    }

    if (!sourceUrl.startsWith("http")) {
      issues.push(`findings[${index}].source_url should be a concrete URL.`)
    }

    if (sourceDate.length < 4) {
      issues.push(`findings[${index}].source_date should identify when the source was published.`)
    }

    if (tier === "HIGH" && provenance.length < 1) {
      issues.push(`findings[${index}] is HIGH confidence but lacks meaningful provenance.`)
    }

    if (
      tier === "HIGH" &&
      !/(official|authoritative|changelog|release|first-party|confirmed)/i.test(justification)
    ) {
      issues.push(`findings[${index}] is HIGH confidence but the justification does not explain authoritative evidence.`)
    }

    if (
      tier === "CONFLICT" &&
      !/(conflict|contradict|mismatch|disagree)/i.test(justification)
    ) {
      issues.push(`findings[${index}] is CONFLICT but the justification does not describe the contradiction.`)
    }
  })

  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

async function extractJSONWithFeedback<T>(
  systemPrompt: string,
  userContent: string,
  validate: (payload: unknown) => ValidationResult,
  label: string
): Promise<LLMResponse<T>> {
  const initial = await extractJSON<unknown>(systemPrompt, userContent)
  const initialValidation = validate(initial)

  if (initialValidation.ok) {
    return {
      payload: initial as T,
      feedbackLoop: {
        label,
        status: "accepted_on_first_pass",
        schema_attempts: 1,
        quality_attempts: 0,
      },
    }
  }

  const feedbackPrompt = `${userContent}

Your previous JSON parsed successfully, but it failed DriftCheck validation for ${label}.
Correct the response using these issues:
- ${initialValidation.issues.join("\n- ")}

Return the same top-level JSON object shape only. Do not add commentary.`

  const corrected = await extractJSON<unknown>(systemPrompt, feedbackPrompt)
  const correctedValidation = validate(corrected)

  if (correctedValidation.ok) {
    return {
      payload: corrected as T,
      feedbackLoop: {
        label,
        status: "corrected_after_schema_feedback",
        schema_attempts: 2,
        quality_attempts: 0,
      },
    }
  }

  throw new Error(
    `${label} failed schema validation after feedback loop: ${correctedValidation.issues.join(" ")}`
  )
}

async function runQualityFeedbackLoop<T>(
  systemPrompt: string,
  userContent: string,
  response: LLMResponse<T>,
  validate: (payload: unknown) => ValidationResult,
  label: string
): Promise<LLMResponse<T>> {
  const qualityValidation = validate(response.payload)

  if (qualityValidation.ok) {
    return response
  }

  const feedbackPrompt = `${userContent}

Your previous response passed JSON/schema validation, but it failed DriftCheck quality checks for ${label}.
Revise the output using these issues:
- ${qualityValidation.issues.join("\n- ")}

Keep the same top-level JSON object shape. Return only JSON.`

  const corrected = await extractJSON<unknown>(systemPrompt, feedbackPrompt)
  const correctedSchemaValidation = validateFindingResponse(corrected)

  if (!correctedSchemaValidation.ok) {
    throw new Error(
      `${label} failed schema validation after quality feedback loop: ${correctedSchemaValidation.issues.join(" ")}`
    )
  }

  const correctedQualityValidation = validate(corrected)

  if (correctedQualityValidation.ok) {
    return {
      payload: corrected as T,
      feedbackLoop: {
        ...response.feedbackLoop,
        status:
          response.feedbackLoop.status === "corrected_after_schema_feedback"
            ? "corrected_after_schema_and_quality_feedback"
            : "corrected_after_quality_feedback",
        quality_attempts: response.feedbackLoop.quality_attempts + 1,
      },
    }
  }

  throw new Error(
    `${label} failed quality validation after feedback loop: ${correctedQualityValidation.issues.join(" ")}`
  )
}

// Stage 1: Entity extraction from HN or skills diff content
export async function extractEntities(
  content: string,
  source: "hackernews" | "skills_diff" | "repo_inventory"
): Promise<{ entities: Entity[]; feedbackLoop: FeedbackLoopMeta }> {
  const userContent = `Source type: ${source}\n\n${content}`;
  const response = await extractJSONWithFeedback<EntityExtractionResponse>(
    ENTITY_EXTRACTION_PROMPT,
    userContent,
    validateEntityResponse,
    "entity extraction"
  )
  return {
    entities: Array.isArray(response.payload.entities) ? response.payload.entities : [],
    feedbackLoop: response.feedbackLoop,
  }
}

// Stage 2: Parse authoritative changelog / release content
export async function parseAuthoritative(
  content: string,
  sourceUrl: string,
  sourceLabel: string
): Promise<{ changes: AuthoritativeChange[]; feedbackLoop: FeedbackLoopMeta }> {
  const userContent = `Source: ${sourceLabel}\nURL: ${sourceUrl}\n\n${content}`;
  const response = await extractJSONWithFeedback<AuthoritativeParsingResponse>(
    AUTHORITATIVE_PARSING_PROMPT,
    userContent,
    validateAuthoritativeResponse,
    "authoritative parsing"
  );
  return {
    changes: Array.isArray(response.payload.changes) ? response.payload.changes : [],
    feedbackLoop: response.feedbackLoop,
  }
}

// Stage 3: Diff user config against authoritative findings
export async function diffConfig(
  configContent: string,
  findings: AuthoritativeChange[],
  quickCheckContext?: string
): Promise<{ findings: Finding[]; feedbackLoop: FeedbackLoopMeta }> {
  const prompt = buildConfigDiffPrompt(
    configContent,
    JSON.stringify(findings, null, 2),
    quickCheckContext ?? "No quick-check scope provided."
  );
  const response = await extractJSONWithFeedback<ConfigDiffResponse>(
    prompt,
    "Analyze the config against the changes described in the system prompt and return findings.",
    validateFindingResponse,
    "config diff"
  )
  let qualityChecked: LLMResponse<ConfigDiffResponse>

  try {
    qualityChecked = await runQualityFeedbackLoop<ConfigDiffResponse>(
      prompt,
      "Analyze the config against the changes described in the system prompt and return findings.",
      response,
      validateFindingQuality,
      "config diff"
    )
  } catch {
    qualityChecked = {
      payload: {
        findings: Array.isArray(response.payload.findings)
          ? response.payload.findings.map(normalizeFinding)
          : [],
      },
      feedbackLoop: {
        ...response.feedbackLoop,
        status:
          response.feedbackLoop.status === "corrected_after_schema_feedback"
            ? "corrected_after_schema_and_quality_feedback"
            : "corrected_after_quality_feedback",
        quality_attempts: response.feedbackLoop.quality_attempts + 1,
      },
    }
  }

  const normalizedFindings = Array.isArray(qualityChecked.payload.findings)
    ? qualityChecked.payload.findings.map(normalizeFinding)
    : []
  return {
    findings: normalizedFindings,
    feedbackLoop: qualityChecked.feedbackLoop,
  }
}
