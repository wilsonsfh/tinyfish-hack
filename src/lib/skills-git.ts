import { createWriteStream, promises as fs } from "fs"
import { execFile, spawn } from "child_process"
import { tmpdir } from "os"
import { join } from "path"
import { promisify } from "util"
import type { AuthoritativeChange, AuthoritativeSourceGit } from "./types"

const execFileAsync = promisify(execFile)

const SKILLS_REPO_PATH =
  process.env.SKILLS_REPO_PATH ||
  `${process.env.HOME}/Downloads/Projects/claude-skills/_sources`

const MAX_COMMIT_LOG_LINES = 25
const MAX_CHANGED_FILES_LIST = 40
const MAX_SELECTED_DIFF_FILES = 6
const MAX_SEMANTIC_PREVIEW_FILES = 18
const MAX_DIFF_EXCERPT_CHARS = 4000
const MAX_DIFF_PREVIEW_CHARS = 3500
const DIFF_KEYWORDS = [
  "breaking",
  "deprecat",
  "rename",
  "migration",
  "release",
  "changelog",
  "version",
  "model",
  "config",
  "mcp",
  "plugin",
  "skill",
  "agent",
]

const SEMANTIC_SIGNAL_PATTERNS = [
  { pattern: /\b(breaking|deprecated|deprecation|removed|renamed|migration|requires?)\b/gi, weight: 18, cap: 4 },
  { pattern: /\b(new|introduced|added|updated|changed|fixed|support(?:s|ed)?)\b/gi, weight: 8, cap: 6 },
  { pattern: /\b(model|api|config|setting|parameter|plugin|skill|agent|mcp|version)\b/gi, weight: 5, cap: 8 },
  { pattern: /\bv?\d+\.\d+(?:\.\d+)?\b/g, weight: 4, cap: 4 },
  { pattern: /^#+\s.+$/gm, weight: 3, cap: 6 },
  { pattern: /^[-*]\s.+$/gm, weight: 2, cap: 8 },
  { pattern: /^```/gm, weight: 2, cap: 2 },
] as const

const COMMIT_SIGNAL_PATTERNS = [
  { pattern: /\b(breaking|deprecated|deprecation|removed|renamed|migration|requires?)\b/gi, weight: 16, cap: 3 },
  { pattern: /\b(new|introduce[ds]?|add(?:ed)?|update[ds]?|change[ds]?|support(?:s|ed)?)\b/gi, weight: 7, cap: 5 },
  { pattern: /\b(model|api|config|setting|parameter|plugin|skill|agent|mcp|version|release)\b/gi, weight: 4, cap: 6 },
] as const

const NOISE_PATH_PATTERNS = [
  /(^|\/)(example|examples|sample|samples|test|tests|fixture|fixtures|mock|mocks)(\/|$)/i,
  /(^|\/)(images|assets|screenshots|media)(\/|$)/i,
  /\.github\//i,
] as const

const NOISE_PREVIEW_PATTERNS = [
  { pattern: /\b(typo|spelling|grammar|format(?:ting)?|whitespace|lint|prettier)\b/gi, weight: 8, cap: 4 },
  { pattern: /https?:\/\/\S+/g, weight: 2, cap: 8 },
  { pattern: /!\[[^\]]*\]\([^)]+\)/g, weight: 4, cap: 4 },
] as const

interface SkillsDiffResult {
  status: "updated"
  source: AuthoritativeSourceGit
  repo: string
  label: string
  tier: "HIGH" | "MEDIUM"
  commits: string[]
  changedFiles: string[]
  diffContent: string
  pinnedSha: string
  latestSha: string
}

export interface SkillsDiffNoChangeResult {
  status: "no_change"
  source: AuthoritativeSourceGit
  pinnedSha: string
  latestSha: string
}

export interface SkillsDiffErrorResult {
  status: "error"
  source: AuthoritativeSourceGit
  error: string
}

export type SkillsDiffOutcome =
  | SkillsDiffResult
  | SkillsDiffNoChangeResult
  | SkillsDiffErrorResult

interface ChangedFileStat {
  path: string
  added: number
  deleted: number
  total: number
  pathScore: number
  semanticScore: number
  commitScore: number
  noisePenalty: number
  score: number
  selectionReasons: string[]
}

function scoreChangedFile(path: string, added: number, deleted: number): number {
  const normalizedPath = path.toLowerCase()
  const keywordBoost = DIFF_KEYWORDS.reduce((score, keyword) => {
    return normalizedPath.includes(keyword) ? score + 6 : score
  }, 0)

  const locationBoost =
    normalizedPath.includes("release") || normalizedPath.includes("changelog")
      ? 10
      : normalizedPath.endsWith("skill.md")
        ? 8
        : normalizedPath.includes("/skills/")
          ? 5
          : 0

  const changeMagnitude = Math.min(added + deleted, 120)

  return changeMagnitude + keywordBoost + locationBoost
}

function countMatches(pattern: RegExp, text: string): number {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`
  const matcher = new RegExp(pattern.source, flags)
  let matches = 0

  while (matcher.exec(text)) {
    matches += 1
  }

  return matches
}

function scoreDiffPreview(preview: string): number {
  const semanticSignals = SEMANTIC_SIGNAL_PATTERNS.reduce((score, signal) => {
    return score + Math.min(countMatches(signal.pattern, preview), signal.cap) * signal.weight
  }, 0)

  const changedLines = preview
    .split("\n")
    .filter((line) => /^(?:\+|-)(?!\+\+\+|---)/.test(line))

  const metadataSignals = changedLines.reduce((score, line) => {
    if (/^(?:\+|-)[A-Za-z0-9_-]+:\s/.test(line)) {
      return score + 5
    }

    if (/^(?:\+|-)\s*#+\s/.test(line)) {
      return score + 4
    }

    if (/^(?:\+|-)\s*[-*]\s/.test(line)) {
      return score + 2
    }

    return score
  }, 0)

  return semanticSignals + Math.min(changedLines.length, 40) + metadataSignals
}

function scoreCommitMessages(messages: string[]): number {
  const joined = messages.join("\n")
  return COMMIT_SIGNAL_PATTERNS.reduce((score, signal) => {
    return score + Math.min(countMatches(signal.pattern, joined), signal.cap) * signal.weight
  }, 0)
}

function scoreNoise(path: string, preview: string): number {
  const pathPenalty = NOISE_PATH_PATTERNS.reduce((penalty, pattern) => {
    return penalty + (pattern.test(path) ? 12 : 0)
  }, 0)

  const previewPenalty = NOISE_PREVIEW_PATTERNS.reduce((penalty, signal) => {
    return penalty + Math.min(countMatches(signal.pattern, preview), signal.cap) * signal.weight
  }, 0)

  return pathPenalty + previewPenalty
}

function buildSelectionReasons(file: ChangedFileStat): string[] {
  const reasons: string[] = []

  if (file.pathScore > 0) {
    reasons.push(`path ${file.pathScore}`)
  }
  if (file.semanticScore > 0) {
    reasons.push(`content ${file.semanticScore}`)
  }
  if (file.commitScore > 0) {
    reasons.push(`commit ${file.commitScore}`)
  }
  if (file.noisePenalty > 0) {
    reasons.push(`noise -${file.noisePenalty}`)
  }

  if (reasons.length === 0) {
    reasons.push("baseline only")
  }

  return reasons
}

function summarizeChangedFiles(changedFiles: string[]): string {
  if (changedFiles.length <= MAX_CHANGED_FILES_LIST) {
    return changedFiles.join("\n")
  }

  const visible = changedFiles.slice(0, MAX_CHANGED_FILES_LIST).join("\n")
  const omitted = changedFiles.length - MAX_CHANGED_FILES_LIST
  return `${visible}\n...and ${omitted} more changed files`
}

/** Fetch latest from remote for a submodule without mutating the worktree */
async function fetchSubmodule(submodulePath: string): Promise<void> {
  await execFileAsync("git", ["fetch", "origin"], {
    cwd: submodulePath,
    timeout: 15000,
  })
}

/** Get the current (pinned) HEAD SHA */
async function getPinnedSha(submodulePath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "HEAD"], {
    cwd: submodulePath,
  })
  return stdout.trim()
}

/** Get the latest remote main SHA */
async function getLatestSha(submodulePath: string): Promise<string> {
  const { stdout } = await execFileAsync("git", ["rev-parse", "origin/main"], {
    cwd: submodulePath,
  })
  return stdout.trim()
}

/** Get commit messages between two SHAs */
async function getCommitLog(
  submodulePath: string,
  fromSha: string,
  toSha: string
): Promise<string[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["log", "--oneline", `--max-count=${MAX_COMMIT_LOG_LINES}`, `${fromSha}..${toSha}`],
    { cwd: submodulePath }
  )
  return stdout.trim().split("\n").filter(Boolean)
}

/** Get changed .md files and line stats between two SHAs */
async function getChangedFileStats(
  submodulePath: string,
  fromSha: string,
  toSha: string
): Promise<ChangedFileStat[]> {
  const { stdout } = await execFileAsync(
    "git",
    ["diff", "--numstat", `${fromSha}..${toSha}`, "--", "*.md"],
    { cwd: submodulePath }
  )

  return stdout
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [addedRaw, deletedRaw, ...pathParts] = line.split("\t")
      const path = pathParts.join("\t")
      const added = Number.parseInt(addedRaw, 10)
      const deleted = Number.parseInt(deletedRaw, 10)
      const safeAdded = Number.isFinite(added) ? added : 0
      const safeDeleted = Number.isFinite(deleted) ? deleted : 0

      return {
        path,
        added: safeAdded,
        deleted: safeDeleted,
        total: safeAdded + safeDeleted,
        pathScore: scoreChangedFile(path, safeAdded, safeDeleted),
        semanticScore: 0,
        commitScore: 0,
        noisePenalty: 0,
        score: scoreChangedFile(path, safeAdded, safeDeleted),
        selectionReasons: [],
      }
    })
}

async function readDiffPreview(
  submodulePath: string,
  fromSha: string,
  toSha: string,
  filePath: string
): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(
      "git",
      ["diff", "--unified=1", `${fromSha}..${toSha}`, "--", filePath],
      {
        cwd: submodulePath,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )

    let stdout = ""
    let stderr = ""
    let truncated = false
    let intentionalStop = false

    child.stdout.on("data", (chunk) => {
      if (truncated) {
        return
      }

      stdout += chunk.toString()
      if (stdout.length >= MAX_DIFF_PREVIEW_CHARS) {
        stdout = stdout.slice(0, MAX_DIFF_PREVIEW_CHARS)
        truncated = true
        intentionalStop = true
        child.kill("SIGTERM")
      }
    })

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    child.on("close", (code, signal) => {
      if (intentionalStop && signal === "SIGTERM") {
        resolve(`${stdout}\n\n[...preview truncated for semantic scoring]`)
        return
      }

      if (code !== 0) {
        reject(new Error(stderr.trim() || `git diff preview exited with code ${code}`))
        return
      }

      resolve(stdout)
    })
  })
}

async function enrichChangedFilesWithSemanticScore(
  submodulePath: string,
  fromSha: string,
  toSha: string,
  changedFiles: ChangedFileStat[]
): Promise<ChangedFileStat[]> {
  const candidates = [...changedFiles]
    .sort((a, b) => b.pathScore - a.pathScore || b.total - a.total)
    .slice(0, MAX_SEMANTIC_PREVIEW_FILES)

  const previews = await Promise.all(
    candidates.map(async (file) => {
      try {
        const preview = await readDiffPreview(submodulePath, fromSha, toSha, file.path)
        return [file.path, preview] as const
      } catch {
        return [file.path, ""] as const
      }
    })
  )

  const previewTexts = new Map(previews)

  const commitSignals = await Promise.all(
    candidates.map(async (file) => {
      try {
        const { stdout } = await execFileAsync(
          "git",
          [
            "log",
            "--format=%s",
            `--max-count=${Math.max(MAX_COMMIT_LOG_LINES, 12)}`,
            `${fromSha}..${toSha}`,
            "--",
            file.path,
          ],
          { cwd: submodulePath }
        )
        const messages = stdout.trim().split("\n").filter(Boolean)
        return [file.path, scoreCommitMessages(messages)] as const
      } catch {
        return [file.path, 0] as const
      }
    })
  )

  const commitScores = new Map(commitSignals)

  return changedFiles.map((file) => {
    const preview = previewTexts.get(file.path) ?? ""
    const semanticScore = preview ? scoreDiffPreview(preview) : 0
    const commitScore = commitScores.get(file.path) ?? 0
    const noisePenalty = preview ? scoreNoise(file.path, preview) : scoreNoise(file.path, "")
    const score = Math.max(file.pathScore + semanticScore + commitScore - noisePenalty, 0)
    const enrichedFile = {
      ...file,
      semanticScore,
      commitScore,
      noisePenalty,
      score,
    }

    return {
      ...enrichedFile,
      selectionReasons: buildSelectionReasons(enrichedFile),
    }
  })
}

async function writeDiffForFile(
  submodulePath: string,
  fromSha: string,
  toSha: string,
  filePath: string,
  outputPath: string
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "git",
      ["diff", "--unified=2", `${fromSha}..${toSha}`, "--", filePath],
      {
        cwd: submodulePath,
        stdio: ["ignore", "pipe", "pipe"],
      }
    )

    const output = createWriteStream(outputPath)
    let stderr = ""
    let childClosed = false
    let streamFinished = false

    const maybeResolve = () => {
      if (childClosed && streamFinished) {
        resolve()
      }
    }

    child.stdout.pipe(output)
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString()
    })

    child.on("error", reject)
    output.on("error", reject)
    output.on("finish", () => {
      streamFinished = true
      maybeResolve()
    })
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `git diff exited with code ${code}`))
        return
      }

      childClosed = true
      maybeResolve()
    })
  })
}

async function materializeDiffContent(
  submodulePath: string,
  fromSha: string,
  toSha: string,
  changedFiles: ChangedFileStat[]
): Promise<string> {
  const selectedFiles = [...changedFiles]
    .sort((a, b) => b.score - a.score || b.total - a.total)
    .slice(0, MAX_SELECTED_DIFF_FILES)

  const tempDir = await fs.mkdtemp(join(tmpdir(), "driftcheck-skills-"))

  try {
    const sections = await Promise.all(
      selectedFiles.map(async (file, index) => {
        const outputPath = join(tempDir, `${index}-${file.path.replace(/[\\/]/g, "__")}.patch`)
        await writeDiffForFile(submodulePath, fromSha, toSha, file.path, outputPath)
        const diff = await fs.readFile(outputPath, "utf8")
        const excerpt =
          diff.length > MAX_DIFF_EXCERPT_CHARS
            ? `${diff.slice(0, MAX_DIFF_EXCERPT_CHARS)}\n\n[...truncated after ${MAX_DIFF_EXCERPT_CHARS} chars from disk-backed patch artifact]`
            : diff

        return (
          `### ${file.path}\n` +
          `Change stats: +${file.added} / -${file.deleted} (score ${file.score})\n` +
          `Selection reasons: ${file.selectionReasons.join(", ")}\n` +
          `${excerpt}`
        )
      })
    )

    const manifest = changedFiles
      .slice()
      .sort((a, b) => b.score - a.score || b.total - a.total)
      .slice(0, MAX_CHANGED_FILES_LIST)
      .map(
        (file) =>
          `- ${file.path} (+${file.added}/-${file.deleted}, score ${file.score}; ${file.selectionReasons.join(", ")})`
      )
      .join("\n")

    const omittedFiles = Math.max(changedFiles.length - MAX_CHANGED_FILES_LIST, 0)

    return (
      `Diff manifest (top ${Math.min(changedFiles.length, MAX_CHANGED_FILES_LIST)} by relevance):\n` +
      `${manifest || "- none"}\n` +
      (omittedFiles > 0 ? `...and ${omittedFiles} more changed markdown files\n\n` : "\n") +
      `Selected patch excerpts (${sections.length} files materialized from disk-backed artifacts):\n\n` +
      `${sections.join("\n\n")}`
    )
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true })
  }
}

/** Diff a single git source submodule against its remote */
export async function diffSubmodule(
  source: AuthoritativeSourceGit
): Promise<SkillsDiffOutcome> {
  return diffSubmoduleAtRoot(source, SKILLS_REPO_PATH)
}

/** Diff a single git source submodule against its remote from an arbitrary repo root */
export async function diffSubmoduleAtRoot(
  source: AuthoritativeSourceGit,
  repoRoot: string
): Promise<SkillsDiffOutcome> {
  const submodulePath = join(repoRoot, source.submodule_path)

  try {
    await fetchSubmodule(submodulePath)
    const pinnedSha = await getPinnedSha(submodulePath)
    const latestSha = await getLatestSha(submodulePath)

    if (pinnedSha === latestSha) {
      return {
        status: "no_change",
        source,
        pinnedSha,
        latestSha,
      }
    }

    const [commits, changedFileStats] = await Promise.all([
      getCommitLog(submodulePath, pinnedSha, latestSha),
      getChangedFileStats(submodulePath, pinnedSha, latestSha),
    ])

    const rankedChangedFiles = await enrichChangedFilesWithSemanticScore(
      submodulePath,
      pinnedSha,
      latestSha,
      changedFileStats
    )

    const changedFiles = rankedChangedFiles.map((file) => file.path)
    const diffContent = await materializeDiffContent(
      submodulePath,
      pinnedSha,
      latestSha,
      rankedChangedFiles
    )

    return {
      status: "updated",
      source,
      repo: source.repo,
      label: source.label,
      tier: source.tier as "HIGH" | "MEDIUM",
      commits,
      changedFiles,
      diffContent,
      pinnedSha,
      latestSha,
    }
  } catch (error) {
    return {
      status: "error",
      source,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

/** Diff all git sources in parallel */
export async function diffAllSubmodules(
  sources: AuthoritativeSourceGit[]
): Promise<SkillsDiffOutcome[]> {
  return diffAllSubmodulesAtRoot(sources, SKILLS_REPO_PATH)
}

/** Diff all git sources in parallel from an arbitrary repo root */
export async function diffAllSubmodulesAtRoot(
  sources: AuthoritativeSourceGit[],
  repoRoot: string
): Promise<SkillsDiffOutcome[]> {
  const results = await Promise.allSettled(
    sources.map((source) => diffSubmoduleAtRoot(source, repoRoot))
  )

  return results.map((result, index): SkillsDiffOutcome => {
    if (result.status === "fulfilled") {
      return result.value
    }

    return {
      status: "error",
      source: sources[index],
      error: String(result.reason),
    }
  })
}

function inferChangeType(diff: SkillsDiffResult): AuthoritativeChange["change_type"] {
  const joined = `${diff.commits.join("\n")}\n${diff.diffContent}`.toLowerCase()

  if (/\b(deprecat|rename|remove|drop|sunset)\b/.test(joined)) {
    return "deprecation"
  }

  if (/\b(breaking|migration|requires?)\b/.test(joined)) {
    return "breaking"
  }

  if (/\b(best practice|recommend|guidance|preferred)\b/.test(joined)) {
    return "best_practice"
  }

  return "additive"
}

export function buildAuthoritativeChangesFromDiffs(
  diffs: SkillsDiffResult[]
): AuthoritativeChange[] {
  return diffs.map((diff) => ({
    entity: diff.label,
    change_type: inferChangeType(diff),
    description: `${diff.label} is ${diff.commits.length} commits ahead of the pinned revision. Key files changed: ${diff.changedFiles.slice(0, 4).join(", ") || "upstream docs and skills content"}.`,
    date: new Date().toISOString(),
    version: diff.latestSha.slice(0, 7),
    source_url: `https://github.com/${diff.repo}`,
    source_label: diff.label,
  }))
}

/** Format diff results into a string suitable for GPT-4o entity extraction */
export function formatDiffsForExtraction(diffs: SkillsDiffResult[]): string {
  return diffs
    .map(
      (d) =>
        `## ${d.label} (${d.repo})\n` +
        `Tier: ${d.tier}\n` +
        `Commits (${d.commits.length}):\n${d.commits.join("\n")}\n\n` +
        `Changed files (${d.changedFiles.length}):\n${summarizeChangedFiles(d.changedFiles)}\n\n` +
        `Diff:\n${d.diffContent}`
    )
    .join("\n\n---\n\n")
}
