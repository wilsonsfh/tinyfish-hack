import type { FeedbackLoopMeta, FeedbackLoopStatus, StageFeedbackSummary } from "./types"

export const FEEDBACK_LOOP_STATUS_LABELS: Record<FeedbackLoopStatus, string> = {
  not_applicable: "not applicable",
  accepted_on_first_pass: "accepted on first pass",
  corrected_after_schema_feedback: "corrected after schema feedback",
  corrected_after_quality_feedback: "corrected after quality feedback",
  corrected_after_schema_and_quality_feedback: "corrected after schema and quality feedback",
  mixed: "mixed feedback states",
}

function loopDetail(loop: FeedbackLoopMeta): string {
  const attempts = [`schema attempts: ${loop.schema_attempts}`]

  if (loop.quality_attempts > 0) {
    attempts.push(`quality retries: ${loop.quality_attempts}`)
  }

  return `${loop.label}: ${FEEDBACK_LOOP_STATUS_LABELS[loop.status]} (${attempts.join(", ")})`
}

export function summarizeFeedbackLoops(
  loops: FeedbackLoopMeta[],
  notApplicableDetail = "No model feedback loop was needed for this stage."
): StageFeedbackSummary {
  if (loops.length === 0) {
    return {
      status: "not_applicable",
      details: [notApplicableDetail],
    }
  }

  const statuses = [...new Set(loops.map((loop) => loop.status))]

  return {
    status: statuses.length === 1 ? statuses[0] : "mixed",
    details: loops.map(loopDetail),
    loops,
  }
}

export function feedbackLoopStatusLabel(status: FeedbackLoopStatus): string {
  return FEEDBACK_LOOP_STATUS_LABELS[status]
}
