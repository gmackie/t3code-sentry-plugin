# T3 Code Sentry monitoring plugin

An MCP server that reads agent-monitoring traces back from Sentry, for agents and for a T3 Code thread panel.

- **Thread panel "Sentry trace"**: lists the Sentry traces whose spans are tagged with the current thread (`t3_thread_id`), with operation and error counts. Open a trace to see each operation's status, duration and run id.
- **Tools for agents**: `sentry_thread_traces` (traces for a thread id) and `sentry_trace` (one trace by id). Both render the same view inline.

Only span ids, operations, statuses, timestamps and the `t3_thread_id`/`t3_run_id` tags are requested from Sentry. Raw payloads and other tags never reach T3.

The plugin does not send telemetry. Spans reach Sentry from whatever produces them (T3's Sentry agent monitoring, upstream PR #5376, or a provider SDK). See [docs/manifest-v2.md](docs/manifest-v2.md) for why the v1 hooks were removed.

## Install

Run `bun install --frozen-lockfile`, then install this directory through T3's plugin installer and fill in its variables on the connected server. Web, desktop and mobile can open the panel; mobile uses the server installation.

| Variable | Value |
|---|---|
| `SENTRY_URL` | `https://sentry.io` (default), a regional host such as `https://us.sentry.io`, or your self-hosted Sentry |
| `SENTRY_ORG` | Organization slug |
| `SENTRY_AUTH_TOKEN` | Auth token with `org:read` and `event:read` (stored as a secret) |

Without a token and organization the server still starts, and every tool says which setting is missing.

## Develop

```sh
bun install
bun test
bun run typecheck
SENTRY_ORG=acme SENTRY_AUTH_TOKEN=... bun run inspect   # MCP Inspector
```
