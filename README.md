# Sentinel

Provider-agnostic AI penetration testing framework. Automates vulnerability assessment by combining reconnaissance tools with AI-powered code analysis across any LLM provider.

## Relationship to Shannon

Sentinel rebuilds [Shannon](https://github.com/KeygraphHQ/shannon)'s five-phase pentest pipeline with provider independence as the core design goal. Shannon uses the Claude Agent SDK (Anthropic-only); Sentinel uses LangChain.js to support any provider natively. Both share the same pipeline structure and Temporal orchestration.

| | Shannon | Sentinel |
|---|---------|----------|
| AI framework | Claude Agent SDK | LangChain.js |
| Provider support | Anthropic only (others via external router) | Native: Anthropic, OpenAI, Google, Ollama, OpenAI-compatible |
| Per-agent model routing | Environment variables + external router | Native YAML config |
| Cost tracking | SDK-reported total per agent | Per-provider pricing table with per-model rates |
| Error classification | ErrorCode enum + string pattern fallback | Per-provider pattern matching on messages + HTTP codes |
| Default parallelism | 5 concurrent pipelines | 2 concurrent pipelines (rate-limit safe) |
| Content sanitization | Message extraction + error truncation | 26-pattern sanitizer, Unicode homoglyph normalization, 3 strictness levels |
| Cross-phase validation | Queue file symmetric existence checks | Schema-driven finding validator with injection pattern detection |
| Prompt injection defense | Content isolation tags | Content sanitizer + isolation tags + finding validator (3 layers) |

**Shared foundations** (not differentiators): Temporal durable orchestration, five-phase pipeline (pre-recon → recon → 5× vuln → 5× exploit → report), pipelined vuln/exploit execution (no barrier wait), named workspaces with resume, MCP tooling (deliverables, TOTP), configurable `max_concurrent_pipelines`.

## Features

- **Multi-provider** — Anthropic, OpenAI, Google Gemini, Ollama (local), or any OpenAI-compatible API
- **Five-phase pipeline** — Pre-recon, recon, vulnerability analysis (5 parallel agents), exploitation (5 parallel, conditional), and reporting
- **Durable orchestration** — Temporal workflows with crash recovery, queryable progress, and automatic retry
- **Resume support** — Named workspaces that survive restarts; resume any interrupted audit
- **Per-agent model routing** — Use different models for different pipeline phases via YAML config
- **Security hardened** — Content sanitizer, prompt isolation markers, and cross-phase finding validator defend against indirect prompt injection
- **MCP tooling** — Save deliverables and generate TOTP codes via Model Context Protocol server

## Quick Start

### Prerequisites

- Docker Desktop
- At least one AI provider API key (or local Ollama)

### Setup

```bash
# Clone and configure
git clone https://github.com/a13e-s/sentinel.git
cd sentinel
cp .env.example .env
# Edit .env — set at least one: ANTHROPIC_API_KEY, OPENAI_API_KEY, GOOGLE_API_KEY, or OLLAMA_BASE_URL
```

### Prepare a target repository

```bash
# Clone the target app's source code into repos/
git clone https://github.com/org/target-app.git ./repos/target-app

# Or symlink an existing local repo
ln -s /path/to/existing/repo ./repos/target-app
```

### Run

```bash
# Start an audit
./sentinel start URL=https://target.example.com REPO=target-app

# With a specific model
./sentinel start URL=https://target.example.com REPO=target-app MODEL=openai/gpt-4o

# With a YAML config (auth, scoping rules, model overrides)
./sentinel start URL=https://target.example.com REPO=target-app CONFIG=./configs/my-config.yaml

# Named workspace (auto-resumes on re-run)
./sentinel start URL=https://target.example.com REPO=target-app WORKSPACE=q1-audit
```

### Monitor

```bash
# Temporal Web UI
open http://localhost:8233

# Tail workflow logs
./sentinel logs ID=<workflow-id>

# List all workspaces
./sentinel workspaces
```

### Stop

```bash
./sentinel stop                # Preserves workflow data
./sentinel stop CLEAN=true     # Full cleanup including volumes
```

## CLI Reference

```
./sentinel start URL=<url> REPO=<name>   Start a pentest workflow
./sentinel workspaces                    List all workspaces
./sentinel logs ID=<workflow-id>         Tail logs for a specific workflow
./sentinel smoke                         Run infrastructure smoke test
./sentinel stop                          Stop all containers
./sentinel help                          Show help
```

| Option | Description |
|--------|-------------|
| `REPO=<name>` | Folder name under `./repos/` |
| `CONFIG=<path>` | YAML configuration file |
| `OUTPUT=<path>` | Output directory (default: `./audit-logs/`) |
| `WORKSPACE=<name>` | Named workspace — auto-resumes if exists |
| `MODEL=<provider/model>` | Override model (e.g. `openai/gpt-4o`, `ollama/llama3.3`) |
| `PIPELINE_TESTING=true` | Minimal prompts for fast iteration |
| `REBUILD=true` | Force Docker image rebuild |

## Configuration

Create a YAML config file for authentication, scoping rules, and model overrides. See [`configs/example.yaml`](configs/example.yaml) for a complete reference.

### Model Configuration

```yaml
models:
  default:
    provider: anthropic        # anthropic, openai, google, ollama, openai-compatible
    model: claude-sonnet-4-20250514

  agents:
    recon:
      provider: google
      model: gemini-2.0-flash
    report:
      provider: openai
      model: gpt-4o
```

### Authentication

```yaml
authentication:
  login_type: form             # form, sso, api, basic
  login_url: "https://app.example.com/login"
  credentials:
    username: "testuser"
    password: "testpassword"
    totp_secret: "JBSWY3DPEHPK3PXP"   # Optional 2FA

  login_flow:
    - "Type $username into the email field"
    - "Type $password into the password field"
    - "Click 'Sign In'"

  success_condition:
    type: url
    value: "/dashboard"
```

### Scoping Rules

```yaml
rules:
  avoid:
    - description: "Skip logout"
      type: path
      url_path: "/logout"

  focus:
    - description: "Prioritize admin panel"
      type: subdomain
      url_path: "admin"
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Temporal Server                         │
│                   (Durable Orchestration)                     │
└──────────────────────┬──────────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                    Sentinel Worker                            │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Phase 1  │  │ Phase 2  │  │ Phase 3  │  │  Phase 4   │  │
│  │Pre-Recon │─▶│  Recon   │─▶│ 5× Vuln  │─▶│ 5× Exploit │  │
│  │          │  │          │  │(parallel)│  │ (parallel) │  │
│  └──────────┘  └──────────┘  └──────────┘  └─────┬──────┘  │
│                                                    │         │
│                                              ┌─────▼──────┐  │
│                                              │  Phase 5   │  │
│                                              │  Report    │  │
│                                              └────────────┘  │
│                                                              │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │              LangChain Model Factory                     │ │
│  │  Anthropic │ OpenAI │ Google │ Ollama │ Compatible       │ │
│  └─────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐   │
│  │  MCP Server  │  │ Audit System │  │ Security Layer   │   │
│  │  (tools)     │  │ (logging)    │  │ (sanitizer,      │   │
│  │              │  │              │  │  validator,       │   │
│  │              │  │              │  │  isolation)       │   │
│  └──────────────┘  └──────────────┘  └──────────────────┘   │
└──────────────────────────────────────────────────────────────┘
```

### Pipeline Phases

| Phase | Agents | Description |
|-------|--------|-------------|
| 1. Pre-Recon | `pre-recon` | External scans (nmap, subfinder, whatweb) + source code analysis |
| 2. Recon | `recon` | Attack surface mapping from initial findings |
| 3. Vulnerability | `injection-vuln`, `xss-vuln`, `auth-vuln`, `authz-vuln`, `ssrf-vuln` | 5 parallel agents analyzing different vulnerability classes |
| 4. Exploitation | `injection-exploit`, `xss-exploit`, `auth-exploit`, `authz-exploit`, `ssrf-exploit` | 5 parallel agents exploiting confirmed vulnerabilities (conditional) |
| 5. Reporting | `report` | Executive-level security report generation |

### Directory Structure

```
sentinel/
├── src/
│   ├── ai/                  # Model factory, agent loop, cost tracking
│   ├── audit/               # Crash-safe append-only logging
│   ├── security/            # Content sanitizer, finding validator
│   ├── services/            # Business logic (Temporal-agnostic)
│   ├── temporal/            # Workflows, activities, worker, client
│   ├── tools/               # MCP client integration
│   ├── types/               # Shared types (Result<T,E>, ErrorCode, AgentName)
│   └── utils/               # File I/O, formatting, concurrency
├── mcp-server/              # MCP helper server (save_deliverable, generate_totp)
├── prompts/                 # Per-phase prompt templates (31 files)
├── configs/                 # YAML config examples + JSON Schema
├── tests/
│   ├── unit/                # 205 unit tests
│   └── integration/         # 37 integration tests
├── sentinel                 # CLI entrypoint (bash)
├── Dockerfile               # Multi-stage build (node:20-slim)
└── docker-compose.yml       # Temporal + worker services
```

## Development

### Build

```bash
npm install
npm run build
```

### Test

```bash
npm test                     # Run all 242 tests
npm run test:watch           # Watch mode
npm run test:coverage        # With coverage
npm run typecheck            # Type check only
```

### Smoke Test

```bash
# Validate Docker infrastructure (no API keys needed)
./sentinel smoke

# Validate provider connectivity (needs API keys in .env)
npm run smoke-test
```

### Adding a New Agent

1. Add the agent name to `ALL_AGENTS` in `src/types/agents.ts`
2. Define the agent in `src/session-manager.ts` (add to `AGENTS` record)
3. Create a prompt template in `prompts/` (e.g., `vuln-newtype.txt`)
4. Add a thin activity wrapper in `src/temporal/activities.ts`
5. Register in the appropriate phase in `src/temporal/workflows.ts`

### Modifying Prompts

- Variable substitution: `{{TARGET_URL}}`, `{{CONFIG_CONTEXT}}`, `{{LOGIN_INSTRUCTIONS}}`
- Shared partials in `prompts/shared/` via `src/services/prompt-manager.ts`
- External content is automatically wrapped in `<external-content>` isolation tags

## Security

### Defensive Use Only

Sentinel is a defensive security tool. Use only on systems you own or have explicit written permission to test.

### Prompt Injection Defenses

Sentinel includes three layers of defense against indirect prompt injection (where malicious content on target websites attempts to hijack the AI agents):

1. **Content Sanitizer** (`src/security/content-sanitizer.ts`) — Strips prompt injection patterns from external content before it enters agent prompts. Normalizes Unicode homoglyphs, detects 22 injection patterns across 3 severity tiers (high/medium/low), with configurable strictness levels.

2. **Content Isolation** — Prompt templates use `<external-content>` tags to separate trusted instructions from untrusted data. Each template includes explicit warnings that agents must never follow instructions found in external content.

3. **Finding Validator** (`src/security/finding-validator.ts`) — Validates structural integrity of findings between pipeline phases. Detects embedded system prompt patterns, suspiciously long payloads, and content that doesn't match expected schemas for each phase.

## Troubleshooting

| Issue | Solution |
|-------|----------|
| "Repository not found" | `REPO` must be a folder name inside `./repos/`. Clone or symlink first. |
| "No AI provider configured" | Set at least one API key in `.env` or use `MODEL=ollama/llama3.3` |
| Temporal not ready | Wait for health check or check `docker compose logs temporal` |
| Worker not processing | Check `docker compose ps` and worker logs |
| Local apps unreachable | Use `host.docker.internal` instead of `localhost` in the target URL |
| Container permissions | On Linux, may need `sudo` for Docker commands |
| Reset state | `./sentinel stop CLEAN=true` |

## License

[AGPL-3.0](LICENSE)
