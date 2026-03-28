export const SAMPLE_CONFIG = `# AGENTS.md — My AI Coding Assistant Config

## Model Configuration
- Primary model: gpt-4-turbo
- Fallback model: gpt-3.5-turbo
- Temperature: 0.7 for creative tasks, 0 for code generation

## API Settings
- Use \`response_format: { type: "json_object" }\` for structured responses
- Use \`function_call: "auto"\` for tool selection
- Max tokens: 4096

## Agent Framework
- Framework: CrewAI v0.x with sequential task execution
- State management: LangGraph v0.1 with dict-based state
- Validation: Instructor v1.x with Pydantic v1 models

## Dependencies
\`\`\`
openai==1.12.0
langchain==0.1.0
langgraph==0.1.5
crewai==0.28.0
instructor==1.2.0
pydantic==1.10.12
\`\`\`

## System Prompt Pattern
Use XML tags for structured prompts. Include \`<thinking>\` blocks for chain-of-thought.
Always request JSON output with explicit schema in the system message.

## Workflow
1. Accept user request
2. Break into subtasks using CrewAI agents
3. Each agent uses function_call for tool use
4. Aggregate results with LangGraph state graph
5. Validate output with Instructor + Pydantic
6. Return structured response
`
