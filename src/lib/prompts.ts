/**
 * All GPT-4o prompts as template literals.
 * Each prompt instructs the model to return ONLY valid JSON.
 */

/** Stage 1 + 1b: Extract named entities from noisy source (HN) or skill repo git diffs */
export const ENTITY_EXTRACTION_PROMPT = `You are analyzing content scraped from a tech community source.
Extract all named entities related to AI tooling, agent frameworks, LLM APIs, developer infrastructure, and config patterns.

For each entity, return:
- name: the tool, API, model, pattern, or config key name (exact casing as used in the source)
- category: one of "model", "api_parameter", "framework", "pattern", "config", "library"
- signal_strength: number of independent mentions, upvotes, or references as a rough proxy (integer)
- context: 1-sentence summary of what the source says about this entity

Return a JSON object with key "entities" containing an array. Example:
{"entities": [{"name": "structured_outputs", "category": "api_parameter", "signal_strength": 5, "context": "Multiple threads discuss migrating to structured outputs for reliable JSON from GPT-4o."}]}

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`

/** Stage 2: Parse changes from authoritative source (changelog, GitHub releases, skill repo) */
export const AUTHORITATIVE_PARSING_PROMPT = `You are reading content scraped from an authoritative source (official changelog, GitHub releases page, or maintained skill repository).

For each change or update entry found, extract:
- entity: the tool, API, parameter, or pattern name
- change_type: one of "breaking", "additive", "deprecation", "best_practice"
- description: what changed (1-2 sentences, be specific)
- date: the date of the change (ISO format YYYY-MM-DD if possible, approximate if not)
- version: version number if available (e.g. "v1.2.0"), null if not
- source_url: the URL this content was scraped from

Return a JSON object with key "changes" containing an array. Example:
{"changes": [{"entity": "gpt-4-turbo", "change_type": "deprecation", "description": "gpt-4-turbo is now a legacy model. Users should migrate to gpt-4o.", "date": "2026-03-01", "version": null, "source_url": "https://platform.openai.com/docs/changelog"}]}

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`

/** Stage 3: Diff user config against authoritative findings */
export const CONFIG_DIFF_PROMPT = `You are comparing a developer's local config file against recent changes from authoritative sources.

User's file:
<file>
{FILE_CONTENT}
</file>

Recent authoritative changes:
<changes>
{CHANGES_JSON}
</changes>

Quick Check context:
<quick_check>
{QUICK_CHECK_CONTEXT}
</quick_check>

For each relevant finding where the user's file is affected, identify:
- entity: the tool/API/pattern name
- claim: what changed (1 sentence)
- tier: confidence tier — "HIGH" if from official changelog with date+version, "MEDIUM" if from official cookbook or maintained skill repo, "LOW" if only from community sources, "CONFLICT" if noisy source claims something authoritative source contradicts
- justification: 1-sentence human-readable reason for this tier assignment
- source_url: the authoritative URL
- source_date: when the change was dated (ISO)
- impact: one of "breaking", "additive", "deprecation", "best_practice"
- affected_file: the filename being analyzed
- affected_line: line number if identifiable, null otherwise
- suggested_change: what the user should change (be specific, show the before→after)
- replacement_text: exact literal replacement text for the affected line if you can identify a safe single-line edit, null otherwise
- provenance: array of source trail steps, each with {source, url, date, summary, tier}

Return a JSON object with key "findings" containing an array.

If the quick-check context says there is no uploaded config, treat the quick-check request as the user's current local state and return only findings that directly answer the request.

Return ONLY valid JSON. No markdown fences, no preamble, no trailing text.`

/** Wrapper to fill template placeholders in CONFIG_DIFF_PROMPT */
export function buildConfigDiffPrompt(
  fileContent: string,
  changesJson: string,
  quickCheckContext = "No quick-check scope provided."
): string {
  return CONFIG_DIFF_PROMPT
    .replace("{FILE_CONTENT}", fileContent)
    .replace("{CHANGES_JSON}", changesJson)
    .replace("{QUICK_CHECK_CONTEXT}", quickCheckContext)
}
