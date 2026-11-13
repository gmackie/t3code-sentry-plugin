# Sentry manifest v2 (T3CODE-75)

`t3-plugin.json` follows the MCP-native plugin design approved on T3CODE-74, ported the same way as the Bob pilot (gmackie/t3code-bob-plugin v0.2.1). T3 loads this manifest into its server-owned MCP registry.

## Shape

- `mcpServer` reuses `McpServerConfig` and `McpServerVariable` from Settings → Tools (`packages/contracts/src/agentTools.ts`):
  - `name`: `sentry`.
  - `transport`: stdio, `bun ${pluginRoot}/src/mcp.ts`, with `env` as `McpServerVariable[]`.
  - `SENTRY_URL` (default `https://sentry.io`), `SENTRY_ORG`, and `SENTRY_AUTH_TOKEN` (`sensitive`).
- `contributes.panels[]`:
  - `sentry-trace` (`scope: thread`) renders `ui://sentry/trace.html`. It reads `hostContext.t3.threadId`, lists the Sentry traces whose spans carry `t3_thread_id=<threadId>`, and refetches on `host-context-changed`. Opening a trace shows its operations.
- `contributes.commands[]`: `sentry-open-trace` opens the panel.
- `t3Tools` is `[]`. The plugin never calls back into T3.

There is no `runtime`, `hooks`, `settings`, `settingsPanels`, or capability request.

## Tools

| Tool | Visibility | What it does |
|---|---|---|
| `sentry_thread_traces` | `["model", "app"]` | Spans tagged `t3_thread_id` in the last 14d (or `statsPeriod`), grouped into trace summaries, newest first. Renders `ui://sentry/trace.html`. |
| `sentry_trace` | `["model", "app"]` | One trace's operations (status, duration, thread/run ids) from the last 30d. Renders `ui://sentry/trace.html`. |

Both are read-only and query Sentry's Discover API (`GET /api/0/organizations/{org}/events/?dataset=spans`). The request names its columns, so only the span id, op, status, timestamps, trace id and the two T3 correlation tags leave Sentry. `normalizeAgentTrace` (`src/telemetry.ts`, the v1 domain module) turns them into the summaries. Calls time out after 15s. Each tool follows Sentry's `Link` cursor for at most 5 pages of 100 spans. When Sentry still has more, the result carries `truncated: true`, counts are shown as lower bounds (`100+`), and no trace is reported `ok`. `sentry_trace` then runs a second `!span.status:ok` query so its error count still covers the whole trace when that query fits in the same limit (`errorsComplete`). 5xx responses become "Sentry is temporarily unavailable", and no error includes a URL or a response body.

## v1 → v2 mapping

The v1 manifest is the last commit on `master` before this port (989908d).

| v1 | v2 |
|---|---|
| `runtime` (managed-app, `bun src/stdio.ts`) | `mcpServer.transport` (stdio, `bun ${pluginRoot}/src/mcp.ts`) |
| `panels[sentry.trace]` (thread.sidePanel) | `panels[sentry-trace]`, `scope: thread`, plus tools `sentry_thread_traces` and `sentry_trace` |
| `settings[sentry.dsn]`, `settingsPanels[sentry.settings]` | Replaced by `SENTRY_URL`, `SENTRY_ORG`, `SENTRY_AUTH_TOKEN` in `mcpServer.transport.env` (see below) |
| `capabilities.secrets.read` (`SENTRY_DSN`) | `SENTRY_AUTH_TOKEN` is a `sensitive` variable |
| `capabilities.network.connect` (`sentry.io`) | Dropped: the server process makes the calls, and the view goes through `tools/call`. `SENTRY_URL` allows regional and self-hosted Sentry. |
| `capabilities.ui.embed` (thread.sidePanel) | Implied by `panels` |
| `capabilities.events.read`, `hooks` (`session.started`, `turn.started`, `turn.settled`, `runtime.error`) | **Removed**, see below |

## Removed v1 features

- **Sending T3 agent telemetry to Sentry.** In v1, T3 was meant to deliver session, turn and runtime-error events to the plugin through `hooks`, and the plugin would forward them to the `SENTRY_DSN`. Manifest v2 has no hooks or event subscriptions (T3CODE-74 D4), and no T3 MCP tool streams those events, so there is no honest equivalent inside a plugin. The v1 stub never sent anything either: its runtime answered every RPC with a static "Plugin surface ready" card. Spans now have to reach Sentry from where they are produced (T3's own Sentry agent monitoring from upstream PR #5376, or the provider's SDK), tagged with `t3_thread_id` and `t3_run_id`. The plugin reads them back.
- **The DSN setting.** A DSN can only ingest. Reading traces needs an auth token and an organization, so `sentry.dsn` is replaced, not carried over.
- **`action.execute`.** v1 declared no actions, and its runtime only acknowledged calls. There is nothing to port.

## Open questions

1. **Tag names.** The panel matches spans by the `t3_thread_id` tag the v1 domain module already expected. Whatever emits T3 agent spans must set that tag (and `t3_run_id`) for the panel to find them.
2. **Span dataset.** The Discover `spans` dataset is what Sentry's trace explorer uses on sentry.io. Older self-hosted Sentry versions without it return a 400, which the tools report as "Sentry query failed (400): …".
