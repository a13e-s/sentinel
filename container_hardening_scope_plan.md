# Container Hardening Scope Plan

## Status

- Deferred security workstream
- Created on March 10, 2026
- Purpose: preserve the remaining container/runtime hardening scope so it can be resumed later without re-deriving context
- Implementation status: not started
- Approval status:
  - code-level remediation plan approved and merged previously
  - shell allowlist and argument constraints approved and merged previously
  - container hardening scope explicitly deferred into a separate track

## Why This Document Exists

Sentinel has already landed the lower-compatibility-risk security fixes:

- prompt and audit secret redaction
- TOTP seed removal from prompt text
- repo boundary and symlink hardening
- tool-output isolation and sanitization rollout
- shell allowlist and child-process environment minimization
- shared directory permission tightening

Those changes reduced direct code-path risk. The remaining exposure is mostly operational: the worker still runs with permissive container settings that increase blast radius if the model or tool boundary is bypassed again.

This document is the restart point for that deferred runtime work.

## Relationship To Prior Findings

This scope is primarily the deferred operational follow-up to the earlier security review findings:

- `SBP-001`: arbitrary command execution was reduced by the shell allowlist, but container runtime posture still matters if that boundary is bypassed
- `SBP-005`: host-side directory permissions were tightened, but container privileges and host reachability still need separate review

This is not a replacement for the already-merged fixes. It is the next layer of defense.

## Current Runtime Baseline

### Compose-Level Posture

Current worker configuration in `docker-compose.yml` includes:

- provider credentials in the worker environment:
  - `ANTHROPIC_API_KEY`
  - `OPENAI_API_KEY`
  - `GOOGLE_API_KEY`
  - `OLLAMA_BASE_URL`
  - `OLLAMA_API_KEY`
  - `OLLAMA_HEADERS`
- bind mounts:
  - `./configs:/app/configs`
  - `./prompts:/app/prompts`
  - `./audit-logs:/app/audit-logs`
  - `${OUTPUT_DIR:-./audit-logs}:/app/output`
  - `./repos:/repos`
- `shm_size: 2gb`
- `ipc: host`
- `security_opt: [seccomp:unconfined]`

Current Docker-specific override in `docker-compose.docker.yml` includes:

- `extra_hosts: ["host.docker.internal:host-gateway"]`

### Image-Level Posture

Current `Dockerfile` state relevant to this track:

- runtime image is `node:20-slim`
- runtime includes recon tools and utilities such as `curl`, `nmap`, `dnsutils`, `jq`, `git`, Chromium, Python, Ruby, and ProjectDiscovery tools
- container runs as non-root user `sentinel` with UID/GID `1001`
- runtime directories `/app/configs`, `/app/prompts`, `/app/audit-logs`, and `/repos` are created and owned by the `sentinel` user
- git is configured globally with:
  - `user.email=agent@localhost`
  - `user.name=Sentinel Agent`
  - `safe.directory=*`

### Documented Workflow Constraints

The existing docs and CLI imply several compatibility constraints that future container hardening must account for:

- `README.md` documents cloning a target repository into `./repos/<name>`
- `README.md` also documents symlinking an existing repo into `./repos/<name>`
- `README.md` troubleshooting currently tells users to use `host.docker.internal` for local apps instead of `localhost`
- `./sentinel start` expects `REPO=<name>` to resolve to `./repos/<name>` and passes `/repos/<name>` into the worker
- `./sentinel start` ensures `./repos/<name>/deliverables` exists on the host before execution
- `./sentinel start` can bind a custom host output directory into `/app/output`
- `./sentinel smoke` is part of the expected operational validation path

These are the reasons this work was not bundled into the already-merged code fixes.

## Problem Statement

The worker is materially safer than before, but the default container profile still leaves more privilege and host adjacency than necessary:

- `ipc: host` increases coupling with the host IPC namespace
- `seccomp:unconfined` disables syscall filtering entirely
- `host.docker.internal` is exposed by default in Docker environments
- mounts that may be read-only are still writable by default
- the runtime filesystem posture has not been reduced to the minimum necessary shape

Any future exploit of the agent or tool surface will have a larger blast radius until this layer is hardened.

## Scope

### In Scope

- `docker-compose.yml`
- `docker-compose.docker.yml`
- `Dockerfile`
- narrowly scoped CLI or startup changes required to support hardened defaults
- compatibility flags that are strictly necessary for staged rollout
- validation and documentation updates required to make the hardened profile supportable

### Out Of Scope

- revisiting the merged shell allowlist design unless new evidence requires it
- revisiting prompt redaction, TOTP, repo boundary, or tool-output fixes already merged
- broad image slimming or unrelated Docker maintenance work
- re-architecting Sentinel into multiple worker containers or sandboxes unless incremental hardening proves insufficient
- eliminating provider credentials from the worker entirely

## Security Goals

- remove unnecessary container privileges from the default worker profile
- reduce unnecessary host reachability from the worker
- reduce writable mount surface where compatibility allows
- preserve documented workflows or move them behind explicit compatibility flags
- keep rollout reversible one PR at a time

## Non-Goals

- zero-trust isolation guarantees
- perfect containment against a hostile operator with local host access
- a full redesign of local development ergonomics
- breaking local-target testing without an explicit product decision

## Threat Model For This Track

Assumed attacker capability:

- model prompt injection
- abuse of an allowed tool or command profile
- access to scanned content that tries to pivot the agent toward host-adjacent targets

Blast-radius reductions this track should provide:

- prevent reliance on host IPC
- restore syscall filtering unless a specific incompatibility proves it is required
- stop exposing host-gateway access by default
- narrow writable host mounts and runtime write locations
- make exceptions explicit, temporary, and reviewable

## Decision Record

- The allowlist and command-argument constraint model is approved and already implemented.
- Container hardening was not approved in the original remediation sequence due to compatibility risk.
- The requested handling is: document now, implement later in a separate track.
- Future PRs in this track should state that they are follow-on operational hardening, not fixes for still-open code-level findings.

## Research Questions That Must Be Answered First

1. Does any supported workflow still require `ipc: host`?
2. Which exact operations fail under Docker's default seccomp profile, if any?
3. Is `host.docker.internal` a required supported path, or just a convenience documented in troubleshooting?
4. Can `./configs` be mounted read-only immediately?
5. Can `./prompts` be mounted read-only immediately?
6. Which exact paths under `./repos` still require write access during a normal run?
7. Does any workflow write to locations other than `/app/audit-logs`, `/app/output`, repo deliverables, or temporary directories?
8. Would a read-only root filesystem break Chromium, Playwright, Git, or Temporal worker behavior without explicit writable tmpfs paths?
9. Are there supported local-only workflows that require the host gateway by default, or can that move to opt-in?

## Proposed Work Packages

### CH-0: Baseline And Evidence Capture

Goal:

- replace assumptions with a compatibility matrix grounded in current behavior

Tasks:

- record current behavior for:
  - `./sentinel smoke`
  - one representative external-target run
  - one authenticated run if credentials are available
  - one local-target run if that workflow is still considered supported
- capture actual worker writes by path category:
  - `/app/configs`
  - `/app/prompts`
  - `/app/audit-logs`
  - `/app/output`
  - `/repos`
  - temporary directories
- test ad hoc startup under stricter settings to see which failures are real:
  - no `ipc: host`
  - no `seccomp:unconfined`
  - no host-gateway mapping
- capture whether current docs need to keep local-target support as a first-class path

Deliverables:

- workflow compatibility matrix
- mount access matrix
- list of confirmed runtime dependencies, not guesses

Exit criteria:

- each open question above has an evidence-backed answer or is narrowed to a concrete blocker

### CH-1: Compose Privilege Reduction

Goal:

- harden the worker default runtime profile with explicit rollback flags

Candidate default changes:

- remove `ipc: host`
- remove `seccomp:unconfined`
- remove host-gateway mapping from the default Docker override path

Candidate compatibility controls:

- `SENTINEL_RELAXED_CONTAINER_PROFILE=true`
- `SENTINEL_ALLOW_HOST_GATEWAY=true`

Requirements:

- hardened settings must be the default behavior
- compatibility flags must be opt-in and documented
- no silent fallback to the old permissive profile

Acceptance criteria:

- worker starts successfully under the hardened default
- `./sentinel smoke` still passes
- known local-target flows still work when the explicit host-gateway compatibility flag is enabled

### CH-2: Mount Access Tightening

Goal:

- reduce writable host mount surface to the minimum required

Default direction:

- mount `./configs` read-only unless baseline evidence shows runtime writes are required
- mount `./prompts` read-only
- keep `./audit-logs` writable
- keep `/app/output` writable
- determine whether `./repos` can be:
  - fully writable only when necessary, or
  - partially narrowed through path-level design changes in a later PR

Important compatibility constraint:

- the repo path may be a symlinked local repository per current docs, and `./sentinel` currently ensures `./repos/<name>/deliverables` exists before execution

Acceptance criteria:

- runtime cannot mutate prompts or configs under default settings
- deliverables and intended repo-local outputs still work
- no documented workflow regresses without either:
  - an approved compatibility flag, or
  - an explicit product decision to stop supporting that workflow

### CH-3: Runtime Filesystem Tightening

Goal:

- evaluate whether the container filesystem can become read-only except for the minimum writable paths

Candidates to evaluate:

- `read_only: true` for the worker container
- explicit writable tmpfs mounts for browser, temp, or runtime cache needs
- `no-new-privileges` if compatible
- capability dropping if supported by the actual toolchain

Important note:

- these controls are candidates, not pre-approved implementation commitments
- this phase should not start until CH-1 and CH-2 are stable

Acceptance criteria:

- required workflows still pass with explicit writable exceptions only where needed
- runtime write locations are documented and justified

### CH-4: Documentation And Support Update

Goal:

- align user-facing docs with the hardened runtime model

Likely updates:

- `README.md` local-target guidance
- troubleshooting notes for host-gateway usage
- any compatibility flag documentation
- operator guidance on when to use relaxed modes and when not to

Acceptance criteria:

- supported runtime modes are documented accurately
- deprecated permissive behavior is no longer presented as the default path

## Validation Matrix

Each implementation PR in this track should run:

- `npm test`
- `npm run typecheck`
- `npx tsc --noEmit -p mcp-server/tsconfig.json`
- `OLLAMA_BASE_URL= npx tsx src/smoke-test.ts`
- `./sentinel smoke`

In addition, each relevant PR should validate at least one scenario from each applicable category:

- external target, hardened default profile
- authenticated external target, hardened default profile, if credentials are available
- local-target flow with explicit compatibility flag, if that mode remains supported
- repo mounted from a normal clone under `./repos/<name>`
- repo mounted from a symlinked local repo under `./repos/<name>` if that support remains documented

For CH-2 or CH-3 specifically, validation should also confirm:

- prompts remain readable but not writable in the container
- configs remain readable but not writable in the container if moved read-only
- intended audit and output writes still succeed
- repo deliverable writes still succeed if supported

## Reviewer Gates

Before implementation starts:

- Reviewer signoff is required on the baseline evidence, not just the proposed changes.
- Reviewer signoff is required on whether local-target support remains first-class or becomes explicit opt-in.
- Reviewer signoff is required before enabling any root-filesystem tightening control by default.

During PR review:

- Reviewer A should verify the security rationale for each privilege removed.
- Reviewer B should verify that no unrelated security cleanup is being mixed into the PR.
- Both reviewers should verify that hardened behavior is the default and compatibility flags are opt-in.

## Rollback Strategy

- Revert this track independently from the already-merged code-security PRs.
- Use compatibility flags first if a regression is isolated to one environment.
- Revert the specific container-hardening PR only if the regression cannot be narrowed quickly.
- Do not roll back the previously merged allowlist, redaction, boundary, or permission changes as part of this track.

## Suggested Branching And PR Sequence

Use a fresh branch series and keep each PR narrow:

1. `container-hardening-baseline`
2. `container-hardening-compose-defaults`
3. `container-hardening-mounts`
4. `container-hardening-runtime-fs`
5. `container-hardening-docs`

Do not combine all runtime changes into one PR.

## Artifacts Future Work Should Produce

When this track resumes, the first PR should add or attach:

- a workflow compatibility table
- a mount read/write table
- a short note on seccomp compatibility findings
- a short note on whether host-gateway support remains a supported default workflow

Without those artifacts, reviewers will be forced back into assumption-driven review.

## Exit Condition

This track is complete only when all of the following are true:

- the worker no longer defaults to `ipc: host`
- the worker no longer defaults to `seccomp:unconfined`
- host-gateway access is no longer default-on
- reviewer-approved mount access is reduced to the minimum required
- any compatibility flags are documented, explicit, and temporary
- the hardened profile passes the validation matrix for supported environments
