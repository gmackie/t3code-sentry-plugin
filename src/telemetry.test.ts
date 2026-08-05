import { describe, expect, it } from "bun:test";

import { normalizeAgentTrace } from "./telemetry.ts";

describe("Sentry monitoring plugin", () => {
  it("normalizes agent spans and keeps T3 correlation metadata", () => {
    expect(normalizeAgentTrace("trace-1", [{
      span_id: "span-1",
      op: "gen_ai.invoke_agent",
      status: "ok",
      start_timestamp: 10,
      timestamp: 11.25,
      tags: { t3_thread_id: "thread-1", t3_run_id: "run-1", secret: "omit" },
    }])).toEqual({
      providerId: "sentry",
      traceId: "trace-1",
      status: "ok",
      operationCount: 1,
      errorCount: 0,
      spans: [{ traceId: "trace-1", spanId: "span-1", operation: "gen_ai.invoke_agent", status: "ok", durationMs: 1250, threadId: "thread-1", runId: "run-1" }],
    });
  });

  it("marks malformed or failed traces without exposing arbitrary tags", () => {
    expect(normalizeAgentTrace("trace-2", [{ span_id: "span-2", op: "tool", status: "error", tags: { token: "secret" } }, null])).toMatchObject({ status: "error", operationCount: 1, errorCount: 1 });
    expect(normalizeAgentTrace("trace-3", []).status).toBe("partial");
  });
});
