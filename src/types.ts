export type AgentSpan = {
  traceId: string;
  spanId: string;
  operation: string;
  status: "ok" | "error" | "unknown";
  durationMs?: number;
  threadId?: string;
  runId?: string;
};

export type MonitoringSummary = {
  providerId: "sentry";
  traceId: string;
  status: "ok" | "error" | "partial";
  operationCount: number;
  errorCount: number;
  spans: readonly AgentSpan[];
};
