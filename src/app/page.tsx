"use client"

import Image from "next/image"
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react"
import { fallbackReasonLabel } from "@/lib/fallbacks"
import { buildQuickCheckConfigContent } from "@/lib/quick-check"
import type {
  Finding,
  PipelineEvent,
  QuickCheckScope,
  RepoDiffScope,
  SourceMeta,
  StageId,
  StageState,
} from "@/lib/types"
import { Pipeline } from "@/components/Pipeline"
import StageDetail from "@/components/StageDetail"
import FileUpload from "@/components/FileUpload"
import FindingCard from "@/components/FindingCard"
import DiffView from "@/components/DiffView"
import SourcesPanel from "@/components/SourcesPanel"
import RunSummary from "@/components/RunSummary"

const CONFIDENCE_TIERS = new Set(["HIGH", "MEDIUM", "LOW", "CONFLICT"] as const)
const IMPACT_TYPES = new Set(["breaking", "deprecation", "additive", "best_practice"] as const)
const SOURCE_TYPES = new Set(["tinyfish", "git_diff", "fixture", "repo_inventory"] as const)
const SOURCE_STATUSES = new Set(["live", "cached", "unavailable"] as const)
const STAGE_IDS = new Set(["discovery", "skills-diff", "resolution", "diff", "confidence", "output"] as const)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function safeString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function safeOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined
}

function normalizeConfidenceTier(value: unknown): Finding["tier"] {
  return typeof value === "string" && CONFIDENCE_TIERS.has(value as Finding["tier"])
    ? (value as Finding["tier"])
    : "LOW"
}

function normalizeImpactType(value: unknown): Finding["impact"] {
  return typeof value === "string" && IMPACT_TYPES.has(value as Finding["impact"])
    ? (value as Finding["impact"])
    : "best_practice"
}

function sanitizeProvenance(steps: unknown): Finding["provenance"] {
  if (!Array.isArray(steps)) return []

  return steps
    .map((step, index) => {
      if (!isObject(step)) {
        return {
          source: `Source ${index + 1}`,
          summary: "No provenance summary was provided.",
          tier: "LOW" as const,
        }
      }

      return {
        source: safeString(step.source, `Source ${index + 1}`),
        url: safeOptionalString(step.url),
        date: safeOptionalString(step.date),
        summary: safeString(step.summary, "No provenance summary was provided."),
        tier: normalizeConfidenceTier(step.tier),
      }
    })
    .filter((step) => step.source.trim() !== "" || step.summary.trim() !== "")
}

function sanitizeFinding(finding: unknown, index: number): Finding {
  if (!isObject(finding)) {
    return {
      entity: `Finding ${index + 1}`,
      claim: "Malformed finding payload received.",
      tier: "LOW",
      justification: "The server returned an unexpected finding shape, so DriftCheck normalized it for display.",
      source_url: "",
      source_date: "",
      impact: "best_practice",
      affected_file: "unknown",
      suggested_change: "Review the finding details manually.",
      replacement_text: undefined,
      provenance: [],
    }
  }

  const affectedLine =
    typeof finding.affected_line === "number" &&
    Number.isInteger(finding.affected_line) &&
    finding.affected_line > 0
      ? finding.affected_line
      : undefined

  return {
    entity: safeString(finding.entity, `Finding ${index + 1}`),
    claim: safeString(finding.claim, "No claim provided."),
    tier: normalizeConfidenceTier(finding.tier),
    justification: safeString(
      finding.justification,
      "No justification was provided for this finding."
    ),
    source_url: safeString(finding.source_url),
    source_date: safeString(finding.source_date),
    impact: normalizeImpactType(finding.impact),
    affected_file: safeString(finding.affected_file, "unknown"),
    affected_line: affectedLine,
    suggested_change: safeString(
      finding.suggested_change,
      "Review the underlying source and update this file manually."
    ),
    replacement_text: safeOptionalString(finding.replacement_text),
    provenance: sanitizeProvenance(finding.provenance),
  }
}

function sanitizeSource(source: unknown, index: number): SourceMeta {
  if (!isObject(source)) {
    return {
      stage: "output",
      url: "",
      label: `Source ${index + 1}`,
      scraped_at: new Date().toISOString(),
      source_type: "fixture",
      status: "unavailable",
      fallback_reason: "unknown_failure",
      fallback_detail: "Malformed source payload received.",
    }
  }

  const stage =
    typeof source.stage === "string" && STAGE_IDS.has(source.stage as StageId)
      ? (source.stage as StageId)
      : "output"
  const sourceType =
    typeof source.source_type === "string" && SOURCE_TYPES.has(source.source_type as SourceMeta["source_type"])
      ? (source.source_type as SourceMeta["source_type"])
      : "fixture"
  const status =
    typeof source.status === "string" && SOURCE_STATUSES.has(source.status as SourceMeta["status"])
      ? (source.status as SourceMeta["status"])
      : "unavailable"

  return {
    stage,
    url: safeString(source.url),
    label: safeString(source.label, `Source ${index + 1}`),
    scraped_at: safeString(source.scraped_at, new Date().toISOString()),
    source_type: sourceType,
    status,
    fallback_reason: safeOptionalString(source.fallback_reason) as SourceMeta["fallback_reason"] | undefined,
    fallback_detail: safeOptionalString(source.fallback_detail),
  }
}

const INITIAL_STAGES: StageState[] = [
  { id: "discovery", label: "Discovery", status: "idle", usedFallback: false },
  { id: "skills-diff", label: "Skills Diff", status: "idle", usedFallback: false },
  { id: "resolution", label: "Authoritative Check", status: "idle", usedFallback: false },
  { id: "diff", label: "Config Diff", status: "idle", usedFallback: false },
  { id: "confidence", label: "Trust Scoring", status: "idle", usedFallback: false },
  { id: "output", label: "Output", status: "idle", usedFallback: false },
]

type TabId = "summary" | "findings" | "diff" | "sources" | "detail"
type WorkbenchMode = "quick-check" | "config-diff" | "repo-diff"

const MODE_SUMMARY = [
  {
    title: "Quick Check",
    stat: "~60%",
    note: "Cuts lookup time for one tool or skill question.",
  },
  {
    title: "Config Diff",
    stat: "~45%",
    note: "Cuts manual review when you already have local config or notes.",
  },
  {
    title: "Repo Diff",
    stat: "~70%",
    note: "Cuts repo maintenance triage for skills, references, and dependencies.",
  },
] as const

const MODE_COMPARISON = [
  {
    mode: "Quick Check",
    input: "Question",
    output: "Scoped findings",
    speed: "Fast",
    bestFor: "Checking one tool, skill, or provider without uploading a file.",
  },
  {
    mode: "Config Diff",
    input: "Config or notes",
    output: "Suggested updates",
    speed: "Most direct",
    bestFor: "Comparing a local setup against current authoritative guidance.",
  },
  {
    mode: "Repo Diff",
    input: "Folder or GitHub URL",
    output: "Repo recommendations",
    speed: "Deep scan",
    bestFor: "Reviewing skills, references, and dependency drift across a repo.",
  },
] as const

const INTEGRATIONS = [
  { name: "TinyFish", role: "live web intake" },
  { name: "OpenAI", role: "typed extraction + diffing" },
  { name: "GitHub", role: "repo intake" },
  { name: "Claude Code", role: "skill + config drift" },
  { name: "Codex", role: "agentic workflow checks" },
] as const

const DOC_LINKS = [
  {
    label: "Documentation",
    href: "https://github.com/wilsonsfh/tinyfish-hack#readme",
  },
  {
    label: "Architecture",
    href: "https://github.com/wilsonsfh/tinyfish-hack/blob/main/ARCHITECTURE.md",
  },
]

type ThemeMode = "dark" | "light"

function uniqueSources(sources: SourceMeta[]): SourceMeta[] {
  const deduped = new Map<string, SourceMeta>()

  for (const source of sources) {
    const key = [
      source.stage,
      source.url,
      source.status,
      source.fallback_reason ?? "",
      source.fallback_detail ?? "",
    ].join("::")

    if (!deduped.has(key)) {
      deduped.set(key, source)
    }
  }

  return [...deduped.values()]
}

function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative inline-flex items-center">
      <button
        type="button"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/15 text-[10px] font-semibold text-stone-400 transition-colors hover:border-cyan-400/40 hover:text-stone-100"
        aria-label="More info"
      >
        i
      </button>
      <span className="pointer-events-none absolute left-0 top-full z-20 mt-2 hidden w-72 rounded-2xl border border-white/10 bg-[#101114] px-3 py-2 text-[11px] leading-relaxed text-stone-300 shadow-2xl shadow-black/40 group-hover:block group-focus-within:block">
        {text}
      </span>
    </span>
  )
}

function panelClass(extra = "") {
  return `rounded-[28px] border border-white/10 bg-white/[0.03] backdrop-blur-xl ${extra}`.trim()
}

function shellPanelClass(extra = "") {
  return `rounded-[30px] border border-[color:var(--chrome-border)] bg-[color:var(--chrome-surface)] shadow-[0_24px_80px_var(--chrome-shadow)] backdrop-blur-xl ${extra}`.trim()
}

function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: ThemeMode
  onToggle: () => void
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="inline-flex items-center gap-2 rounded-full border border-[color:var(--chrome-border)] bg-[color:var(--chrome-chip)] px-3 py-2 text-xs font-medium text-[color:var(--chrome-fg)] transition hover:border-[color:var(--chrome-border-strong)]"
      aria-label="Toggle color theme"
    >
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[color:var(--chrome-fg)]/8">
        {theme === "dark" ? (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2.5M12 19.5V22M4.93 4.93l1.77 1.77M17.3 17.3l1.77 1.77M2 12h2.5M19.5 12H22M4.93 19.07l1.77-1.77M17.3 6.7l1.77-1.77" />
          </svg>
        )}
      </span>
      <span>{theme === "dark" ? "Dark mode" : "Light mode"}</span>
    </button>
  )
}

function HeroCodePreview({
  quickCheckQuery,
  configFilename,
}: {
  quickCheckQuery: string
  configFilename: string
}) {
  const prompt = quickCheckQuery.trim() || "is my openai setup up to date?"
  const filename = configFilename || "sample-config.txt"

  return (
    <div className="rounded-[28px] border border-[#23314a] bg-[#0b1220] p-5 shadow-[0_30px_80px_rgba(2,6,23,0.55)]">
      <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-3">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-slate-500">
            Preview
          </p>
          <p className="mt-1 font-mono text-sm text-slate-200">{filename}</p>
        </div>
        <span className="rounded-full border border-cyan-400/25 bg-cyan-400/10 px-3 py-1 font-mono text-[11px] text-cyan-200">
          live + typed
        </span>
      </div>

      <div className="mt-4 space-y-3 font-mono text-[13px] leading-7 text-slate-200">
        <div>
          <span className="text-fuchsia-300">const</span>{" "}
          <span className="text-sky-300">scope</span>{" "}
          <span className="text-slate-500">=</span>{" "}
          <span className="text-cyan-300">quickCheck</span>
          <span className="text-slate-400">(</span>
          <span className="text-amber-300">&quot;{prompt}&quot;</span>
          <span className="text-slate-400">)</span>
        </div>
        <div>
          <span className="text-fuchsia-300">const</span>{" "}
          <span className="text-sky-300">source</span>{" "}
          <span className="text-slate-500">=</span>{" "}
          <span className="text-emerald-300">await</span>{" "}
          <span className="text-cyan-300">tinyfish.resolve</span>
          <span className="text-slate-400">(scope)</span>
        </div>
        <div>
          <span className="text-fuchsia-300">const</span>{" "}
          <span className="text-sky-300">diff</span>{" "}
          <span className="text-slate-500">=</span>{" "}
          <span className="text-emerald-300">await</span>{" "}
          <span className="text-cyan-300">openai.compare</span>
          <span className="text-slate-400">({"{"} baseline, source {"}"})</span>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        {[
          ["scope", "question -> subject"],
          ["verify", "TinyFish + fallback"],
          ["apply", "replacement_text"],
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-3">
            <p className="font-mono text-[10px] uppercase tracking-[0.24em] text-slate-500">
              {label}
            </p>
            <p className="mt-2 font-mono text-xs text-slate-200">{value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function IntegrationStrip() {
  return (
    <div className="flex flex-wrap items-center gap-3">
      {INTEGRATIONS.map((item) => (
        <div
          key={item.name}
          className="inline-flex items-center gap-3 rounded-full border border-[color:var(--chrome-border)] bg-[color:var(--chrome-chip)] px-4 py-2"
        >
          <span className="text-[12px] font-semibold text-[color:var(--chrome-fg)]">
            {item.name}
          </span>
          <span className="text-xs text-[color:var(--chrome-muted)]">{item.role}</span>
        </div>
      ))}
    </div>
  )
}

function FeatureComparisonTable() {
  return (
    <div className="overflow-hidden rounded-[24px] border border-[color:var(--chrome-border)]">
      <table className="w-full border-collapse text-left">
        <thead className="bg-[color:var(--chrome-chip)]">
          <tr className="border-b border-[color:var(--chrome-border)] text-[11px] uppercase tracking-[0.22em] text-[color:var(--chrome-muted)]">
            <th className="px-4 py-3 font-medium">Mode</th>
            <th className="px-4 py-3 font-medium">Input</th>
            <th className="px-4 py-3 font-medium">Output</th>
            <th className="px-4 py-3 font-medium">Speed</th>
            <th className="px-4 py-3 font-medium">Best for</th>
          </tr>
        </thead>
        <tbody>
          {MODE_COMPARISON.map((row) => (
            <tr
              key={row.mode}
              className="border-b border-[color:var(--chrome-border)] last:border-b-0"
            >
              <td className="px-4 py-4 font-medium text-[color:var(--chrome-fg)]">{row.mode}</td>
              <td className="px-4 py-4 text-sm text-[color:var(--chrome-muted)]">{row.input}</td>
              <td className="px-4 py-4 text-sm text-[color:var(--chrome-muted)]">{row.output}</td>
              <td className="px-4 py-4 text-sm text-[color:var(--chrome-fg)]">{row.speed}</td>
              <td className="px-4 py-4 text-sm leading-6 text-[color:var(--chrome-muted)]">{row.bestFor}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function Home() {
  const [theme, setTheme] = useState<ThemeMode>("light")
  
  // Custom hook for scroll-reveal
  const useScrollReveal = () => {
    const ref = useRef<HTMLDivElement>(null)
    useEffect(() => {
      const observer = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view")
        }
      }, { threshold: 0.15 })
      if (ref.current) observer.observe(ref.current)
      return () => observer.disconnect()
    }, [])
    return ref
  }
  
  const heroReveal = useScrollReveal()
  const toolsReveal = useScrollReveal()
  const [workbenchMode, setWorkbenchMode] = useState<WorkbenchMode>("quick-check")
  const [stages, setStages] = useState<StageState[]>(INITIAL_STAGES)
  const [activeStage, setActiveStage] = useState<StageId | null>(null)
  const [findings, setFindings] = useState<Finding[]>([])
  const [sources, setSources] = useState<SourceMeta[]>([])
  const [configContent, setConfigContent] = useState("")
  const [configFilename, setConfigFilename] = useState("")
  const [quickCheckQuery, setQuickCheckQuery] = useState("")
  const [quickCheckScope, setQuickCheckScope] = useState<QuickCheckScope | null>(null)
  const [repoPath, setRepoPath] = useState("")
  const [repoUrl, setRepoUrl] = useState("")
  const [repoDiffScope, setRepoDiffScope] = useState<RepoDiffScope | null>(null)
  const [uploadedRepoLabel, setUploadedRepoLabel] = useState("")
  const [isRepoDragging, setIsRepoDragging] = useState(false)
  const [isUploadingRepo, setIsUploadingRepo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<{ sent: number; total: number; fileCount: number; skipped: number } | null>(null)
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [runToast, setRunToast] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("findings")
  const abortRef = useRef<AbortController | null>(null)
  const repoInputRef = useRef<HTMLInputElement | null>(null)
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const stored =
      typeof window !== "undefined"
        ? window.localStorage.getItem("driftcheck-theme")
        : null

    if (stored === "dark" || stored === "light") {
      setTheme(stored)
      return
    }

    if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: light)").matches) {
      setTheme("light")
    }
  }, [])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem("driftcheck-theme", theme)
  }, [theme])

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        clearTimeout(toastTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      document.getElementById("workbench")?.scrollIntoView({ behavior: "smooth" })
    }, 1500)
    return () => clearTimeout(t)
  }, [])

  const updateStage = useCallback((id: StageId, updates: Partial<StageState>) => {
    setStages((prev) => prev.map((stage) => (stage.id === id ? { ...stage, ...updates } : stage)))
  }, [])

  const handleFileContent = useCallback((content: string, filename: string) => {
    setConfigContent(content)
    setConfigFilename(filename)
  }, [])

  const uploadRepoFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files)
    if (fileArray.length === 0) return

    // Filter out directories that are never useful for drift analysis
    const SKIP_DIRS = /^(node_modules|\.git|\.next|dist|build|out|\.turbo|\.cache|coverage|__pycache__|\.venv|venv)\//i
    const SKIP_EXTS = /\.(png|jpg|jpeg|gif|svg|ico|webp|woff|woff2|ttf|eot|otf|mp4|mp3|pdf|zip|gz|tar|lock|tsbuildinfo)$/i
    const MAX_FILE_BYTES = 500_000 // skip files >500KB

    const kept: File[] = []
    let skipped = 0
    for (const file of fileArray) {
      const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
      if (SKIP_DIRS.test(rel) || SKIP_EXTS.test(file.name) || file.size > MAX_FILE_BYTES) {
        skipped++
      } else {
        kept.push(file)
      }
    }

    if (kept.length === 0) {
      setRunError(`All ${fileArray.length} files were filtered out (node_modules, binaries, lock files). Try a different folder.`)
      return
    }

    setIsUploadingRepo(true)
    setUploadProgress({ sent: 0, total: 0, fileCount: kept.length, skipped })
    setRunError(null)

    try {
      const formData = new FormData()
      const firstFile = kept[0] as File & { webkitRelativePath?: string }
      const firstRelative = firstFile.webkitRelativePath || firstFile.name || "repo-upload"
      const rootName = firstRelative.split("/")[0] || "repo-upload"
      formData.append("rootName", rootName)
      for (const file of kept) {
        formData.append("files", file)
      }

      const payload = await new Promise<{ repoPath?: string; repoLabel?: string; uploadedFiles?: number; error?: string }>(
        (resolve, reject) => {
          const xhr = new XMLHttpRequest()
          xhr.open("POST", "/api/repo-upload")

          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              setUploadProgress({ sent: e.loaded, total: e.total, fileCount: kept.length, skipped })
            }
          }

          xhr.onload = () => {
            try {
              resolve(JSON.parse(xhr.responseText))
            } catch {
              reject(new Error("Invalid response from server."))
            }
          }
          xhr.onerror = () => reject(new Error("Network error during upload."))
          xhr.ontimeout = () => reject(new Error("Upload timed out."))
          xhr.timeout = 120_000
          xhr.send(formData)
        }
      )

      if (!payload.repoPath) {
        throw new Error(payload.error ?? "Repo upload failed.")
      }

      setRepoPath(payload.repoPath)
      setUploadedRepoLabel(payload.repoLabel ?? rootName)
      setRepoUrl("")
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsUploadingRepo(false)
      setUploadProgress(null)
    }
  }, [])

  const handleRepoFolderChange = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    if (event.target.files?.length) {
      await uploadRepoFiles(event.target.files)
    }
  }, [uploadRepoFiles])

  const handleRepoDrop = useCallback(async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setIsRepoDragging(false)
    if (event.dataTransfer.files?.length) {
      await uploadRepoFiles(event.dataTransfer.files)
    }
  }, [uploadRepoFiles])

  const handleEvent = useCallback((event: PipelineEvent) => {
    switch (event.type) {
      case "STAGE_START":
        updateStage(event.stage, { status: "running", startedAt: event.timestamp })
        setActiveStage(event.stage)
        break
      case "STAGE_PROGRESS":
        break
      case "STAGE_COMPLETE":
        if (event.stage === "discovery") {
          const scope = (
            event.output &&
            typeof event.output === "object" &&
            "scope" in event.output
          )
            ? (event.output as { scope?: QuickCheckScope }).scope ?? null
            : null

          const repoDiff = (
            event.output &&
            typeof event.output === "object" &&
            "repoDiff" in event.output
          )
            ? (event.output as { repoDiff?: RepoDiffScope }).repoDiff ?? null
            : null

          if (scope) {
            setQuickCheckScope(scope)
          }
          if (repoDiff) {
            setRepoDiffScope(repoDiff)
          }
        }

        updateStage(event.stage, {
          status: "complete",
          completedAt: new Date().toISOString(),
          output: event.output,
          usedFallback: event.fallback ?? false,
          fallbackReasons: event.fallbackReasons,
          degradedSources: event.degradedSources,
          feedbackSummary: event.feedbackSummary,
        })
        break
      case "STAGE_ERROR":
        updateStage(event.stage, {
          status: "error",
          error: event.error,
          usedFallback: event.fallback,
          fallbackReasons: event.fallbackReason ? [event.fallbackReason] : undefined,
          degradedSources: event.degradedSources,
        })
        break
      case "PIPELINE_COMPLETE":
        setFindings(Array.isArray(event.findings) ? event.findings.map(sanitizeFinding) : [])
        setSources(Array.isArray(event.sources) ? event.sources.map(sanitizeSource) : [])
        setActiveTab("findings")
        break
      case "PIPELINE_ERROR":
        setRunError(event.error)
        break
    }
  }, [updateStage])

  const showRunToast = useCallback((message: string) => {
    if (toastTimerRef.current) {
      clearTimeout(toastTimerRef.current)
    }
    setRunToast(message)
    toastTimerRef.current = setTimeout(() => setRunToast(null), 3200)
  }, [])

  const focusPipeline = useCallback(() => {
    document.getElementById("pipeline")?.scrollIntoView({ behavior: "smooth", block: "start" })
  }, [])

  const runPipeline = useCallback(async (trigger?: "quick-check" | "config-diff" | "repo-diff") => {
    const trimmedQuery = quickCheckQuery.trim()
    const trimmedRepoPath = repoPath.trim()
    const trimmedRepoUrl = repoUrl.trim()

    if (!configContent && !trimmedQuery && !trimmedRepoPath && !trimmedRepoUrl) return

    if (trigger) {
      const modeLabel =
        trigger === "quick-check"
          ? "Quick Check"
          : trigger === "config-diff"
          ? "Config Diff"
          : "Repo Diff"
      showRunToast(`${modeLabel} started. Scrolling to the pipeline…`)
      focusPipeline()
    }

    setIsRunning(true)
    setFindings([])
    setSources([])
    setStages(INITIAL_STAGES)
    setActiveTab("findings")
    setQuickCheckScope(null)
    setRepoDiffScope(null)
    setRunError(null)

    abortRef.current = new AbortController()

    try {
      const response = await fetch("/api/pipeline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          configContent,
          configFilename,
          quickCheckQuery: trimmedQuery,
          repoPath: trimmedRepoPath || undefined,
          repoUrl: trimmedRepoUrl || undefined,
        }),
        signal: abortRef.current.signal,
      })

      if (!response.ok || !response.body) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: string; retryAfterSeconds?: number }
          | null

        const message = payload?.retryAfterSeconds
          ? `${payload.error ?? "Pipeline request failed."} Retry in about ${payload.retryAfterSeconds}s.`
          : payload?.error ?? `Pipeline request failed: ${response.status}`

        throw new Error(message)
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue
          const raw = line.slice(6).trim()
          if (!raw) continue

          try {
            handleEvent(JSON.parse(raw) as PipelineEvent)
          } catch {
            // Skip malformed events
          }
        }
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        setRunError(error instanceof Error ? error.message : String(error))
      }
    } finally {
      setIsRunning(false)
    }
  }, [configContent, configFilename, focusPipeline, handleEvent, quickCheckQuery, repoPath, repoUrl, showRunToast])

  const hasRunnableInput = Boolean(configContent || quickCheckQuery.trim() || repoPath.trim() || repoUrl.trim())
  const hasEditableBaseline = Boolean(configContent.trim())
  const displayConfigContent =
    configContent ||
    repoDiffScope?.inventorySummary ||
    (quickCheckScope ? buildQuickCheckConfigContent(quickCheckScope) : "")
  const displayConfigFilename =
    configFilename ||
    (repoDiffScope ? "repo-inventory.txt" : quickCheckScope ? "quick-check.txt" : "")
  const quickCheckOnly = Boolean(quickCheckQuery.trim()) && !configContent && !repoPath.trim() && !repoUrl.trim()
  const repoDiffOnly = Boolean(repoPath.trim() || repoUrl.trim()) && !configContent && !quickCheckQuery.trim()
  const diffMode = hasEditableBaseline ? "editable" : "advisory"
  const advisoryTitle = repoPath.trim() || repoUrl.trim()
    ? `Repo recommendations${repoDiffScope?.repoLabel ? ` for ${repoDiffScope.repoLabel}` : ""}`
    : `Quick Check recommendations${quickCheckScope?.selectedSubjects.length ? ` for ${quickCheckScope.selectedSubjects.join(", ")}` : ""}`
  const advisoryDescription = repoPath.trim() || repoUrl.trim()
    ? "This run is based on scanned repo inventory and repo drift signals. DriftCheck is showing repo-level recommendations and targets to inspect, not a literal file patch."
    : "This run is based on your question and authoritative evidence. DriftCheck is showing current setup recommendations, not a literal file patch."

  const selectedStage = stages.find((stage) => stage.id === activeStage) ?? null
  const stageSources = uniqueSources(stages.flatMap((stage) => stage.degradedSources ?? []))
  const runSources = uniqueSources([...sources, ...stageSources])
  const liveSources = runSources.filter((source) => source.status === "live")
  const cachedSources = runSources.filter((source) => source.status === "cached")
  const unavailableSources = runSources.filter((source) => source.status === "unavailable")
  const degradedSources = runSources.filter((source) => source.status !== "live")
  const degradedStages = [...new Set(degradedSources.map((source) => source.stage))]
  const fallbackReasons = [...new Set(degradedSources.flatMap((source) => (
    source.fallback_reason ? [source.fallback_reason] : []
  )))]

  return (
    <main className="min-h-screen overflow-x-hidden bg-[color:var(--app-bg)] text-[color:var(--app-fg)] transition-colors duration-300 flex flex-col items-center">
      
      {/* Top Nav */}
      <nav className="w-full max-w-[1440px] px-8 py-5 flex justify-between items-center z-10 relative">
        <div className="font-serif text-2xl font-bold tracking-tight">DriftCheck</div>
        <div className="flex items-center gap-1 text-[11px] uppercase tracking-widest text-[color:var(--app-muted)]">
          <a href={DOC_LINKS[0].href} target="_blank" className="transition-colors hover:text-[color:var(--app-fg)] px-3 py-1.5 rounded-full hover:bg-[color:var(--chrome-chip)]">Docs</a>
          <a href={DOC_LINKS[1].href} target="_blank" className="transition-colors hover:text-[color:var(--app-fg)] px-3 py-1.5 rounded-full hover:bg-[color:var(--chrome-chip)]">System</a>
        </div>
      </nav>

      <div className="relative w-full max-w-[1440px] px-6 pb-24 pt-16 flex flex-col items-center text-center">
        {/* HERO SECTION */}
        <section ref={heroReveal} className="reveal-up w-full flex flex-col items-center pt-10 pb-14 border-b border-[color:var(--chrome-border)]">
          <h1 className="max-w-3xl font-serif text-4xl md:text-5xl font-regular leading-[1.1] tracking-tight text-[color:var(--chrome-fg)] text-center">
            Minimal drift checks for the tools you use.
          </h1>
          <p className="max-w-xl text-base leading-relaxed text-[color:var(--app-muted)] mt-4 text-center">
            Ask a plain-English question, compare a config, or scan a repo. DriftCheck checks live authoritative sources and tells you what changed.
          </p>
          <div className="mt-7 flex justify-center">
            <a href="#workbench" className="inline-flex items-center justify-center px-8 py-3 bg-[#1A1A1A] text-[#F9F9F7] rounded-full text-xs tracking-widest uppercase hover:bg-[#333333] transition-colors duration-200">
              Try Out Workbench
            </a>
          </div>
        </section>

        {/* APP + PIPELINE */}
        <section id="workbench" className="w-full py-10 scroll-mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">

            {/* INPUT PANEL */}
            <div className="lg:col-span-1 flex flex-col rounded-3xl border border-[color:var(--chrome-border)] bg-white/60 shadow-sm overflow-hidden">

              {/* Mode tabs */}
              <div className="flex border-b border-[color:var(--chrome-border)]">
                {(["quick-check", "config-diff", "repo-diff"] as const).map((mode) => {
                  const label = mode === "quick-check" ? "Quick Check" : mode === "config-diff" ? "Config Diff" : "Repo Diff"
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setWorkbenchMode(mode)}
                      className={`flex-1 py-3.5 text-[10px] uppercase tracking-widest transition-colors border-b-2 -mb-px ${
                        workbenchMode === mode
                          ? "border-black text-black font-semibold"
                          : "border-transparent text-neutral-400 hover:text-black"
                      }`}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>

              {/* Mode content */}
              <div className="p-5 flex-1">
                {workbenchMode === "quick-check" && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-neutral-400">Ask about a tool, config, or skill you maintain.</p>
                    <textarea
                      value={quickCheckQuery}
                      onChange={(event) => setQuickCheckQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !isRunning) {
                          event.preventDefault()
                          void runPipeline("quick-check")
                        }
                      }}
                      rows={5}
                      placeholder="e.g. Is my OpenAI setup up to date?"
                      className="w-full resize-none bg-transparent border-b-2 border-neutral-200 focus:border-neutral-800 py-2 text-base outline-none transition-colors placeholder:text-neutral-400 font-serif"
                    />
                    {quickCheckScope && (
                      <div className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-xl px-3 py-2">
                        Scoped to: {quickCheckScope.selectedSubjects.join(", ")}
                      </div>
                    )}
                  </div>
                )}

                {workbenchMode === "config-diff" && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-neutral-400">Upload or paste a config, skill file, or notes.</p>
                    <div className="bg-white border border-[color:var(--chrome-border)] rounded-2xl p-4">
                      <FileUpload onFileContent={handleFileContent} />
                    </div>
                    {hasEditableBaseline && (
                      <div className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                        Loaded: {configFilename || "config file"}
                      </div>
                    )}
                  </div>
                )}

                {workbenchMode === "repo-diff" && (
                  <div className="flex flex-col gap-3">
                    <p className="text-xs text-neutral-400">Drop a local folder or paste a public GitHub URL.</p>
                    <div
                      onDrop={(event) => void handleRepoDrop(event)}
                      onDragOver={(event) => { event.preventDefault(); setIsRepoDragging(true); }}
                      onDragLeave={() => setIsRepoDragging(false)}
                      onClick={() => !isUploadingRepo && repoInputRef.current?.click()}
                      className={`border border-dashed rounded-2xl p-5 flex flex-col items-center justify-center text-center transition-colors ${isUploadingRepo ? "border-neutral-200 bg-neutral-50 cursor-default" : isRepoDragging ? "border-neutral-800 bg-neutral-100 cursor-pointer" : "border-neutral-300 hover:border-neutral-500 hover:bg-neutral-50 cursor-pointer"}`}
                    >
                      <input ref={repoInputRef} type="file" multiple {...({ webkitdirectory: "true", directory: "" } as React.InputHTMLAttributes<HTMLInputElement>)} className="sr-only" onChange={(event) => void handleRepoFolderChange(event)} />
                      {isUploadingRepo && uploadProgress ? (
                        <div className="w-full space-y-2">
                          <div className="flex justify-between text-[11px] text-neutral-500">
                            <span>Uploading {uploadProgress.fileCount.toLocaleString()} files…</span>
                            {uploadProgress.total > 0 && (
                              <span>{Math.round((uploadProgress.sent / uploadProgress.total) * 100)}%</span>
                            )}
                          </div>
                          <div className="w-full h-1.5 bg-neutral-200 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-neutral-800 rounded-full transition-all duration-200"
                              style={{ width: uploadProgress.total > 0 ? `${Math.round((uploadProgress.sent / uploadProgress.total) * 100)}%` : "0%" }}
                            />
                          </div>
                          {uploadProgress.total > 0 && (
                            <p className="text-[10px] text-neutral-400">
                              {(uploadProgress.sent / 1_048_576).toFixed(1)} / {(uploadProgress.total / 1_048_576).toFixed(1)} MB
                            </p>
                          )}
                          {uploadProgress.skipped > 0 && (
                            <p className="text-[10px] text-neutral-400">
                              {uploadProgress.skipped.toLocaleString()} files skipped (node_modules, binaries, lock files)
                            </p>
                          )}
                        </div>
                      ) : isUploadingRepo ? (
                        <span className="text-sm text-neutral-500 animate-pulse">Preparing upload…</span>
                      ) : (
                        <>
                          <span className="text-xs text-neutral-500 mb-1">Local Folder</span>
                          <span className="text-[10px] text-neutral-400 mb-2">(Drop or Click)</span>
                          <span className="text-sm font-medium">{uploadedRepoLabel || "No folder loaded"}</span>
                        </>
                      )}
                    </div>
                    <div className="border border-[color:var(--chrome-border)] bg-white rounded-2xl p-4">
                      <p className="text-[10px] uppercase tracking-widest text-neutral-500 mb-2">GitHub URL</p>
                      <input
                        value={repoUrl}
                        onChange={(e) => {
                          setRepoUrl(e.target.value)
                          if (e.target.value.trim()) { setRepoPath(""); setUploadedRepoLabel(""); }
                        }}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !isRunning) { e.preventDefault(); void runPipeline("repo-diff"); }
                        }}
                        placeholder="https://github.com/..."
                        className="w-full bg-neutral-100 p-2.5 rounded-lg text-sm border border-neutral-200 focus:border-neutral-800 focus:outline-none transition-colors"
                      />
                    </div>
                    {repoDiffScope && (
                      <div className="text-xs text-purple-700 bg-purple-50 border border-purple-200 rounded-xl px-3 py-2">
                        Repo ready: {repoDiffScope.repoLabel ?? "repo"}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Run button — always visible */}
              <div className="px-5 pb-5">
                <button
                  type="button"
                  onClick={() => {
                    if (workbenchMode === "quick-check") void runPipeline("quick-check")
                    else if (workbenchMode === "config-diff") void runPipeline("config-diff")
                    else void runPipeline("repo-diff")
                  }}
                  disabled={
                    isRunning ||
                    (workbenchMode === "quick-check" && !quickCheckQuery.trim()) ||
                    (workbenchMode === "config-diff" && !configContent.trim()) ||
                    (workbenchMode === "repo-diff" && !repoPath.trim() && !repoUrl.trim())
                  }
                  className="w-full py-3.5 rounded-full bg-black text-white text-[11px] tracking-widest uppercase hover:bg-neutral-800 disabled:opacity-40 transition-colors cursor-pointer disabled:cursor-not-allowed"
                >
                  {isRunning ? "Running..." : workbenchMode === "quick-check" ? "Run Query" : workbenchMode === "config-diff" ? "Run Config Check" : "Run Repo Scan"}
                </button>
              </div>
            </div>

            {/* PIPELINE + RESULTS PANEL */}
            <div id="pipeline" className="lg:col-span-2 flex flex-col rounded-3xl border border-[color:var(--chrome-border)] bg-white shadow-sm overflow-hidden">

              {/* Pipeline header */}
              <div className="px-6 py-4 border-b border-[color:var(--chrome-border)] flex items-center justify-between">
                <div>
                  <h3 className="font-serif text-lg leading-none">Pipeline</h3>
                  <p className="text-xs text-neutral-400 mt-1">
                    {isRunning ? "Processing your request..." : hasRunnableInput ? "Ready to run." : "Waiting for input."}
                  </p>
                </div>
                <div className={`text-[10px] px-3 py-1 rounded-full tracking-widest uppercase ${isRunning ? "bg-amber-100 text-amber-800 border border-amber-200" : "bg-neutral-100 text-neutral-500 border border-neutral-200"}`}>
                  {isRunning ? "Running" : "Idle"}
                </div>
              </div>

              {/* Pipeline stages */}
              <div className="px-5 py-4 border-b border-[color:var(--chrome-border)]">
                <Pipeline stages={stages} activeStage={activeStage} onStageClick={setActiveStage} />
              </div>

              {/* Results tabs */}
              <div className="flex px-2 border-b border-neutral-100 overflow-x-auto nice-scrollbar">
                {(
                  [
                    { id: "summary", label: "Summary", count: null },
                    { id: "findings", label: "Findings", count: findings.length },
                    { id: "diff", label: "Diff", count: null },
                    { id: "sources", label: "Sources", count: sources.length },
                    { id: "detail", label: "Detail", count: null },
                  ] as const
                ).map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`whitespace-nowrap px-4 py-3 text-[10px] uppercase tracking-widest transition-colors border-b-2 ${
                      activeTab === tab.id
                        ? "border-black text-black font-medium"
                        : "border-transparent text-neutral-400 hover:text-black"
                    }`}
                  >
                    {tab.label}
                    {tab.count !== null && tab.count > 0 && (
                      <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] ${activeTab === tab.id ? "bg-black text-white" : "bg-neutral-200 text-neutral-600"}`}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {/* Results content */}
              <div className="flex-1 min-h-[300px] max-h-[460px] overflow-y-auto overflow-x-hidden p-5 nice-scrollbar">
                {activeTab === "summary" && (
                  <RunSummary findings={findings} sources={runSources} />
                )}

                {activeTab === "findings" && (
                  <div className="space-y-4">
                    {findings.length === 0 && !isRunning && (
                      <div className="py-16 text-center text-sm text-neutral-400 bg-neutral-50 rounded-2xl border border-neutral-200 border-dashed">
                        No findings yet. Run a check to see results here.
                      </div>
                    )}
                    {findings.length === 0 && isRunning && (
                      <div className="py-16 text-center text-sm text-neutral-400 bg-neutral-50 rounded-2xl border border-neutral-200 border-dashed animate-pulse">
                        Analyzing drift signals...
                      </div>
                    )}
                    {findings.map((finding, index) => (
                      <FindingCard key={`${finding.entity}-${index}`} finding={finding} />
                    ))}
                  </div>
                )}

                {activeTab === "diff" && (
                  <div className="rounded-2xl overflow-hidden border border-neutral-100">
                    <DiffView
                      configContent={displayConfigContent}
                      configFilename={displayConfigFilename}
                      findings={findings}
                      mode={diffMode}
                      advisoryTitle={advisoryTitle}
                      advisoryDescription={advisoryDescription}
                    />
                  </div>
                )}

                {activeTab === "sources" && (
                  <SourcesPanel sources={sources} findings={findings} resolutionOutput={stages.find((s) => s.id === "resolution")?.output} />
                )}

                {activeTab === "detail" && selectedStage && (
                  <StageDetail stage={selectedStage} />
                )}
                {activeTab === "detail" && !selectedStage && (
                  <div className="py-12 px-6 flex flex-col items-center gap-3 text-center bg-neutral-50 rounded-2xl border border-neutral-200 border-dashed">
                    <p className="text-sm font-medium text-neutral-600">Click a stage above to inspect it</p>
                    <p className="text-xs text-neutral-400 max-w-xs leading-relaxed">
                      This tab is a pipeline debugger. Select any stage node — Discovery, Resolution, Diff, etc. — to see its timing, data quality, degradation reasons, and raw JSON output.
                    </p>
                  </div>
                )}
              </div>

              {/* Run health */}
              {(degradedSources.length > 0 || runError) && (
                <div className="px-5 pb-4 space-y-2">
                  {degradedSources.length > 0 && (
                    <div className="text-xs p-3 bg-yellow-50 text-yellow-900 border border-yellow-200 rounded-xl">
                      {liveSources.length} live &middot; {cachedSources.length} cached &middot; {unavailableSources.length} unavailable
                      {degradedStages.length > 0 && ` — stages: ${degradedStages.join(", ")}`}
                    </div>
                  )}
                  {runError && (
                    <div className="text-xs p-3 bg-red-50 text-red-900 border border-red-200 rounded-xl">
                      {runError}
                    </div>
                  )}
                </div>
              )}
            </div>

          </div>
        </section>

        {/* FEATURE MODES */}
        <section ref={toolsReveal} className="reveal-up w-full flex flex-col items-center py-24 border-t border-[color:var(--chrome-border)]">
          <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--app-muted)] mb-10">Three modes, one pipeline.</p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">
            {MODE_COMPARISON.map((row) => (
              <div key={row.mode} className="flex flex-col p-7 border border-[color:var(--chrome-border)] bg-white/40 rounded-3xl">
                <h3 className="font-serif text-xl font-medium mb-3">{row.mode}</h3>
                <p className="text-sm text-[color:var(--app-muted)] leading-relaxed mb-4 flex-1">{row.bestFor}</p>
                <div className="pt-4 border-t border-[color:var(--chrome-border)] text-xs text-[color:var(--app-muted)]">
                  Speed: <span className="text-black">{row.speed}</span> &nbsp;&middot;&nbsp; Input: <span className="text-black">{row.input}</span>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* USE CASES SECTION */}
        <section className="w-full flex flex-col items-center py-32 border-t border-[color:var(--chrome-border)]">
          <p className="text-xs uppercase tracking-[0.22em] text-[color:var(--app-muted)] mb-4">How developers use it</p>
          <h2 className="font-serif text-4xl font-medium mb-16 text-center">Three flows, one tool.</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full">

            <div className="flex flex-col p-8 border border-[color:var(--chrome-border)] bg-white/40 rounded-3xl">
              <div className="text-[10px] uppercase tracking-widest text-[color:var(--app-muted)] mb-3">Quick Check</div>
              <h3 className="font-serif text-xl font-medium mb-5 leading-snug">&ldquo;Is my OpenAI setup up to date?&rdquo;</h3>
              <ol className="space-y-3 text-sm text-[color:var(--app-muted)] list-none flex-1">
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">01</span>
                  <span>Type a plain-English question about a tool, skill, or config you maintain.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">02</span>
                  <span>Quick Check scopes the run to relevant subjects — no file upload needed.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">03</span>
                  <span>TinyFish checks live authoritative sources. OpenAI extracts typed changes.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">04</span>
                  <span>Get scoped findings with source provenance and confidence tiers.</span>
                </li>
              </ol>
              <div className="mt-8 pt-5 border-t border-[color:var(--chrome-border)]">
                <a href="#quick-check" className="text-[11px] uppercase tracking-widest text-[color:var(--app-muted)] hover:text-[color:var(--app-fg)] transition-colors">Try Quick Check →</a>
              </div>
            </div>

            <div className="flex flex-col p-8 border border-[color:var(--chrome-border)] bg-white/40 rounded-3xl">
              <div className="text-[10px] uppercase tracking-widest text-[color:var(--app-muted)] mb-3">Config Diff</div>
              <h3 className="font-serif text-xl font-medium mb-5 leading-snug">&ldquo;Here&apos;s my skill file. What drifted?&rdquo;</h3>
              <ol className="space-y-3 text-sm text-[color:var(--app-muted)] list-none flex-1">
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">01</span>
                  <span>Paste or upload a config, skill file, or notes — anything that reflects your local setup.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">02</span>
                  <span>DriftCheck resolves the tool references in your file against live authoritative sources.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">03</span>
                  <span>OpenAI compares what you have against what changed. Get a split-pane diff.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">04</span>
                  <span>Download the suggested update. DriftCheck shows the diff — you decide what to apply.</span>
                </li>
              </ol>
              <div className="mt-8 pt-5 border-t border-[color:var(--chrome-border)]">
                <a href="#config-diff" className="text-[11px] uppercase tracking-widest text-[color:var(--app-muted)] hover:text-[color:var(--app-fg)] transition-colors">Try Config Diff →</a>
              </div>
            </div>

            <div className="flex flex-col p-8 border border-[color:var(--chrome-border)] bg-white/40 rounded-3xl">
              <div className="text-[10px] uppercase tracking-widest text-[color:var(--app-muted)] mb-3">Repo Diff</div>
              <h3 className="font-serif text-xl font-medium mb-5 leading-snug">&ldquo;Check this repo for drift.&rdquo;</h3>
              <ol className="space-y-3 text-sm text-[color:var(--app-muted)] list-none flex-1">
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">01</span>
                  <span>Drop a local folder or paste a public GitHub repo URL.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">02</span>
                  <span>DriftCheck inventories configs, manifests, skill references, and submodules.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">03</span>
                  <span>Supported tools are checked against live sources via TinyFish. Git signals are supplemental context.</span>
                </li>
                <li className="flex gap-3">
                  <span className="font-mono text-[10px] text-neutral-400 pt-0.5 shrink-0">04</span>
                  <span>Get repo-level findings and targets to inspect. Review before acting — nothing is applied silently.</span>
                </li>
              </ol>
              <div className="mt-8 pt-5 border-t border-[color:var(--chrome-border)]">
                <a href="#repo-diff" className="text-[11px] uppercase tracking-widest text-[color:var(--app-muted)] hover:text-[color:var(--app-fg)] transition-colors">Try Repo Diff →</a>
              </div>
            </div>

          </div>
        </section>

      </div>

      {/* Toast Notification */}
      {runToast && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 z-50 rounded-full border border-black/10 bg-black/90 px-6 py-3 text-sm text-white shadow-2xl animate-[fade-in-up_0.3s_ease-out]">
          {runToast}
        </div>
      )}
    </main>
  )
}

