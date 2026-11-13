// Test fixtures: a fake Sentry Discover API on a local Bun.serve port, and an
// MCP client connected in memory to the plugin server.
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createSentryMcpServer, type SentryServerOptions } from "./server.ts";

export const TRACE_A = "a".repeat(32);
export const TRACE_B = "b".repeat(32);

// Rows as Sentry's /events/?dataset=spans returns them for our field list.
export const SPAN_ROWS = [
  { id: "s3", trace: TRACE_B, "span.op": "gen_ai.execute_tool", "span.status": "internal_error", "precise.start_ts": 20, "precise.finish_ts": 20.5, timestamp: "2026-11-01T10:00:20Z", t3_thread_id: "thread-1", t3_run_id: "run-2" },
  { id: "s2", trace: TRACE_A, "span.op": "gen_ai.execute_tool", "span.status": "ok", "precise.start_ts": 10.25, "precise.finish_ts": 11, timestamp: "2026-11-01T10:00:11Z", t3_thread_id: "thread-1", t3_run_id: "run-1" },
  { id: "s1", trace: TRACE_A, "span.op": "gen_ai.invoke_agent", "span.status": "ok", "precise.start_ts": 10, "precise.finish_ts": 12.5, timestamp: "2026-11-01T10:00:12Z", t3_thread_id: "thread-1", t3_run_id: "run-1", "user.email": "omit@example.com" },
];

export type FakeSentry = {
  url: string;
  requests: URL[];
  authorization: (string | null)[];
  respond: (handler: (url: URL) => Response | Promise<Response>) => void;
  stop: () => void;
};

export function fakeSentry(): FakeSentry {
  const requests: URL[] = [];
  const authorization: (string | null)[] = [];
  let handler = (url: URL): Response | Promise<Response> => {
    const query = url.searchParams.get("query") ?? "";
    const rows = SPAN_ROWS.filter((row) => (query.startsWith("trace:") ? row.trace === query.slice(6) : query === `t3_thread_id:${row.t3_thread_id}`));
    return Response.json({ data: rows, meta: {} });
  };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push(url);
      authorization.push(request.headers.get("authorization"));
      if (url.pathname !== "/api/0/organizations/acme/events/") return Response.json({ detail: "The requested resource does not exist" }, { status: 404 });
      return handler(url);
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}`,
    requests,
    authorization,
    respond: (next) => void (handler = next),
    stop: () => void server.stop(true),
  };
}

export async function connectedClient(options: SentryServerOptions = {}) {
  const server = createSentryMcpServer(options);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-host", version: "1.0.0" });
  await client.connect(clientTransport);
  return { client, server };
}
