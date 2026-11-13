import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

import type { TracesData } from "./views/render.ts";
import { connectedClient, fakeSentry, TRACE_A, TRACE_B, type FakeSentry } from "./testing.ts";

type Structured<T> = { structuredContent?: T; isError?: boolean; content: { type: string; text?: string }[] };
type TestClient = Awaited<ReturnType<typeof connectedClient>>["client"];
const call = async <T = TracesData>(client: TestClient, name: string, args: Record<string, unknown> = {}) =>
  (await client.callTool({ name, arguments: args })) as unknown as Structured<T>;

let sentry: FakeSentry;
const env = () => ({ SENTRY_URL: `${sentry.url}/`, SENTRY_ORG: "acme", SENTRY_AUTH_TOKEN: "test-token" });

beforeEach(() => {
  sentry = fakeSentry();
});
afterEach(() => sentry.stop());

describe("Sentry MCP server", () => {
  it("links both tools to the trace view and lets views call them", async () => {
    const { client } = await connectedClient({ env: env() });
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(["sentry_thread_traces", "sentry_trace"]);
    for (const tool of tools) {
      expect(tool._meta).toMatchObject({ ui: { resourceUri: "ui://sentry/trace.html", visibility: ["model", "app"] } });
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("serves the trace view as a self-contained MCP App resource", async () => {
    const { client } = await connectedClient({ env: env() });
    const { resources } = await client.listResources();
    expect(resources.map((resource) => [resource.uri, resource.mimeType])).toEqual([["ui://sentry/trace.html", RESOURCE_MIME_TYPE]]);
    const { contents } = await client.readResource({ uri: "ui://sentry/trace.html" });
    const html = (contents[0] as { text: string }).text;
    expect(html).toStartWith("<!doctype html>");
    expect(html).toContain("ui/initialize");
    // T3's sandbox CSP is default-src 'none': nothing may load from outside.
    expect(html).not.toMatch(/<script[^>]+src=|<link[^>]+href=/);
    expect(html.length).toBeLessThan(100_000);
  });

  it("lists a thread's traces from Sentry, newest first, without extra tags", async () => {
    const { client } = await connectedClient({ env: env() });
    const result = await call(client, "sentry_thread_traces", { threadId: "thread-1" });
    expect(result.isError).toBeFalsy();
    const data = result.structuredContent!;
    expect(data.mode).toBe("thread");
    expect(data.threadId).toBe("thread-1");
    expect(data.traces.map((trace) => [trace.traceId, trace.status, trace.operationCount, trace.errorCount])).toEqual([
      [TRACE_B, "error", 1, 1],
      [TRACE_A, "ok", 2, 0],
    ]);
    expect(JSON.stringify(data)).not.toContain("omit@example.com");
    expect(result.content[0]?.text).toContain(`${TRACE_B} [error] 1 operations, 1 errors`);

    const request = sentry.requests[0]!;
    expect(request.pathname).toBe("/api/0/organizations/acme/events/");
    expect(request.searchParams.get("dataset")).toBe("spans");
    expect(request.searchParams.get("query")).toBe("t3_thread_id:thread-1");
    expect(request.searchParams.get("statsPeriod")).toBe("14d");
    expect(request.searchParams.getAll("field")).toContain("t3_run_id");
    expect(sentry.authorization[0]).toBe("Bearer test-token");
  });

  it("summarizes one trace with durations and run ids", async () => {
    const { client } = await connectedClient({ env: env() });
    const result = await call(client, "sentry_trace", { traceId: TRACE_A.toUpperCase() });
    expect(result.isError).toBeFalsy();
    const [trace] = result.structuredContent!.traces;
    expect(trace).toMatchObject({ traceId: TRACE_A, status: "ok", operationCount: 2 });
    expect(trace!.spans.find((span) => span.spanId === "s1")).toEqual({ traceId: TRACE_A, spanId: "s1", operation: "gen_ai.invoke_agent", status: "ok", durationMs: 2500, threadId: "thread-1", runId: "run-1" });
    expect(sentry.requests[0]!.searchParams.get("query")).toBe(`trace:${TRACE_A}`);
    expect(result.content[0]?.text).toContain("gen_ai.invoke_agent [ok] 2500ms run run-1");
  });

  it("says a trace has no spans rather than inventing a result", async () => {
    const { client } = await connectedClient({ env: env() });
    const result = await call(client, "sentry_trace", { traceId: "c".repeat(32) });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent!.traces[0]).toMatchObject({ status: "partial", operationCount: 0 });
    expect(result.content[0]?.text).toContain("Sentry has no spans for trace");
  });

  it("explains missing settings without calling Sentry", async () => {
    const { client } = await connectedClient({ env: { SENTRY_URL: sentry.url } });
    const result = await call(client, "sentry_thread_traces", { threadId: "thread-1" });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toBe("Sentry is not configured: set SENTRY_AUTH_TOKEN and SENTRY_ORG in the Sentry plugin's settings (Settings → Tools → sentry).");
    expect(sentry.requests).toHaveLength(0);
  });

  it("rejects ids that could change the Sentry query", async () => {
    const { client } = await connectedClient({ env: env() });
    const result = await call(client, "sentry_thread_traces", { threadId: "x OR trace:*" });
    expect(result.isError).toBe(true);
    expect(sentry.requests).toHaveLength(0);
  });

  it("keeps upstream failures short and free of URLs and bodies", async () => {
    const { client } = await connectedClient({ env: env() });
    sentry.respond(() => new Response(`stack trace at ${sentry.url}/internal`, { status: 502 }));
    const unavailable = await call(client, "sentry_trace", { traceId: TRACE_A });
    expect(unavailable).toMatchObject({ isError: true, content: [{ type: "text", text: "Sentry is temporarily unavailable" }] });

    sentry.respond(() => Response.json({ detail: "Invalid token" }, { status: 401 }));
    const rejected = await call(client, "sentry_trace", { traceId: TRACE_A });
    expect(rejected.content[0]?.text).toBe('Sentry rejected the auth token (401); check SENTRY_AUTH_TOKEN has org:read access to "acme"');

    sentry.respond(() => Response.json({ detail: "Invalid query: bad <field>" }, { status: 400 }));
    const invalid = await call(client, "sentry_trace", { traceId: TRACE_A });
    expect(invalid.content[0]?.text).toBe("Sentry query failed (400): Invalid query: bad <field>");

    const wrongOrg = await connectedClient({ env: { ...env(), SENTRY_ORG: "nope" } });
    const missing = await call(wrongOrg.client, "sentry_trace", { traceId: TRACE_A });
    expect(missing.content[0]?.text).toBe('Sentry organization "nope" was not found; check SENTRY_ORG');
    for (const result of [unavailable, rejected, invalid, missing]) expect(result.content[0]?.text).not.toContain(sentry.url);
  });

  it("bounds slow Sentry calls with a timeout", async () => {
    const { client } = await connectedClient({ env: env(), timeoutMs: 50 });
    sentry.respond(async () => {
      await Bun.sleep(500);
      return Response.json({ data: [] });
    });
    const result = await call(client, "sentry_trace", { traceId: TRACE_A });
    expect(result).toMatchObject({ isError: true, content: [{ text: "Sentry did not respond within 1s" }] });
  });

  it("reports an unreachable Sentry without the URL", async () => {
    const { client } = await connectedClient({ env: { ...env(), SENTRY_URL: "http://127.0.0.1:1" } });
    const result = await call(client, "sentry_trace", { traceId: TRACE_A });
    expect(result).toMatchObject({ isError: true, content: [{ text: "Could not reach Sentry; check SENTRY_URL and the network" }] });
  });
});
