"use client"

import { useCallback, useRef, useState, type ChangeEvent, type DragEvent } from "react"
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

const INITIAL_STAGES: StageState[] = [
  { id: "discovery", label: "Discovery", status: "idle", usedFallback: false },
  { id: "skills-diff", label: "Skills Diff", status: "idle", usedFallback: false },
  { id: "resolution", label: "Authoritative Check", status: "idle", usedFallback: false },
  { id: "diff", label: "Config Diff", status: "idle", usedFallback: false },
  { id: "confidence", label: "Trust Scoring", status: "idle", usedFallback: false },
  { id: "output", label: "Output", status: "idle", usedFallback: false },
]

type TabId = "findings" | "diff" | "sources" | "detail"

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

export default function Home() {
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
  const [isRunning, setIsRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<TabId>("findings")
  const abortRef = useRef<AbortController | null>(null)
  const repoInputRef = useRef<HTMLInputElement | null>(null)

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

    setIsUploadingRepo(true)
    setRunError(null)

    try {
      const formData = new FormData()
      const firstFile = fileArray[0] as File & { webkitRelativePath?: string }
      const firstRelative = firstFile.webkitRelativePath || firstFile.name || "repo-upload"
      const rootName = firstRelative.split("/")[0] || "repo-upload"
      formData.append("rootName", rootName)

      for (const file of fileArray) {
        formData.append("files", file)
      }

      const response = await fetch("/api/repo-upload", {
        method: "POST",
        body: formData,
      })

      const payload = (await response.json().catch(() => null)) as
        | { repoPath?: string; repoLabel?: string; error?: string }
        | null

      if (!response.ok || !payload?.repoPath) {
        throw new Error(payload?.error ?? "Repo upload failed.")
      }

      setRepoPath(payload.repoPath)
      setUploadedRepoLabel(payload.repoLabel ?? rootName)
      setRepoUrl("")
    } catch (error) {
      setRunError(error instanceof Error ? error.message : String(error))
    } finally {
      setIsUploadingRepo(false)
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
        setFindings(event.findings)
        setSources(event.sources)
        setActiveTab("findings")
        break
      case "PIPELINE_ERROR":
        setRunError(event.error)
        break
    }
  }, [updateStage])

  const runPipeline = useCallback(async () => {
    const trimmedQuery = quickCheckQuery.trim()
    const trimmedRepoPath = repoPath.trim()
    const trimmedRepoUrl = repoUrl.trim()

    if (!configContent && !trimmedQuery && !trimmedRepoPath && !trimmedRepoUrl) return

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
  }, [configContent, configFilename, handleEvent, quickCheckQuery, repoPath, repoUrl])

  const hasRunnableInput = Boolean(configContent || quickCheckQuery.trim() || repoPath.trim() || repoUrl.trim())
  const displayConfigContent =
    configContent ||
    repoDiffScope?.inventorySummary ||
    (quickCheckScope ? buildQuickCheckConfigContent(quickCheckScope) : "")
  const displayConfigFilename =
    configFilename ||
    (repoDiffScope ? "repo-inventory.txt" : quickCheckScope ? "quick-check.txt" : "")
  const quickCheckOnly = Boolean(quickCheckQuery.trim()) && !configContent && !repoPath.trim() && !repoUrl.trim()
  const repoDiffOnly = Boolean(repoPath.trim() || repoUrl.trim()) && !configContent && !quickCheckQuery.trim()

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
    <main className="min-h-screen overflow-hidden bg-[#0a0b0d] text-stone-100">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.12),transparent_28%),radial-gradient(circle_at_bottom_right,rgba(168,85,247,0.12),transparent_32%)]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.08]" style={{ backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "32px 32px" }} />

      <div className="relative mx-auto max-w-[1500px] px-6 pb-14 pt-8">
        <header className="grid gap-10 border-b border-white/10 pb-10 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="space-y-6">
            <div className="inline-flex items-center rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.28em] text-cyan-200">
              DriftCheck
            </div>
            <div className="max-w-4xl space-y-4">
              <h1 className="max-w-4xl font-display text-5xl font-semibold leading-[0.96] tracking-[-0.04em] text-white md:text-6xl xl:text-7xl">
                Keep your agentic coding stack current.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-stone-300 md:text-lg">
                DriftCheck is a personal AI assistant for checking whether your skills, references, dependencies, and repo conventions have drifted from current reality.
              </p>
            </div>
          </div>

          <div className={`${panelClass("p-6")}`}>
            <div className="text-[11px] uppercase tracking-[0.28em] text-stone-500">How people use it</div>
            <div className="mt-5 space-y-4">
              {MODE_SUMMARY.map((mode) => (
                <div key={mode.title} className="border-b border-white/8 pb-4 last:border-b-0 last:pb-0">
                  <div className="flex items-baseline justify-between gap-4">
                    <h2 className="text-lg font-semibold text-white">{mode.title}</h2>
                    <span className="text-sm font-medium text-cyan-300">{mode.stat}</span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-400">{mode.note}</p>
                </div>
              ))}
            </div>
          </div>
        </header>

        <section className="mt-10 grid gap-8 xl:grid-cols-[minmax(0,1.15fr)_420px]">
          <div className="space-y-6">
            <section className={`${panelClass("p-6 md:p-7")}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-stone-500">01</div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-semibold text-white">Quick Check</h2>
                    <InfoTip text="Ask a plain-English question like 'is my OpenAI setup up to date?'. DriftCheck narrows the subject, checks live sources, then compares the result against local state if you provided any." />
                  </div>
                </div>
                {quickCheckScope && (
                  <span className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs font-medium text-emerald-200">
                    scoped
                  </span>
                )}
              </div>
              <textarea
                value={quickCheckQuery}
                onChange={(event) => setQuickCheckQuery(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !isRunning) {
                    event.preventDefault()
                    void runPipeline()
                  }
                }}
                rows={4}
                placeholder="Is my OpenAI setup up to date?"
                className="mt-5 w-full resize-y rounded-[22px] border border-white/10 bg-black/25 px-5 py-4 text-sm text-stone-100 placeholder:text-stone-500 focus:border-cyan-400/40 focus:outline-none"
              />
              <div className="mt-4 flex items-end justify-between gap-4">
                <p className="text-xs text-stone-500">Cmd/Ctrl+Enter runs the scoped check.</p>
                <button
                  type="button"
                  onClick={() => void runPipeline()}
                  disabled={!quickCheckQuery.trim() || isRunning}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    !quickCheckQuery.trim() || isRunning
                      ? "cursor-not-allowed border border-white/10 bg-white/5 text-stone-500"
                      : "cursor-pointer border border-cyan-400/30 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/18"
                  }`}
                >
                  Run Quick Check
                </button>
              </div>
            </section>

            <section className={`${panelClass("p-6 md:p-7")}`}>
              <div className="space-y-1">
                <div className="text-[11px] uppercase tracking-[0.24em] text-stone-500">02</div>
                <div className="flex items-center gap-2">
                  <h2 className="text-2xl font-semibold text-white">Config Diff</h2>
                  <InfoTip text="Upload or paste config, notes, or a skill file. DriftCheck uses it as the local baseline for comparison against resolved live changes." />
                </div>
              </div>
              <div className="mt-5">
                <FileUpload onFileContent={handleFileContent} />
              </div>
            </section>

            <section className={`${panelClass("p-6 md:p-7")}`}>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <div className="text-[11px] uppercase tracking-[0.24em] text-stone-500">03</div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-2xl font-semibold text-white">Repo Diff</h2>
                    <InfoTip text="Use a local folder or a public GitHub repo URL. DriftCheck inventories repo evidence, checks submodule drift, and verifies supported subjects against live authoritative sources." />
                  </div>
                </div>
                {repoDiffScope && (
                  <span className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs font-medium text-violet-200">
                    repo ready
                  </span>
                )}
              </div>

              <div className="mt-5 grid gap-4 lg:grid-cols-2">
                <div
                  onDrop={(event) => void handleRepoDrop(event)}
                  onDragOver={(event) => {
                    event.preventDefault()
                    setIsRepoDragging(true)
                  }}
                  onDragLeave={() => setIsRepoDragging(false)}
                  onClick={() => repoInputRef.current?.click()}
                  className={`min-h-[210px] rounded-[22px] border border-dashed p-5 transition ${
                    isRepoDragging
                      ? "border-cyan-400/50 bg-cyan-400/10"
                      : "border-white/12 bg-black/20 hover:border-cyan-400/30 hover:bg-black/30"
                  }`}
                >
                  <input
                    ref={repoInputRef}
                    type="file"
                    multiple
                    {...({ webkitdirectory: "true", directory: "" } as Record<string, string>)}
                    className="sr-only"
                    onChange={(event) => void handleRepoFolderChange(event)}
                  />
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium uppercase tracking-[0.22em] text-cyan-200">Local Folder</h3>
                    <InfoTip text="Click or drop a folder. The files are uploaded into a temporary server workspace for this run only." />
                  </div>
                  <p className="mt-4 text-lg font-medium text-white">Drop a local repo here, or click to choose one.</p>
                  <p className="mt-2 text-sm leading-6 text-stone-400">
                    Best for controlled testing and demos. The uploaded folder becomes the repo baseline for the current run.
                  </p>
                  <div className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-stone-300">
                    {isUploadingRepo
                      ? "Uploading folder..."
                      : uploadedRepoLabel
                        ? `Loaded: ${uploadedRepoLabel}`
                        : "No folder loaded yet."}
                  </div>
                </div>

                <div className="min-h-[210px] rounded-[22px] border border-white/12 bg-black/20 p-5">
                  <div className="flex items-center gap-2">
                    <h3 className="text-sm font-medium uppercase tracking-[0.22em] text-violet-200">GitHub URL</h3>
                    <InfoTip text="Paste a public github.com repo URL. DriftCheck performs a shallow clone for the run, then discards it." />
                  </div>
                  <p className="mt-4 text-lg font-medium text-white">Use a public repo URL for live repo intake.</p>
                  <p className="mt-2 text-sm leading-6 text-stone-400">
                    This is the convenience path when you want to test a repo from the web without touching the local filesystem.
                  </p>
                  <input
                    value={repoUrl}
                    onChange={(event) => {
                      const nextValue = event.target.value
                      setRepoUrl(nextValue)
                      if (nextValue.trim()) {
                        setRepoPath("")
                        setUploadedRepoLabel("")
                      }
                    }}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !isRunning) {
                        event.preventDefault()
                        void runPipeline()
                      }
                    }}
                    placeholder="https://github.com/owner/repo"
                    className="mt-6 w-full rounded-2xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-stone-100 placeholder:text-stone-500 focus:border-violet-400/40 focus:outline-none"
                  />
                  <p className="mt-3 text-xs text-stone-500">Public GitHub repos only. Private auth is out of scope for this build.</p>
                </div>
              </div>

              <div className="mt-4 flex items-end justify-between gap-4">
                <p className="text-xs text-stone-500">Repo Diff uses repo evidence as local state, then verifies supported subjects against live sources.</p>
                <button
                  type="button"
                  onClick={() => void runPipeline()}
                  disabled={(!repoPath.trim() && !repoUrl.trim()) || isRunning || isUploadingRepo}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    (!repoPath.trim() && !repoUrl.trim()) || isRunning || isUploadingRepo
                      ? "cursor-not-allowed border border-white/10 bg-white/5 text-stone-500"
                      : "cursor-pointer border border-violet-400/30 bg-violet-400/10 text-violet-100 hover:bg-violet-400/18"
                  }`}
                >
                  Run Repo Diff
                </button>
              </div>
            </section>
          </div>

          <aside className="space-y-6 xl:sticky xl:top-6 xl:self-start">
            <section className={`${panelClass("p-6")}`}>
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-stone-500">Execution</div>
                  <h2 className="mt-2 text-2xl font-semibold text-white">Pipeline</h2>
                </div>
                <button
                  onClick={() => void runPipeline()}
                  disabled={!hasRunnableInput || isRunning || isUploadingRepo}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                    !hasRunnableInput || isRunning || isUploadingRepo
                      ? "cursor-not-allowed border border-white/10 bg-white/5 text-stone-500"
                      : "cursor-pointer border border-white/15 bg-white/8 text-white hover:border-cyan-400/30 hover:bg-cyan-400/12"
                  }`}
                >
                  {isRunning ? "Running..." : "Run Pipeline"}
                </button>
              </div>
              <div className="mt-5">
                <Pipeline stages={stages} activeStage={activeStage} onStageClick={setActiveStage} />
              </div>
            </section>

            <section className={`${panelClass("p-6")}`}>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Scope and matching</h2>
                <InfoTip text="This shows what DriftCheck actually narrowed the run to. Quick Check explains the subject mapping. Repo Diff explains which supported subjects were detected from repo evidence." />
              </div>
              {!quickCheckScope && !repoDiffScope && (
                <p className="mt-4 text-sm leading-6 text-stone-400">
                  Nothing is scoped yet. Run Quick Check or Repo Diff to inspect the exact subject mapping before the final findings.
                </p>
              )}
              {quickCheckScope && (
                <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-emerald-200">Quick Check matching</summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {quickCheckScope.selectedSubjects.map((subject) => (
                        <span key={subject} className="rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1 text-xs text-emerald-100">
                          {subject}
                        </span>
                      ))}
                    </div>
                    <div className="space-y-2 text-sm leading-6 text-stone-400">
                      {quickCheckScope.explanation.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                </details>
              )}
              {repoDiffScope && (
                <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                  <summary className="cursor-pointer list-none text-sm font-medium text-violet-200">Repo Diff matching</summary>
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {repoDiffScope.selectedSubjects.map((subject) => (
                        <span key={subject} className="rounded-full border border-violet-400/30 bg-violet-400/10 px-3 py-1 text-xs text-violet-100">
                          {subject}
                        </span>
                      ))}
                    </div>
                    <div className="space-y-2 text-sm leading-6 text-stone-400">
                      {repoDiffScope.explanation.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  </div>
                </details>
              )}
            </section>

            {(degradedSources.length > 0 || runError) && (
              <section className={`${panelClass("p-6")}`}>
                <div className="text-[11px] uppercase tracking-[0.24em] text-stone-500">Run health</div>
                {degradedSources.length > 0 && (
                  <div className="mt-4 rounded-2xl border border-amber-400/20 bg-amber-400/8 px-4 py-4">
                    <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
                      <span className="text-stone-200">{liveSources.length} live</span>
                      {cachedSources.length > 0 && (
                        <span className="font-medium text-amber-200">{cachedSources.length} cached</span>
                      )}
                      {unavailableSources.length > 0 && (
                        <span className="font-medium text-rose-200">{unavailableSources.length} unavailable</span>
                      )}
                    </div>
                    {degradedStages.length > 0 && (
                      <p className="mt-3 text-sm text-amber-100/90">Affected stages: {degradedStages.join(", ")}</p>
                    )}
                    {fallbackReasons.length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {fallbackReasons.map((reason) => (
                          <span key={reason} className="rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1 text-xs text-amber-100">
                            {fallbackReasonLabel(reason)}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {runError && (
                  <div className="mt-4 rounded-2xl border border-rose-400/20 bg-rose-400/8 px-4 py-4 text-sm text-rose-100">
                    {runError}
                  </div>
                )}
              </section>
            )}
          </aside>
        </section>

        <section className="mt-10">
          {quickCheckOnly && (
            <div className="mb-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/8 px-4 py-3 text-sm text-emerald-100">
              Running in Quick Check mode only. No uploaded config was provided, so findings are based on the question plus live or fallback authoritative evidence.
            </div>
          )}
          {repoDiffOnly && (
            <div className="mb-4 rounded-2xl border border-violet-400/20 bg-violet-400/8 px-4 py-3 text-sm text-violet-100">
              Running in Repo Diff mode only. No uploaded config was provided, so findings are based on scanned repo inventory, repo drift signals, and authoritative source evidence.
            </div>
          )}

          <div className={`${panelClass("p-4 md:p-6")}`}>
            <div className="flex flex-wrap gap-2 border-b border-white/10 pb-4">
              {(
                [
                  { id: "findings", label: "Findings", count: findings.length },
                  { id: "diff", label: "Diff View", count: null },
                  { id: "sources", label: "Sources", count: sources.length },
                  { id: "detail", label: "Stage Detail", count: null },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`rounded-full px-4 py-2 text-sm transition ${
                    activeTab === tab.id
                      ? "bg-white text-black"
                      : "bg-white/[0.04] text-stone-400 hover:bg-white/[0.08] hover:text-stone-200"
                  }`}
                >
                  {tab.label}
                  {tab.count !== null && tab.count > 0 && (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${activeTab === tab.id ? "bg-black/10 text-black" : "bg-white/10 text-stone-300"}`}>
                      {tab.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="min-h-[420px] pt-6">
              {activeTab === "findings" && (
                <div className="space-y-3">
                  {findings.length === 0 && !isRunning && (
                    <p className="text-sm text-stone-500">
                      No findings yet. Start with a question, config, or repo and run the pipeline.
                    </p>
                  )}
                  {findings.length === 0 && isRunning && (
                    <p className="animate-pulse text-sm text-stone-500">
                      Pipeline is running, findings will appear here...
                    </p>
                  )}
                  {findings.map((finding, index) => (
                    <FindingCard key={`${finding.entity}-${index}`} finding={finding} />
                  ))}
                </div>
              )}

              {activeTab === "diff" && (
                <DiffView
                  configContent={displayConfigContent}
                  configFilename={displayConfigFilename}
                  findings={findings}
                />
              )}

              {activeTab === "sources" && (
                <SourcesPanel
                  sources={sources}
                  findings={findings}
                  resolutionOutput={stages.find((stage) => stage.id === "resolution")?.output}
                />
              )}

              {activeTab === "detail" && selectedStage && <StageDetail stage={selectedStage} />}
              {activeTab === "detail" && !selectedStage && (
                <p className="text-sm text-stone-500">
                  Click a pipeline stage to inspect what it produced, whether it degraded, and how the run progressed.
                </p>
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
