import { NextResponse } from "next/server"
import { summarizeFeedbackLoops } from "@/lib/feedback-loops"
import { acquireRateLimit } from "@/lib/rate-limit"
import { inventoryRepo } from "@/lib/repo-diff"

export async function POST(request: Request): Promise<NextResponse> {
  const rateLimit = acquireRateLimit(request, "repo-inventory", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 10,
    maxConcurrent: 2,
  })

  if (rateLimit.response) {
    return rateLimit.response as NextResponse
  }

  try {
    const body = await request.json().catch(() => ({}))
    const repoPath = typeof body?.repoPath === "string" ? body.repoPath.trim() : ""

    if (!repoPath) {
      return NextResponse.json(
        { error: "repoPath is required" },
        { status: 400 }
      )
    }

    const result = await inventoryRepo(repoPath).catch((error) => {
      const message = error instanceof Error ? error.message : String(error)
      return NextResponse.json({ error: message }, { status: 400 })
    })

    if (result instanceof NextResponse) {
      return result
    }

    return NextResponse.json({
      entities: result.entities,
      source: result.source,
      repoDiff: result.repoDiff,
      feedbackSummary: summarizeFeedbackLoops(
        [],
        "Repo inventory is deterministic; no model feedback loop was needed for this stage."
      ),
    })
  } finally {
    rateLimit.lease?.release()
  }
}
