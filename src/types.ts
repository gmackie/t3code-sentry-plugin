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
  /** Sentry had more spans than were read, so the counts are lower bounds. */
  truncated?: boolean;
  spans: readonly AgentSpan[];
};
