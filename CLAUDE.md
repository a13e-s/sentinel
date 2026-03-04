# CLAUDE.md

Provider-agnostic AI penetration testing agent for defensive security analysis. Uses LangChain.js for multi-model support (Ollama, Gemini, OpenAI, Anthropic, any OpenAI-compatible API).

## Commands

**Prerequisites:** Docker, at least one model provider configured in `.env`

```bash
# Setup
cp .env.example .env && edit .env  # Configure provider credentials

# Prepare repo (REPO is a folder name inside ./repos/, not an absolute path)
git clone https://github.com/org/repo.git ./repos/my-repo
# or symlink: ln -s /path/to/existing/repo ./repos/my-repo

# Run with default model (from SENTINEL_MODEL env var)
./sentinel start URL=<url> REPO=my-repo
./sentinel start URL=<url> REPO=my-repo MODEL=google:gemini-2.0-flash
./sentinel start URL=<url> REPO=my-repo CONFIG=./configs/my-config.yaml

# Workspaces & Resume
./sentinel start URL=<url> REPO=my-repo WORKSPACE=my-audit    # New named workspace
./sentinel start URL=<url> REPO=my-repo WORKSPACE=my-audit    # Resume (same command)
./sentinel workspaces                                          # List all workspaces

# Monitor
./sentinel logs                      # Real-time worker logs
# Temporal Web UI: http://localhost:8233

# Stop
./sentinel stop                      # Preserves workflow data
./sentinel stop CLEAN=true           # Full cleanup including volumes

# Build
npm run build

# Smoke test (validate provider credentials)
./sentinel smoke-test
```

**Options:** `CONFIG=<file>` (YAML config), `MODEL=<provider:model>` (override default), `OUTPUT=<path>` (default: `./audit-logs/`), `WORKSPACE=<name>` (named workspace; auto-resumes if exists), `PIPELINE_TESTING=true` (minimal prompts, 10s retries), `REBUILD=true` (force Docker rebuild)

## Architecture

### Core Modules
- `src/session-manager.ts` — Agent definitions (`AGENTS` record) with per-agent model config. Agent types in `src/types/agents.ts`
- `src/ai/agent-loop.ts` — Provider-agnostic agent execution loop (while-loop over LangChain `BaseChatModel.invoke()`)
- `src/ai/model-factory.ts` — Creates LangChain ChatModel from provider+model config. Supports OpenAI, Google, Ollama, Anthropic, OpenAI-compatible
- `src/ai/cost-tracker.ts` — Per-provider cost calculation from usage metadata
- `src/ai/error-classifier.ts` — Per-provider error classification (rate limits, auth, billing, context length, safety)
- `src/config-parser.ts` — YAML config parsing with JSON Schema validation (extended with `models` section)
- `src/services/` — Business logic layer (Temporal-agnostic). Activities delegate here. Key: `agent-execution.ts`, `error-handling.ts`, `container.ts`
- `src/types/` — Consolidated types: `Result<T,E>`, `ErrorCode`, `AgentName`, `ProviderName`, `ModelConfig`, `ActivityLogger`, etc.
- `src/utils/` — Shared utilities (file I/O, formatting, concurrency)

### Provider Support
| Provider | Package | Models | API Key |
|---|---|---|---|
| `openai` | `@langchain/openai` | gpt-4o, gpt-4o-mini, etc. | `OPENAI_API_KEY` |
| `google` | `@langchain/google-genai` | gemini-2.0-flash, gemini-pro, etc. | `GOOGLE_API_KEY` |
| `ollama` | `@langchain/ollama` | llama3.3, mistral, etc. | (none for local). For cloud: set `OLLAMA_BASE_URL` + optional auth `headers` in config |
| `anthropic` | `@langchain/anthropic` | claude-sonnet, claude-haiku, etc. | `ANTHROPIC_API_KEY` |
| `openai-compatible` | `@langchain/openai` | Any model behind OpenAI-compatible API | `OPENAI_COMPATIBLE_API_KEY` + `OPENAI_COMPATIBLE_BASE_URL` |

### Temporal Orchestration
Durable workflow orchestration with crash recovery, queryable progress, intelligent retry, and parallel execution (5 concurrent agents in vuln/exploit phases).

- `src/temporal/workflows.ts` — Main workflow (`pentestPipelineWorkflow`)
- `src/temporal/activities.ts` — Thin wrappers — heartbeat loop, error classification, container lifecycle. Business logic delegated to `src/services/`
- `src/temporal/activity-logger.ts` — `TemporalActivityLogger` implementation of `ActivityLogger` interface
- `src/temporal/summary-mapper.ts` — Maps `PipelineSummary` to `WorkflowSummary`
- `src/temporal/worker.ts` — Worker entry point
- `src/temporal/client.ts` — CLI client for starting workflows
- `src/temporal/shared.ts` — Types, interfaces, query definitions

### Five-Phase Pipeline

1. **Pre-Recon** (`pre-recon`) — External scans (nmap, subfinder, whatweb) + source code analysis
2. **Recon** (`recon`) — Attack surface mapping from initial findings
3. **Vulnerability Analysis** (5 parallel agents) — injection, xss, auth, authz, ssrf
4. **Exploitation** (5 parallel agents, conditional) — Exploits confirmed vulnerabilities
5. **Reporting** (`report`) — Executive-level security report

### Supporting Systems
- **Configuration** — YAML configs in `configs/` with JSON Schema validation (`config-schema.json`). Supports auth settings, MFA/TOTP, per-app testing parameters, and per-agent model overrides
- **Prompts** — Per-phase templates in `prompts/` with variable substitution (`{{TARGET_URL}}`, `{{CONFIG_CONTEXT}}`). Shared partials in `prompts/shared/` via `src/services/prompt-manager.ts`
- **Agent Loop** — Custom while-loop over LangChain `BaseChatModel.invoke()`. Handles tool calling, cost tracking, turn limits, and heartbeating. No framework dependency beyond `@langchain/core`
- **MCP Tools** — `save_deliverable` and `generate_totp` via standard `@modelcontextprotocol/sdk`. Loaded into agent loop via `@langchain/mcp-adapters` `MultiServerMCPClient`. Playwright MCP for browser automation
- **Audit System** — Crash-safe append-only logging in `audit-logs/{hostname}_{sessionId}/`. Tracks session metrics, per-agent logs, prompts, deliverables, model/provider metadata, and token usage
- **Deliverables** — Saved to `deliverables/` in the target repo via the `save_deliverable` MCP tool
- **Workspaces & Resume** — Named workspaces via `WORKSPACE=<name>` or auto-named from URL+timestamp. Resume loads `session.json` to detect completed agents, validates deliverable existence, restores git checkpoints

## Development Notes

### Adding a New Agent
1. Define agent in `src/session-manager.ts` (add to `AGENTS` record). `ALL_AGENTS`/`AgentName` types live in `src/types/agents.ts`
2. Create prompt template in `prompts/` (e.g., `vuln-newtype.txt`)
3. Two-layer pattern: add a thin activity wrapper in `src/temporal/activities.ts` (heartbeat + error classification). `AgentExecutionService` in `src/services/agent-execution.ts` handles the agent lifecycle automatically via the `AGENTS` registry
4. Register activity in `src/temporal/workflows.ts` within the appropriate phase

### Adding a New Provider
1. Add provider name to `ProviderName` type in `src/types/providers.ts`
2. Add case to `createModel()` in `src/ai/model-factory.ts`
3. Add error patterns to `classifyError()` in `src/ai/error-classifier.ts`
4. Add pricing data to `calculateCost()` in `src/ai/cost-tracker.ts`
5. Add credential check to `validateProvider()` in `src/services/preflight.ts`

### Modifying Prompts
- Variable substitution: `{{TARGET_URL}}`, `{{CONFIG_CONTEXT}}`, `{{LOGIN_INSTRUCTIONS}}`
- Shared partials in `prompts/shared/` included via `src/services/prompt-manager.ts`
- Test with `PIPELINE_TESTING=true` for fast iteration
- Prompts must be model-agnostic — no references to specific providers or model names

### Model Resolution Order
1. Agent-level override (`AGENTS['recon'].model` in session-manager)
2. Config-level override (`config.models.agents.recon` in YAML)
3. Config default (`config.models.default` in YAML)
4. Environment variable (`SENTINEL_MODEL`)
5. Hardcoded fallback (`ollama:llama3.3`)

### Key Design Patterns
- **Configuration-Driven** — YAML configs with JSON Schema validation, per-agent model selection
- **Progressive Analysis** — Each phase builds on previous results
- **Provider-Agnostic** — LangChain `BaseChatModel` interface, no provider-specific code outside `src/ai/` and `src/providers/`
- **Modular Error Handling** — `ErrorCode` enum, `Result<T,E>` for explicit error propagation, per-provider error classification, automatic retry (3 attempts per agent)
- **Services Boundary** — Activities are thin Temporal wrappers; `src/services/` owns business logic, accepts `ActivityLogger`, returns `Result<T,E>`. No Temporal imports in services
- **DI Container** — Per-workflow in `src/services/container.ts`. `AuditSession` excluded (parallel safety)

### Security
Defensive security tool only. Use only on systems you own or have explicit permission to test.

## Code Style Guidelines

### Clarity Over Brevity
- Optimize for readability, not line count — three clear lines beat one dense expression
- Use descriptive names that convey intent
- Prefer explicit logic over clever one-liners

### Structure
- Keep functions focused on a single responsibility
- Use early returns and guard clauses instead of deep nesting
- Never use nested ternary operators — use if/else or switch
- Extract complex conditions into well-named boolean variables

### TypeScript Conventions
- Use `function` keyword for top-level functions (not arrow functions)
- Explicit return type annotations on exported/top-level functions
- Prefer `readonly` for data that shouldn't be mutated
- `exactOptionalPropertyTypes` is enabled — use spread for optional props, not direct `undefined` assignment

### Avoid
- Combining multiple concerns into a single function to "save lines"
- Dense callback chains when sequential logic is clearer
- Sacrificing readability for DRY — some repetition is fine if clearer
- Abstractions for one-time operations
- Backwards-compatibility shims, deprecated wrappers, or re-exports for removed code — delete the old code, don't preserve it

### Comments
Comments must be **timeless** — no references to this conversation, refactoring history, or the AI.

**Patterns used in this codebase:**
- `/** JSDoc */` — file headers (after license) and exported functions/interfaces
- `// N. Description` — numbered sequential steps inside function bodies. Use when a
  function has 3+ distinct phases where at least one isn't immediately obvious from the
  code. Each step marks the start of a logical phase
- `// === Section ===` — high-level dividers between groups of functions in long files,
  or to label major branching/classification blocks
- `// NOTE:` / `// WARNING:` / `// IMPORTANT:` — gotchas and constraints

**Never:** obvious comments, conversation references ("as discussed"), history ("moved from X")

## Key Files

**Entry Points:** `src/temporal/workflows.ts`, `src/temporal/activities.ts`, `src/temporal/worker.ts`, `src/temporal/client.ts`

**Core Logic:** `src/session-manager.ts`, `src/ai/agent-loop.ts`, `src/ai/model-factory.ts`, `src/config-parser.ts`, `src/services/`, `src/audit/`

**Config:** `sentinel` (CLI), `docker-compose.yml`, `configs/`, `prompts/`

## Troubleshooting

- **"Repository not found"** — `REPO` must be a folder name inside `./repos/`, not an absolute path. Clone or symlink your repo there first: `ln -s /path/to/repo ./repos/my-repo`
- **"Temporal not ready"** — Wait for health check or `docker compose logs temporal`
- **Worker not processing** — Check `docker compose ps`
- **Reset state** — `./sentinel stop CLEAN=true`
- **Local apps unreachable** — Use `host.docker.internal` instead of `localhost`
- **Missing tools** — Use `PIPELINE_TESTING=true` to skip nmap/subfinder/whatweb (graceful degradation)
- **Provider not found** — Install the LangChain provider package: `npm install @langchain/<provider>`
- **Ollama model not pulled** — For local Ollama: run `ollama pull <model>` before starting
- **Ollama cloud endpoints** — Set `OLLAMA_BASE_URL` in `.env` to your cloud Ollama endpoint (e.g., `https://my-ollama.cloud.example.com`). If the endpoint requires authentication, configure custom `headers` in the YAML config's `models.providers.ollama` section. Works with any Ollama-compatible cloud hosting
- **Tool calling failures** — Some models have weak tool calling. Try a stronger model or add `max_turns_per_agent` limit in config
