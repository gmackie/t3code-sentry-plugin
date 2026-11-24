# T3 Code Sentry monitoring plugin

Install this directory in T3 Code, then open **Settings → Tools → Sentry → Sign in**. Select **Inspect Issues & Events** for read-only access. Each T3 environment stores its own Sentry grant. T3 connects to Sentry's hosted MCP endpoint over HTTP. [Sentry MCP](https://mcp.sentry.dev/)

Use `search_events` to find spans tagged with a T3 thread ID and `get_trace_details` to inspect a trace. The hosted server controls which tools and inline views the grant can use.

## Stdio operator tools

The standalone server exposes `sentry_thread_traces`, `sentry_trace`, and their `ui://sentry/trace.html` view. It reads the spans emitted by T3 agent monitoring or a provider SDK and returns span IDs, operations, statuses, timestamps, and T3 thread and run tags.

Set `SENTRY_ORG` to the organization slug and `SENTRY_AUTH_TOKEN` to an operator token with `org:read` and `event:read`. Set `SENTRY_URL` for a regional or self-hosted instance. Run the server or Inspector from this checkout.

```sh
bun install --frozen-lockfile
bun run mcp
# Or launch MCP Inspector
bun run inspect
```

## Develop

```sh
bun install --frozen-lockfile
bun test
bun run typecheck
```
