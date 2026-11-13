import { describe, expect, it } from "bun:test";

import { normalizeAgentTrace } from "../telemetry.ts";
import { renderTraces } from "./render.ts";

const trace = normalizeAgentTrace("trace-1", [
  { span_id: "s1", op: "gen_ai.invoke_agent <script>", status: "ok", start_timestamp: 1, timestamp: 13.5, tags: { t3_thread_id: "t1", t3_run_id: "run-1" } },
  { span_id: "s2", op: "tool", status: "error", start_timestamp: 1, timestamp: 1.2, tags: {} },
]);

describe("trace view renderer", () => {
  it("lists a thread's traces with counts and an open action, escaping Sentry content", () => {
    const html = renderTraces({ mode: "thread", threadId: "t1", traces: [trace], refreshedAt: "2026-11-01T00:00:00Z" });
    expect(html).toContain('data-action="open-trace" data-trace-id="trace-1"');
    expect(html).toContain("2 operations");
    expect(html).toContain("1 errors");
    expect(html).toContain("longest 12.5 s");
    expect(html).toContain("run run-1");
    expect(html).not.toContain("<script>");
  });

  it("shows an honest empty state and errors", () => {
    const html = renderTraces({ mode: "thread", threadId: "t1", traces: [], refreshedAt: "2026-11-01T00:00:00Z" }, { error: "Sentry is temporarily <down>" });
    expect(html).toContain("No Sentry spans are tagged with this thread yet.");
    expect(html).toContain('role="alert">Sentry is temporarily &lt;down&gt;');
  });

  it("renders one trace's operations with durations, status and a back button", () => {
    const html = renderTraces({ mode: "trace", traces: [trace], refreshedAt: "2026-11-01T00:00:00Z" }, { back: true });
    expect(html).toContain("gen_ai.invoke_agent &lt;script&gt;");
    expect(html).toContain("12.5 s");
    expect(html).toContain("200 ms");
    expect(html).toContain("pill-negative");
    expect(html).toContain('data-action="back"');
    expect(renderTraces({ mode: "trace", traces: [normalizeAgentTrace("t", [])], refreshedAt: "" })).toContain("outside the 30-day window");
  });

  it("says when Sentry had more spans than were read", () => {
    const partial = normalizeAgentTrace("trace-2", [{ span_id: "s1", op: "tool", status: "ok", tags: {} }], { truncated: true });
    const list = renderTraces({ mode: "thread", threadId: "t1", traces: [partial], refreshedAt: "", truncated: true, spansRead: 500 });
    expect(list).toContain("Showing the newest 500 spans; Sentry has more.");
    expect(list).toContain("1+ operations");
    expect(list).toContain("pill-warning");
    const detail = renderTraces({ mode: "trace", traces: [partial], refreshedAt: "", truncated: true, spansRead: 500, errorsComplete: true });
    expect(detail).toContain("1+ operations · 0 errors");
    expect(detail).toContain("the error count covers the whole trace");
    expect(renderTraces({ mode: "thread", traces: [trace], refreshedAt: "" })).not.toContain("Sentry has more");
  });
});
