import type { AgentSpan, MonitoringSummary } from "./types.ts";

type RawSpan = { trace_id?: unknown; span_id?: unknown; op?: unknown; status?: unknown; start_timestamp?: unknown; timestamp?: unknown; tags?: unknown };

export function normalizeAgentTrace(traceId: string, input: unknown): MonitoringSummary {
  const rows = Array.isArray(input) ? input : [];
  const spans = rows.flatMap((row): AgentSpan[] => {
    if (!row || typeof row !== "object") return [];
    const value = row as RawSpan;
    if (typeof value.span_id !== "string" || typeof value.op !== "string") return [];
    const start = numberValue(value.start_timestamp);
    const end = numberValue(value.timestamp);
    const tags = value.tags && typeof value.tags === "object" ? value.tags as Record<string, unknown> : {};
    const status = value.status === "ok" ? "ok" : value.status === "error" ? "error" : "unknown";
    return [{
      traceId,
      spanId: value.span_id,
      operation: value.op,
      status,
      ...(start !== undefined && end !== undefined ? { durationMs: Math.max(0, Math.round((end - start) * 1000)) } : {}),
      ...(typeof tags.t3_thread_id === "string" ? { threadId: tags.t3_thread_id } : {}),
      ...(typeof tags.t3_run_id === "string" ? { runId: tags.t3_run_id } : {}),
    }];
  });
  const errorCount = spans.filter((span) => span.status === "error").length;
  return {
    providerId: "sentry",
    traceId,
    status: spans.length === 0 ? "partial" : errorCount > 0 ? "error" : "ok",
    operationCount: spans.length,
    errorCount,
    spans,
  };
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}
