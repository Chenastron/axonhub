---
description: "How to inspect axonhub request metadata, executions, usage and stored bodies via psql and the local-fs storage layout"
---

# Database Query Methods

When you need to inspect request metadata, executions, or other data stored in the database, use `psql` directly against the PostgreSQL database.

## Connection

```bash
PSQL="PGPASSWORD=axonhub psql -U axonhub -h /var/run/postgresql -d axonhub_recover"
```

- **Dialect**: PostgreSQL
- **Socket**: Unix socket at `/var/run/postgresql/.s.PGSQL.5432`
- **User**: `axonhub`
- **Password**: `axonhub`
- **Database**: `axonhub_recover`

## Key Tables for Request Debugging

| Table | Description |
|-------|-------------|
| `requests` | Main request records, status/metrics. Body fields are `{}` placeholders when external storage is enabled |
| `request_executions` | Per-channel execution attempts (one request may have multiple retries) |
| `usage_logs` | Token usage and cost breakdown per request |
| `channels` | Channel configuration |
| `provider_quota_status` | Quota status cache for each channel |

## Request/Response Body Storage (Local FS)

Request and response bodies are **not stored in the database** — they are saved to the external file storage `local-fs` (type `fs`), configured in the frontend data-storages page, rooted at `/vol1/1000/axonhub-data`:

- **Layout**: `/vol1/1000/axonhub-data/<project_id>/requests/<request_id>/{request_body.json, response_body.json, response_chunks.json}` and `.../requests/<request_id>/executions/<execution_id>/...` for per-execution bodies.
- **Activation**: requests with a non-primary `requests.data_storage_id` (e.g. the `local-fs` storage) store bodies in files; in the DB their `request_body` is just `{}` and `response_body`/`response_chunks` are NULL. Older requests (small ids, primary storage) still have full bodies in the DB — treat the cutoff as "check the current data", not a fixed number.
- **Logic**: `shouldUseExternalStorage` in `internal/server/biz/request.go` — any non-primary (non-database) data storage stores bodies externally.
- To read a request's actual body/chunks, read the JSON files directly from the layout above; use the DB only for metadata.

## Common Queries

All examples below use the `$PSQL` alias defined above and the `-x` flag (expanded/vertical output, useful for wide tables).

**1. Quick request overview:**
```bash
$PSQL -x -c "
  SELECT id, model_id, format, status, stream, client_ip,
         metrics_latency_ms, channel_id, created_at, updated_at
  FROM requests WHERE id = <ID>"
```

**2. List all executions for a request (retries/failures):**
```bash
$PSQL -x -c "
  SELECT id, request_id, status, channel_id, error_message,
         response_status_code, created_at, updated_at
  FROM request_executions WHERE request_id = <ID> ORDER BY created_at"
```

**3. Check whether bodies are in DB or external storage:**
```bash
$PSQL -x -c "
  SELECT id, data_storage_id,
         jsonb_typeof(request_body) as body_type,
         length(request_body::text) as body_len
  FROM requests WHERE id = <ID>"
```
If `data_storage_id` points to a non-primary storage, read the actual bodies from `/vol1/1000/axonhub-data/<project_id>/requests/<ID>/` instead of the DB.

**4. Check usage logs (token counts and cost):**
```bash
$PSQL -x -c "
  SELECT ul.id, ul.prompt_tokens, ul.completion_tokens, ul.total_tokens,
         ul.total_cost, ul.source, r.model_id
  FROM usage_logs ul
  JOIN requests r ON r.id = ul.request_id
  WHERE ul.request_id = <ID>"
```

## Notes

- `response_body` and `response_chunks` are JSONB columns — for old requests stored in DB, use `left()` or `right()` SQL functions to preview without fetching the full content. For new requests (external storage) these columns are NULL/`{}` placeholders; read the files under `/vol1/1000/axonhub-data` instead.
- Execution records are created for each retry attempt; the same request_id can have multiple executions.
- When a request is canceled by the client mid-flight, the status is `canceled` and subsequent operations may fail with `context canceled` errors.
