# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

> **Detailed rules are split into focused files under `.agent/rules/`**. See [Rules Index](#rules-index) below.

## Global Rules

1. Do NOT run lint or build commands unless explicitly requested by the user.
2. Do NOT restart the development server — it's already started and managed.
3. Use `bash start.sh` to start axonhub and `bash stop.sh` to stop it. Do NOT run the binary directly (`./axonhub`).
4. All summary files should be stored in `.agent/summary` directory if available.

## Code Verification Workflow

After modifying code, verify and apply the change with the following commands from the repository root:

1. Run `make build`.
2. If the build succeeds, run `bash restart.sh`.
3. If either command fails, report the failure and relevant output to the user.

## Version Update Workflow

When switching the codebase to a different version and updating the running system, follow these steps strictly:

1. **Version check and decision**
   * Check the local code version tag and the latest tag in the remote repository, for example with `git tag -l` or `git fetch --tags`.
   * Do not inspect the contents of the unstable branch; only inspect tags.
   * If the locally running version is older than the target version, continue with the update workflow. Otherwise, do nothing and report the current status to the user.

2. **Rebase `my-branch` onto the target tag and preserve local commits**
   * The repository must not be left in a detached HEAD state. Before and after every version update, `git branch --show-current` must report `my-branch`.
   * Switch to the persistent local branch with `git switch my-branch`. If it does not exist yet, create it from the current local commit with `git switch -c my-branch` before continuing.
   * Discard any build-related local files in the workspace (e.g., `git restore frontend/pnpm-lock.yaml internal/build/VERSION`) before rebasing. This ensures there are no conflicts on lockfiles or version config files.
   * Save other uncommitted custom changes, including untracked files, with `git stash push -u`.
   * Identify the old version tag that `my-branch` is currently based on and review the local custom commits after it with `git log <old-tag>..my-branch`.
   * Do not check out the target tag directly. Rebase the existing local commits onto the target tag while staying on `my-branch`, for example: `git rebase --onto <target-tag> <old-tag> my-branch`.
   * Resolve any rebase conflicts on your custom features without dropping local custom changes. Do not replace this workflow with checkout-and-cherry-pick.
   * Restore the saved workspace changes with `git stash pop`, resolve any resulting conflicts, and confirm that the target tag is an ancestor of `my-branch` with `git merge-base --is-ancestor <target-tag> my-branch`.
   * Re-run `git branch --show-current` and stop with an error if the result is not `my-branch`.

3. **Version number update**
   * Update `internal/build/VERSION` to the target version with a `-fix` suffix, for example `v1.0.0-beta7-fix`. Note that this file should only be modified after a successful rebase and before running `make build`. This version is compiled into the binary and displayed in system logs.

4. **Code build**
   * From the repository root, run the project build command, for example `make build`, to package frontend static assets, sync static files, and compile the Go backend into the latest `axonhub` executable.
   * **Note**: Step 3 must be completed before running `make build`; otherwise the compiled binary may contain the wrong version number.

5. **Hot reload and deploy the new service**
   * To avoid gateway disconnection caused by manually executing stop and start sequentially (especially when the AI assistant itself relies on this gateway), you must use the atomic script to stop, deploy, and launch the service in one go.
   * Run the restart script: `bash restart.sh`.
   * Check the startup status and logs to ensure the new version starts correctly.

## Configuration

- Backend API: port 8090, Frontend dev server: port 5173 (proxies to backend).
- Configuration: `conf/conf.go` (YAML + env var), SQLite by default.

## Project Overview

AxonHub is an all-in-one AI development platform that serves as a unified API gateway for multiple AI providers. It provides OpenAI and Anthropic-compatible API interfaces with automatic request transformation, enabling seamless communication between clients and various AI providers through a sophisticated bidirectional data transformation pipeline.

## Technology Stack

- **Backend**: Go 1.26.0+ with Gin, Ent ORM, gqlgen, FX
- **Frontend**: React 19 + TypeScript, TanStack Router/Query, Zustand, Tailwind CSS

## Backend Structure

- `cmd/axonhub/main.go` — Application entry point
- `internal/server/` — HTTP server and route handling with Gin
- `internal/server/biz/` — Core business logic and services
- `internal/server/api/` — REST and GraphQL API handlers
- `internal/server/gql/` — GraphQL schema and resolvers
- `internal/ent/` — Ent ORM for database operations
- `internal/ent/schema/` — Database schema definitions
- `internal/contexts/` — Context handling utilities
- `internal/pkg/` — Shared utilities (xerrors, xjson, xcache, xfile, xcontext, etc.)
- `internal/scopes/` — Permission system with role-based access control
- `llm/` — LLM utilities, transformers, and pipeline processing (separate Go module)
- `llm/pipeline/` — Pipeline processing architecture
- `conf/conf.go` — Configuration loading and validation

## Go Modules

- The repository root (`/`) is the main Go module: `github.com/looplj/axonhub`.
- `llm/` is a separate Go module: `github.com/looplj/axonhub/llm`.

### `llm/` Module Notes

- `llm/` is an independent module. Always run Go commands from the `llm/` directory (e.g., `cd llm && go test ./...`).
- Running `go test ./llm/...` from repo root will fail with module boundary errors.

## Frontend Structure

- `frontend/src/routes/` — TanStack Router file-based routing
- `frontend/src/gql/` — GraphQL API communication
- `frontend/src/features/` — Feature-based component organization
- `frontend/src/components/` — Reusable shared components
- `frontend/src/hooks/` — Custom shared hooks
- `frontend/src/stores/` — Zustand state management
- `frontend/src/locales/` — i18n support (en.json, zh.json)
- `frontend/src/lib/` — Core utilities (API client, i18n, permissions, utils)
- `frontend/src/utils/` — Domain-specific utilities (date, format, error handling)
- `frontend/src/config/` — App configuration
- `frontend/src/context/` — React context providers

## Database Query Methods

When you need to inspect request details, executions, or other data stored in the database, use `psql` directly against the PostgreSQL database.

### Connection

```bash
PGPASSWORD=axonhub psql -U axonhub -h /var/run/postgresql -d axonhub_recover
```

- **Dialect**: PostgreSQL
- **Socket**: Unix socket at `/var/run/postgresql/.s.PGSQL.5432`
- **User**: `axonhub`
- **Password**: `axonhub`
- **Database**: `axonhub_recover`

### Key Tables for Request Debugging

| Table | Description |
|-------|-------------|
| `requests` | Main request records, request/response body, chunks, status |
| `request_executions` | Per-channel execution attempts (one request may have multiple retries) |
| `usage_logs` | Token usage and cost breakdown per request |
| `channels` | Channel configuration |
| `provider_quota_status` | Quota status cache for each channel |

### Common Queries

**1. Quick request overview:**
```bash
PGPASSWORD=axonhub psql -U axonhub -h /var/run/postgresql -d axonhub_recover -c ""
  SELECT id, model_id, format, status, stream, client_ip,
         metrics_latency_ms, channel_id, created_at, updated_at
  FROM requests WHERE id = <ID>
" -x
```

**2. List all executions for a request (retries/failures):**
```bash
PGPASSWORD=axonhub psql -U axonhub -h /var/run/postgresql -d axonhub_recover -c ""
  SELECT id, request_id, status, channel_id, error_message,
         response_status_code, created_at, updated_at
  FROM request_executions WHERE request_id = <ID> ORDER BY created_at
" -x
```

**3. View request headers and body type:**
```bash
PGPASSWORD=axonhub psql -U axonhub -h /var/run/postgresql -d axonhub_recover -c ""
  SELECT id, jsonb_typeof(request_body) as body_type,
         (request_body->>'model') as model,
         jsonb_array_length(request_body->'messages') as msg_count
  FROM requests WHERE id = <ID>
" -x
```

**4. Check usage logs (token counts and cost):**
```bash
PGPASSWORD=axonhub psql -U axonhub -h /var/run/postgresql -d axonhub_recover -c ""
  SELECT ul.id, ul.prompt_tokens, ul.completion_tokens, ul.total_tokens,
         ul.total_cost, ul.source, r.model_id
  FROM usage_logs ul
  JOIN requests r ON r.id = ul.request_id
  WHERE ul.request_id = <ID>
" -x
```

### Notes

- The `-x` flag enables expanded/vertical output (each column on its own line), useful for wide tables.
- `response_body` and `response_chunks` are JSONB columns — use `left()` or `right()` SQL functions to preview without fetching the full content.
- Execution records are created for each retry attempt; the same request_id can have multiple executions.
- When a request is canceled by the client mid-flight, the status is `canceled` and subsequent operations may fail with `context canceled` errors.

## Rules Index

All detailed rules are in `.agent/rules/`:

| File | Scope | Description |
|------|-------|-------------|
| [go-general.md](.agent/rules/go-general.md) | `**/*.go` | Go 通用约定、错误处理、依赖注入、开发命令约束 |
| [ent-graphql.md](.agent/rules/ent-graphql.md) | `internal/ent/schema/**/*.go`, `internal/server/gql/**/*.go`, `internal/server/gql/**/*.graphql`, `gqlgen.yml` | Ent、GraphQL、代码生成、schema 变更规则 |
| [database-indexes.md](.agent/rules/database-indexes.md) | `internal/ent/schema/**/*.go` | 数据库索引设计、命名、跨方言兼容与迁移验证规则 |
| [biz-services.md](.agent/rules/biz-services.md) | `internal/server/biz/**/*.go` | Biz service、上下文取值、事务与级联删除规则 |
| [cache-compat.md](.agent/rules/cache-compat.md) | `**/*.go` | 缓存结构兼容性与升级安全规则 |
| [frontend-general.md](.agent/rules/frontend-general.md) | `frontend/**/*.ts`, `frontend/**/*.tsx` | 前端通用开发约定、GraphQL 数据约束、页面作用域 |
| [frontend-i18n.md](.agent/rules/frontend-i18n.md) | `frontend/src/**/*.ts`, `frontend/src/**/*.tsx`, `frontend/src/locales/*.json` | i18n 与货币格式规则 |
| [frontend-ui.md](.agent/rules/frontend-ui.md) | `frontend/**/*.tsx` | 前端 UI 组件使用规则 |
| [e2e.md](.agent/rules/e2e.md) | `frontend/tests/**/*.ts` | E2E testing rules |
| [docs.md](.agent/rules/docs.md) | `docs/**/*.md` | Documentation rules |
| [workflows/add-channel.md](.agent/rules/workflows/add-channel.md) | Manual | Workflow for adding a new channel |
