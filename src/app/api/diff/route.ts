import { NextResponse } from "next/server"
import { summarizeFeedbackLoops } from "@/lib/feedback-loops"
import { diffConfig } from "@/lib/openai"
import { acquireRateLimit } from "@/lib/rate-limit"
import type { AuthoritativeChange, Finding } from "@/lib/types"

interface DiffRequestBody {
  configContent: string
  configFilename: string
  changes: AuthoritativeChange[]
  quickCheckContext?: string
}

export const POST = async (request: Request): Promise<NextResponse> => {
  const rateLimit = acquireRateLimit(request, "diff", {
    windowMs: 2 * 60 * 1000,
    maxRequests: 12,
    maxConcurrent: 2,
  })

  if (rateLimit.response) {
    return rateLimit.response as NextResponse
  }

  let body: DiffRequestBody

  try {
    body = await request.json()
  } catch {
    rateLimit.lease?.release()
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const { configContent, configFilename, changes, quickCheckContext } = body

  try {
    const diffResult = await diffConfig(configContent, changes, quickCheckContext)

    const findings: Finding[] = diffResult.findings.map((finding) => ({
      ...finding,
      affected_file: configFilename,
    }))

    return NextResponse.json({
      findings,
      feedbackSummary: summarizeFeedbackLoops([diffResult.feedbackLoop]),
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error"
    return NextResponse.json({ error: `Diff stage failed: ${message}` }, { status: 500 })
  } finally {
    rateLimit.lease?.release()
  }
}
