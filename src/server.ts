import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { RESOURCE_MIME_TYPE, registerAppResource, registerAppTool } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { loadConfig } from "./config.ts";
import { createSentryClient, searchAllSpans, type Fetch, type RawSpan } from "./sentryClient.ts";
import { normalizeAgentTrace } from "./telemetry.ts";
import { VIEWS, viewHtml, type ViewName } from "./views/html.ts";
import type { TracesData } from "./views/render.ts";

export const SERVER_INFO = { name: "sentry", version: "0.2.0" } as const;

export type SentryServerOptions = {
  env?: Record<string, string | undefined>;
  fetch?: Fetch;
  timeoutMs?: number;
};

const traceId = z
  .string()
  .regex(/^[0-9a-fA-F]{32}$/, "traceId must be a 32-character hex Sentry trace id")
  .describe("Sentry trace id (32 hex characters)");
// Constrained so the value can be placed in a Sentry search query verbatim.
const threadId = z
  .string()
  .regex(/^[A-Za-z0-9_.:-]{1,128}$/, "threadId may only contain letters, digits and _ . : -")
  .describe("T3 thread id, matched against the t3_thread_id span tag");

// Discover's per_page maximum, and how many pages one tool call may read.
// Past that the result is marked truncated rather than presented as complete.
export const PAGE_SIZE = 100;
export const MAX_PAGES = 5;

export function createSentryMcpServer(options: SentryServerOptions = {}): McpServer {
  const server = new McpServer(SERVER_INFO, {
    instructions:
      "Sentry reads agent-monitoring traces back from Sentry. Use sentry_thread_traces to find the traces a T3 thread produced (spans tagged t3_thread_id) and sentry_trace to inspect one trace's operations, durations and errors.",
  });

  // Config is read per call so a misconfigured plugin still starts and every
  // tool explains which setting is missing.
  const client = () => createSentryClient(loadConfig(options.env ?? process.env), { ...(options.fetch ? { fetch: options.fetch } : {}), ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}) });

  for (const [name, view] of Object.entries(VIEWS) as [ViewName, (typeof VIEWS)[ViewName]][]) {
    registerAppResource(server, view.title, view.uri, { mimeType: RESOURCE_MIME_TYPE, _meta: { ui: { prefersBorder: true } } }, async () => ({
      contents: [{ uri: view.uri, mimeType: RESOURCE_MIME_TYPE, text: await viewHtml(name), _meta: { ui: { prefersBorder: true } } }],
    }));
  }

  registerAppTool(
    server,
    "sentry_thread_traces",
    {
      title: "Sentry traces for a thread",
      description: "List the Sentry agent traces whose spans are tagged with a T3 thread id, newest first, with operation and error counts. Renders the Sentry trace view.",
      inputSchema: z.object({
        threadId,
        statsPeriod: z.enum(["24h", "7d", "14d", "30d", "90d"]).optional().describe("How far back to search; defaults to 14d"),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.trace.uri, visibility: ["model", "app"] } },
    },
    async ({ threadId: id, statsPeriod }) =>
      result(async () => {
        const { spans, truncated } = await searchAllSpans(client(), { query: `t3_thread_id:${id}`, statsPeriod: statsPeriod ?? "14d", limit: PAGE_SIZE, maxPages: MAX_PAGES });
        // Once the read stops early, any trace may have unread spans, so none
        // of them is reported complete.
        const traces = groupByTrace(spans).map(([trace, rows]) => normalizeAgentTrace(trace, rows, { truncated }));
        const data: TracesData = { mode: "thread", threadId: id, traces, refreshedAt: new Date().toISOString(), ...(truncated ? { truncated: true, spansRead: spans.length } : {}) };
        const lines = traces.map((trace) => `- ${trace.traceId} [${trace.status}] ${trace.operationCount}${truncated ? "+" : ""} operations, ${trace.errorCount}${truncated ? "+" : ""} errors`);
        const note = truncated ? `\nShowing only the newest ${spans.length} spans: Sentry has more, so older traces may be missing and counts are lower bounds. Use sentry_trace for one trace's full error count.` : "";
        return { data, text: traces.length ? `${traces.length} Sentry traces for thread ${id}:\n${lines.join("\n")}${note}` : `No Sentry spans tagged t3_thread_id=${id} in the last ${statsPeriod ?? "14d"}.` };
      }),
  );

  registerAppTool(
    server,
    "sentry_trace",
    {
      title: "Sentry trace",
      description: "Summarize one Sentry trace: each agent operation with its status, duration and T3 thread/run correlation ids. Raw payloads and other tags are never returned.",
      inputSchema: z.object({ traceId }),
      annotations: { readOnlyHint: true, openWorldHint: true },
      _meta: { ui: { resourceUri: VIEWS.trace.uri, visibility: ["model", "app"] } },
    },
    async ({ traceId: id }) =>
      result(async () => {
        const trace = id.toLowerCase();
        const sentry = client();
        const all = await searchAllSpans(sentry, { query: `trace:${trace}`, statsPeriod: "30d", limit: PAGE_SIZE, maxPages: MAX_PAGES });
        let spans = all.spans;
        let errorsComplete = !all.truncated;
        if (all.truncated) {
          // The trace is too large to read whole; read its non-ok spans
          // separately so failures past the read window are still counted.
          const failed = await searchAllSpans(sentry, { query: `trace:${trace} !span.status:ok`, statsPeriod: "30d", limit: PAGE_SIZE, maxPages: MAX_PAGES });
          const seen = new Set(spans.map((span) => span.span_id));
          spans = [...spans, ...failed.spans.filter((span) => !seen.has(span.span_id))];
          errorsComplete = !failed.truncated;
        }
        const summary = normalizeAgentTrace(trace, spans, { truncated: all.truncated });
        const data: TracesData = { mode: "trace", traces: [summary], refreshedAt: new Date().toISOString(), ...(all.truncated ? { truncated: true, spansRead: spans.length, errorsComplete } : {}) };
        if (summary.operationCount === 0) return { data, text: `Sentry has no spans for trace ${trace} in the last 30d.` };
        // The model text lists failures first and at most PAGE_SIZE operations;
        // structuredContent carries every span read.
        const ordered = [...summary.spans.filter((span) => span.status === "error"), ...summary.spans.filter((span) => span.status !== "error")];
        const lines = ordered.slice(0, PAGE_SIZE).map((span) => `- ${span.operation} [${span.status}]${span.durationMs !== undefined ? ` ${span.durationMs}ms` : ""}${span.runId ? ` run ${span.runId}` : ""}`);
        if (ordered.length > PAGE_SIZE) lines.push(`- ... ${ordered.length - PAGE_SIZE} more operations in the trace view`);
        const counts = all.truncated
          ? `${summary.operationCount}+ operations (the trace has more spans than were read), ${summary.errorCount}${errorsComplete ? "" : "+"} errors${errorsComplete ? " across the whole trace" : ""}`
          : `${summary.operationCount} operations, ${summary.errorCount} errors`;
        return { data, text: `Trace ${trace} [${summary.status}]: ${counts}.\n${lines.join("\n")}` };
      }),
  );

  return server;
}

// Newest trace first (spans arrive sorted by -timestamp).
function groupByTrace(spans: readonly RawSpan[]): [string, RawSpan[]][] {
  const groups = new Map<string, RawSpan[]>();
  for (const span of spans) {
    if (!span.trace_id) continue;
    const rows = groups.get(span.trace_id) ?? [];
    rows.push(span);
    groups.set(span.trace_id, rows);
  }
  return [...groups];
}

async function result(run: () => Promise<{ data: unknown; text: string }>): Promise<CallToolResult> {
  try {
    const { data, text } = await run();
    return { content: [{ type: "text", text }], structuredContent: data as Record<string, unknown> };
  } catch (error) {
    return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
  }
}
