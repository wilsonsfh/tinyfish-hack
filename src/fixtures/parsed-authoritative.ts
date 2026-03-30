import type { AuthoritativeChange } from "@/lib/types"

export const PARSED_AUTHORITATIVE_FIXTURES = {
  openai: [
    {
      entity: "gpt-4-turbo",
      change_type: "deprecation",
      description:
        "GPT-4 Turbo moved to legacy status. Migrate to gpt-4o or gpt-4o-mini for current recommendations.",
      date: "2026-03-15",
      source_url: "https://platform.openai.com/docs/changelog",
      source_label: "OpenAI Platform Changelog",
    },
    {
      entity: "response_format",
      change_type: "best_practice",
      description:
        "Structured Outputs are generally available. Prefer response_format with json_schema over legacy json_object-only patterns.",
      date: "2026-03-10",
      source_url: "https://platform.openai.com/docs/changelog",
      source_label: "OpenAI Platform Changelog",
    },
    {
      entity: "tool_choice",
      change_type: "deprecation",
      description:
        "The function_call parameter is deprecated in favor of tool_choice for forward compatibility.",
      date: "2026-03-05",
      source_url: "https://platform.openai.com/docs/changelog",
      source_label: "OpenAI Platform Changelog",
    },
    {
      entity: "gpt-4o",
      change_type: "additive",
      description:
        "GPT-4o pricing was reduced, making it the more cost-effective current model recommendation over older GPT-4 Turbo usage.",
      date: "2026-02-28",
      source_url: "https://platform.openai.com/docs/changelog",
      source_label: "OpenAI Platform Changelog",
    },
  ],
  "openai-cookbook": [
    {
      entity: "response_format",
      change_type: "best_practice",
      description:
        "Cookbook examples now recommend json_schema-based structured outputs instead of legacy json_object-only examples.",
      date: "2026-03-18",
      source_url: "https://github.com/openai/openai-cookbook",
      source_label: "OpenAI Cookbook",
    },
    {
      entity: "tool_choice",
      change_type: "deprecation",
      description:
        "Cookbook migration examples were updated from function_call to tool_choice, with function_call kept only as a deprecated alias.",
      date: "2026-03-11",
      source_url: "https://github.com/openai/openai-cookbook",
      source_label: "OpenAI Cookbook",
    },
    {
      entity: "gpt-4o",
      change_type: "best_practice",
      description:
        "Cookbook examples now prefer gpt-4o and gpt-4o-mini over GPT-4 Turbo in default example flows.",
      date: "2026-03-02",
      source_url: "https://github.com/openai/openai-cookbook",
      source_label: "OpenAI Cookbook",
    },
  ],
  langgraph: [
    {
      entity: "langgraph",
      change_type: "breaking",
      description:
        "LangGraph v0.3.0 tightens state typing and reducer expectations. Older dict-based state graphs may need explicit schema updates.",
      date: "2026-03-21",
      version: "v0.3.0",
      source_url: "https://github.com/langchain-ai/langgraph/releases",
      source_label: "LangGraph Releases",
    },
    {
      entity: "checkpoint configuration",
      change_type: "best_practice",
      description:
        "Checkpointing guidance now expects explicit configuration instead of relying on older implicit defaults.",
      date: "2026-03-14",
      source_url: "https://github.com/langchain-ai/langgraph/releases",
      source_label: "LangGraph Releases",
    },
  ],
  instructor: [
    {
      entity: "instructor",
      change_type: "breaking",
      description:
        "Instructor 2.0 requires Pydantic v2 or newer and drops compatibility with Pydantic v1.",
      date: "2026-03-19",
      version: "2.0",
      source_url: "https://github.com/jxnl/instructor/releases",
      source_label: "Instructor Releases",
    },
    {
      entity: "structured outputs",
      change_type: "best_practice",
      description:
        "Maintained Instructor examples now favor schema-first structured outputs over older free-form JSON validation flows.",
      date: "2026-03-08",
      source_url: "https://github.com/jxnl/instructor/releases",
      source_label: "Instructor Releases",
    },
  ],
  crewai: [
    {
      entity: "tool_choice",
      change_type: "deprecation",
      description:
        "CrewAI 1.0 examples and compatibility notes were updated to use tool_choice instead of function_call for modern LLM tool APIs.",
      date: "2026-03-17",
      version: "1.0",
      source_url: "https://github.com/crewAIInc/crewAI/releases",
      source_label: "CrewAI Releases",
    },
    {
      entity: "sequential task execution",
      change_type: "best_practice",
      description:
        "CrewAI setup examples now recommend explicit process configuration for sequential crews instead of older implicit defaults.",
      date: "2026-03-09",
      source_url: "https://github.com/crewAIInc/crewAI/releases",
      source_label: "CrewAI Releases",
    },
  ],
} satisfies Record<string, AuthoritativeChange[]>

