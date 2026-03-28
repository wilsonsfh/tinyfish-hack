import { execFile } from "child_process"
import { promises as fs } from "fs"
import { tmpdir } from "os"
import { basename, extname, join, resolve } from "path"
import { promisify } from "util"
import { AUTHORITATIVE_SOURCES } from "./sources"
import type { AuthoritativeSourceGit, Entity, EntityCategory, RepoDiffScope, SourceMeta } from "./types"

const execFileAsync = promisify(execFile)

const MAX_WALKED_FILES = 320
const MAX_TEXT_FILE_BYTES = 120_000
const MAX_EVIDENCE_FILES = 6

const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".venv",
  "venv",
  "__pycache__",
])

const TEXT_FILE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".md",
  ".mdx",
  ".txt",
  ".json",
  ".toml",
  ".yaml",
  ".yml",
])

const GENERIC_ALIAS_STOPWORDS = new Set([
  "official",
  "release",
  "releases",
  "changelog",
  "cookbook",
  "repo",
  "repository",
  "skills",
])

type SourceCandidate = {
  key: string
  subject: string
  label: string
  aliases: string[]
  category: EntityCategory
}

type CandidateEvidence = {
  score: number
  files: Set<string>
  reasons: Set<string>
}

type InventoryResult = {
  entities: Entity[]
  source: SourceMeta
  repoDiff: RepoDiffScope
}

type RankedCandidate = SourceCandidate & CandidateEvidence

export interface MaterializedRepoInput {
  repoPath: string
  repoLabel: string
  cleanup: () => Promise<void>
}

function normalize(value: string): string {
  return value.toLowerCase().trim()
}

function tokenize(value: string): string[] {
  return normalize(value)
    .replace(/[^a-z0-9.+/_-]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)]
}

function titleCase(value: string): string {
  return value
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (match) => match.toUpperCase())
}

function parseGitHubRepoUrl(repoUrl: string): { cloneUrl: string; repoLabel: string } {
  let parsed: URL

  try {
    parsed = new URL(repoUrl)
  } catch {
    throw new Error("Repo URL must be a valid URL.")
  }

  if (!/^github\.com$/i.test(parsed.hostname)) {
    throw new Error("Repo Diff GitHub URL support currently only accepts github.com URLs.")
  }

  const segments = parsed.pathname.split("/").filter(Boolean)
  if (segments.length < 2) {
    throw new Error("GitHub repo URL must look like https://github.com/owner/repo.")
  }

  const owner = segments[0]
  const repo = segments[1].replace(/\.git$/i, "")
  if (!owner || !repo) {
    throw new Error("GitHub repo URL must include both owner and repo.")
  }

  return {
    cloneUrl: `https://github.com/${owner}/${repo}.git`,
    repoLabel: repo,
  }
}

export async function materializeRepoInput(input: {
  repoPath?: string
  repoUrl?: string
}): Promise<MaterializedRepoInput> {
  const repoPath = input.repoPath?.trim()
  if (repoPath) {
    const resolvedPath = resolve(repoPath)
    const stat = await fs.stat(resolvedPath)
    if (!stat.isDirectory()) {
      throw new Error(`Repo path is not a directory: ${resolvedPath}`)
    }

    return {
      repoPath: resolvedPath,
      repoLabel: basename(resolvedPath),
      cleanup: async () => {},
    }
  }

  const repoUrl = input.repoUrl?.trim()
  if (!repoUrl) {
    throw new Error("repoPath or repoUrl is required for Repo Diff.")
  }

  const { cloneUrl, repoLabel } = parseGitHubRepoUrl(repoUrl)
  const tempDir = await fs.mkdtemp(join(tmpdir(), "driftcheck-repo-"))
  const targetDir = join(tempDir, repoLabel)

  try {
    await execFileAsync(
      "git",
      ["clone", "--depth", "1", "--recurse-submodules", "--shallow-submodules", cloneUrl, targetDir],
      {
        timeout: 120000,
        maxBuffer: 1024 * 1024,
      }
    )
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true })
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`GitHub clone failed for ${repoUrl}: ${message}`)
  }

  return {
    repoPath: targetDir,
    repoLabel,
    cleanup: async () => {
      await fs.rm(tempDir, { recursive: true, force: true })
    },
  }
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

function inferCategory(sourceKey: string): EntityCategory {
  if (sourceKey.includes("openai")) return "library"
  if (sourceKey.includes("langgraph")) return "framework"
  if (sourceKey.includes("instructor")) return "library"
  if (sourceKey.includes("crewai")) return "framework"
  if (sourceKey.includes("skills") || sourceKey === "ecc" || sourceKey.includes("superpowers")) {
    return "pattern"
  }

  return "library"
}

function buildSourceCandidates(): SourceCandidate[] {
  return Object.entries(AUTHORITATIVE_SOURCES).map(([key, source]) => {
    const subject = titleCase(
      key
        .replace(/\b(changelog|releases?|cookbook|official)\b/gi, " ")
        .replace(/\s+/g, " ")
    ) || source.label

    const aliases = unique(
      [
        key,
        source.label,
        subject,
        "repo" in source ? source.repo : "",
        "url" in source ? source.url : "",
        ...tokenize(key),
        ...tokenize(source.label),
        ...("repo" in source ? tokenize(source.repo) : []),
        ...("url" in source ? tokenize(source.url.replace(/^https?:\/\//, "")) : []),
      ]
        .map((alias) => normalize(alias))
        .filter((alias) => alias.length > 1 && !GENERIC_ALIAS_STOPWORDS.has(alias))
    )

    return {
      key,
      subject,
      label: source.label,
      aliases,
      category: inferCategory(key),
    }
  })
}

function relativeDisplayPath(repoPath: string, filePath: string): string {
  if (filePath.startsWith(repoPath)) {
    return filePath.slice(repoPath.length).replace(/^\/+/, "") || "."
  }

  return filePath
}

async function walkRepo(repoPath: string): Promise<string[]> {
  const files: string[] = []
  const queue = [repoPath]

  while (queue.length > 0 && files.length < MAX_WALKED_FILES) {
    const current = queue.shift()
    if (!current) break

    const entries = await fs.readdir(current, { withFileTypes: true })

    for (const entry of entries) {
      if (files.length >= MAX_WALKED_FILES) break

      const fullPath = join(current, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          queue.push(fullPath)
        }
        continue
      }

      if (entry.isFile()) {
        files.push(fullPath)
      }
    }
  }

  return files
}

async function safeReadText(filePath: string): Promise<string> {
  const stat = await fs.stat(filePath)

  if (stat.size > MAX_TEXT_FILE_BYTES) {
    return ""
  }

  const extension = extname(filePath).toLowerCase()
  const basenameLower = basename(filePath).toLowerCase()
  const knownManifest =
    basenameLower === "package.json" ||
    basenameLower === "requirements.txt" ||
    basenameLower === "pyproject.toml" ||
    basenameLower === "vercel.json" ||
    basenameLower === "agents.md" ||
    basenameLower === "claude.md" ||
    basenameLower === ".gitmodules" ||
    basenameLower === "readme.md"

  if (!knownManifest && !TEXT_FILE_EXTENSIONS.has(extension)) {
    return ""
  }

  return fs.readFile(filePath, "utf8").catch(() => "")
}

function parsePackageJsonDependencies(content: string): string[] {
  try {
    const payload = JSON.parse(content) as Record<string, unknown>
    const sections = [
      payload.dependencies,
      payload.devDependencies,
      payload.peerDependencies,
      payload.optionalDependencies,
    ]

    return sections.flatMap((section) => (
      section && typeof section === "object"
        ? Object.keys(section as Record<string, unknown>)
        : []
    ))
  } catch {
    return []
  }
}

function parseRequirements(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => line.split(/[<>=!~\s\[]/, 1)[0]?.trim() ?? "")
    .filter(Boolean)
}

function parsePyprojectDependencies(content: string): string[] {
  return [...content.matchAll(/["']([a-zA-Z0-9_.-]+)(?:[<>=!~][^"']*)?["']/g)]
    .map((match) => match[1].trim())
    .filter(Boolean)
}

function parseImportHits(content: string, aliases: string[]): number {
  const normalized = normalize(content)

  return aliases.reduce((score, alias) => {
    const importLike =
      countOccurrences(normalized, `from "${alias}"`) +
      countOccurrences(normalized, `from '${alias}'`) +
      countOccurrences(normalized, `require("${alias}")`) +
      countOccurrences(normalized, `require('${alias}')`) +
      countOccurrences(normalized, `import ${alias}`) +
      countOccurrences(normalized, `use ${alias}`)

    return score + Math.min(importLike, 3)
  }, 0)
}

function parseGitmodules(content: string): Array<{ path: string; url?: string; name: string }> {
  const submodules: Array<{ path: string; url?: string; name: string }> = []
  const lines = content.split("\n")
  let current: { path?: string; url?: string; name?: string } = {}

  const pushCurrent = () => {
    if (current.path) {
      submodules.push({
        path: current.path,
        url: current.url,
        name: current.name ?? basename(current.path),
      })
    }
  }

  for (const line of lines) {
    const sectionMatch = line.match(/^\s*\[submodule "(.+)"\]\s*$/)
    if (sectionMatch) {
      pushCurrent()
      current = { name: sectionMatch[1] }
      continue
    }

    const pathMatch = line.match(/^\s*path\s*=\s*(.+)\s*$/)
    if (pathMatch) {
      current.path = pathMatch[1].trim()
      continue
    }

    const urlMatch = line.match(/^\s*url\s*=\s*(.+)\s*$/)
    if (urlMatch) {
      current.url = urlMatch[1].trim()
    }
  }

  pushCurrent()
  return submodules
}

function remoteToRepo(remote: string | undefined, fallback: string): string {
  if (!remote) return fallback

  const normalizedRemote = remote.trim().replace(/\.git$/, "")
  const githubHttps = normalizedRemote.match(/github\.com[:/](.+\/.+)$/i)
  if (githubHttps) {
    return githubHttps[1]
  }

  return normalizedRemote
}

export async function discoverRepoSubmodules(repoPath: string): Promise<AuthoritativeSourceGit[]> {
  const gitmodulesPath = join(repoPath, ".gitmodules")
  const gitmodules = await fs.readFile(gitmodulesPath, "utf8").catch(() => "")

  if (!gitmodules) {
    return []
  }

  return parseGitmodules(gitmodules).map((submodule) => {
    const repo = remoteToRepo(submodule.url, submodule.path)
    const label = titleCase(basename(submodule.path))

    return {
      type: "git",
      repo,
      submodule_path: submodule.path,
      tier: "MEDIUM",
      label,
    } satisfies AuthoritativeSourceGit
  })
}

function buildInventorySummary(
  repoPath: string,
  repoLabel: string,
  manifestFiles: string[],
  selectedCandidates: RankedCandidate[],
  submodules: AuthoritativeSourceGit[],
  scannedFiles: number
): string {
  const directTools = selectedCandidates.length > 0
    ? selectedCandidates
        .map((candidate) => {
          const evidenceFiles = [...candidate.files]
            .slice(0, MAX_EVIDENCE_FILES)
            .map((file) => `  - ${file}`)
            .join("\n")

          return [
            `- ${candidate.subject} (score ${candidate.score})`,
            `  Reasons: ${[...candidate.reasons].join(", ")}`,
            evidenceFiles || "  - direct evidence not recorded",
          ].join("\n")
        })
        .join("\n")
    : "- No supported authoritative tools were detected from first-order repo evidence."

  const manifestBlock = manifestFiles.length > 0
    ? manifestFiles.map((file) => `- ${file}`).join("\n")
    : "- No supported manifest/config files were detected."

  const submoduleBlock = submodules.length > 0
    ? submodules
        .map((submodule) => `- ${submodule.label} (${submodule.repo}) at ${submodule.submodule_path}`)
        .join("\n")
    : "- No git submodules detected."

  return [
    "# DriftCheck Repo Inventory",
    "",
    `Repo: ${repoLabel}`,
    `Path: ${repoPath}`,
    `Scanned files: ${scannedFiles}`,
    "",
    "## Direct manifest and config evidence",
    manifestBlock,
    "",
    "## Supported tools detected from direct repo evidence",
    directTools,
    "",
    "## Submodules",
    submoduleBlock,
    "",
    "Treat this inventory as the repository's current local state for repo-level drift analysis.",
  ].join("\n")
}

function buildContext(
  candidate: SourceCandidate & CandidateEvidence,
  repoLabel: string
): string {
  const evidenceFiles = [...candidate.files].slice(0, 3).join(", ")
  return `${candidate.subject} is referenced directly in ${repoLabel} (${evidenceFiles || "repo inventory"}).`
}

export async function inventoryRepo(repoPathInput: string): Promise<InventoryResult> {
  const repoPath = resolve(repoPathInput.trim())
  const stat = await fs.stat(repoPath)

  if (!stat.isDirectory()) {
    throw new Error(`Repo path is not a directory: ${repoPath}`)
  }

  const repoLabel = basename(repoPath)
  const files = await walkRepo(repoPath)
  const candidates = buildSourceCandidates()
  const evidence = new Map<string, CandidateEvidence>(
    candidates.map((candidate) => [candidate.key, { score: 0, files: new Set<string>(), reasons: new Set<string>() }])
  )
  const manifestFiles = new Set<string>()
  const submodules = await discoverRepoSubmodules(repoPath)

  for (const file of files) {
    const content = await safeReadText(file)
    if (!content) continue

    const displayPath = relativeDisplayPath(repoPath, file)
    const basenameLower = basename(file).toLowerCase()
    const normalizedContent = normalize(content)

    const dependencyNames = basenameLower === "package.json"
      ? parsePackageJsonDependencies(content)
      : basenameLower === "requirements.txt"
        ? parseRequirements(content)
        : basenameLower === "pyproject.toml"
          ? parsePyprojectDependencies(content)
          : []

    if (
      basenameLower === "package.json" ||
      basenameLower === "requirements.txt" ||
      basenameLower === "pyproject.toml" ||
      basenameLower === "vercel.json" ||
      basenameLower === "agents.md" ||
      basenameLower === "claude.md" ||
      basenameLower === ".gitmodules"
    ) {
      manifestFiles.add(displayPath)
    }

    for (const candidate of candidates) {
      const candidateEvidence = evidence.get(candidate.key)
      if (!candidateEvidence) continue

      const dependencyHits = dependencyNames.filter((dependency) =>
        candidate.aliases.includes(normalize(dependency))
      ).length

      if (dependencyHits > 0) {
        candidateEvidence.score += dependencyHits * 35
        candidateEvidence.files.add(displayPath)
        candidateEvidence.reasons.add("dependency manifest")
      }

      const importHits = parseImportHits(content, candidate.aliases)
      if (importHits > 0) {
        candidateEvidence.score += Math.min(importHits, 4) * 12
        candidateEvidence.files.add(displayPath)
        candidateEvidence.reasons.add("direct import or usage")
      }

      const textHits = candidate.aliases.reduce((score, alias) => {
        return score + Math.min(countOccurrences(normalizedContent, alias), 3)
      }, 0)

      if (textHits > 0) {
        candidateEvidence.score += Math.min(textHits, 5) * 5
        candidateEvidence.files.add(displayPath)
        candidateEvidence.reasons.add(
          manifestFiles.has(displayPath) ? "config mention" : "repo mention"
        )
      }
    }
  }

  for (const submodule of submodules) {
    const normalizedRepo = normalize(submodule.repo)
    const normalizedPath = normalize(submodule.submodule_path)

    for (const candidate of candidates) {
      const candidateEvidence = evidence.get(candidate.key)
      if (!candidateEvidence) continue

      const matched = candidate.aliases.some((alias) => (
        normalizedRepo.includes(alias) || normalizedPath.includes(alias)
      ))

      if (matched) {
        candidateEvidence.score += 40
        candidateEvidence.files.add(".gitmodules")
        candidateEvidence.reasons.add("submodule reference")
      }
    }
  }

  const rankedCandidates = candidates
    .map((candidate) => ({
      ...candidate,
      ...(evidence.get(candidate.key) ?? { score: 0, files: new Set<string>(), reasons: new Set<string>() }),
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 8)

  const groupedCandidates = [...rankedCandidates.reduce((groups, candidate) => {
    const existing = groups.get(candidate.subject)
    if (!existing) {
      groups.set(candidate.subject, {
        ...candidate,
        aliases: [...candidate.aliases],
        files: new Set(candidate.files),
        reasons: new Set(candidate.reasons),
      })
      return groups
    }

    existing.score += candidate.score
    existing.aliases = unique([...existing.aliases, ...candidate.aliases])
    candidate.files.forEach((file) => existing.files.add(file))
    candidate.reasons.forEach((reason) => existing.reasons.add(reason))
    return groups
  }, new Map<string, RankedCandidate>()).values()]
    .sort((left, right) => right.score - left.score)

  const selectedSubjects = groupedCandidates.length > 0
    ? groupedCandidates.map((candidate) => candidate.subject)
    : [titleCase(repoLabel)]
  const authoritySourceKeys = rankedCandidates.map((candidate) => candidate.key)
  const searchTerms = unique([
    ...groupedCandidates.flatMap((candidate) => candidate.aliases),
    ...selectedSubjects.flatMap(tokenize),
    ...submodules.map((submodule) => normalize(submodule.label)),
  ]).slice(0, 28)

  const entities: Entity[] = groupedCandidates.map((candidate) => ({
    name: candidate.subject,
    category: candidate.category,
    signal_strength: Math.max(1, Math.min(candidate.score, 100)),
    context: buildContext(candidate, repoLabel),
    source: "repo_inventory",
  }))

  const inventorySummary = buildInventorySummary(
    repoPath,
    repoLabel,
    [...manifestFiles].sort(),
    groupedCandidates,
    submodules,
    files.length
  )

  return {
    entities,
    source: {
      stage: "discovery",
      url: `file://${repoPath}`,
      label: `Repo Inventory (${repoLabel})`,
      scraped_at: new Date().toISOString(),
      source_type: "repo_inventory",
      status: "live",
      fallback_detail: `Scanned ${files.length} files, ${manifestFiles.size} manifest/config files, and ${submodules.length} submodules.`,
    },
    repoDiff: {
      mode: "repo-diff",
      repoPath,
      repoLabel,
      inventorySummary,
      selectedSubjects,
      authoritySourceKeys,
      searchTerms,
      manifestFiles: [...manifestFiles].sort(),
      submodules: submodules.map((submodule) => submodule.label),
      explanation: [
        `Scanning local repo: ${repoLabel}.`,
        groupedCandidates.length > 0
          ? `Detected supported tools from direct evidence: ${selectedSubjects.join(", ")}.`
          : "No supported authoritative tools were detected from first-order repo evidence.",
        submodules.length > 0
          ? `Detected ${submodules.length} submodule${submodules.length === 1 ? "" : "s"} for non-destructive upstream diffing.`
          : "No submodules were detected in this repo.",
      ],
    },
  }
}
