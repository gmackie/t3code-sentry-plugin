import type { SentryConfig } from "./config.ts";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export class SentryApiError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

// The raw span shape normalizeAgentTrace() reads (Sentry's span JSON).
export type RawSpan = {
  trace_id: string;
  span_id: string;
  op: string;
  status: string;
  start_timestamp?: number;
  timestamp?: number;
  tags: { t3_thread_id?: string; t3_run_id?: string };
};

export type SentrySpanClient = {
  /** Spans matching a Discover search query, newest first. */
  searchSpans(input: { query: string; statsPeriod: string; limit: number }): Promise<RawSpan[]>;
};

// Only these columns are requested, so arbitrary tags and payloads never leave
// Sentry. t3_thread_id/t3_run_id are the correlation tags T3 agent spans carry.
const FIELDS = ["id", "trace", "span.op", "span.status", "precise.start_ts", "precise.finish_ts", "timestamp", "t3_thread_id", "t3_run_id"] as const;

export const TIMEOUT_MS = 15_000;

// Sentry's Discover API (GET /api/0/organizations/{org}/events/, dataset=spans),
// the same query the Sentry trace explorer runs.
export function createSentryClient(config: SentryConfig, options: { fetch?: Fetch; timeoutMs?: number } = {}): SentrySpanClient {
  const doFetch: Fetch = options.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;

  return {
    async searchSpans({ query, statsPeriod, limit }) {
      const params = new URLSearchParams({ dataset: "spans", query, statsPeriod, per_page: String(limit), sort: "-timestamp" });
      for (const field of FIELDS) params.append("field", field);
      const url = `${config.baseUrl}/api/0/organizations/${encodeURIComponent(config.org)}/events/?${params}`;
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "GET",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { accept: "application/json", authorization: `Bearer ${config.token}` },
        });
      } catch (error) {
        if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
          throw new SentryApiError(0, `Sentry did not respond within ${Math.max(1, Math.ceil(timeoutMs / 1000))}s`);
        }
        throw new SentryApiError(0, "Could not reach Sentry; check SENTRY_URL and the network");
      }
      if (!response.ok) throw await apiError(response, config.org);
      const body = (await response.json().catch(() => null)) as { data?: unknown } | null;
      if (!body || !Array.isArray(body.data)) throw new SentryApiError(response.status, "Sentry returned an unexpected response");
      return body.data.flatMap((row) => toRawSpan(row));
    },
  };
}

// Errors stay short: no URLs and no response bodies beyond Sentry's own
// one-line `detail` for 4xx responses.
async function apiError(response: Response, org: string): Promise<SentryApiError> {
  const { status } = response;
  if (status >= 500) return new SentryApiError(status, "Sentry is temporarily unavailable");
  if (status === 401 || status === 403) {
    return new SentryApiError(status, `Sentry rejected the auth token (${status}); check SENTRY_AUTH_TOKEN has org:read access to "${org}"`);
  }
  if (status === 404) return new SentryApiError(status, `Sentry organization "${org}" was not found; check SENTRY_ORG`);
  if (status === 429) return new SentryApiError(status, "Sentry rate limit reached; try again shortly");
  const body = (await response.json().catch(() => null)) as { detail?: unknown } | null;
  const detail = typeof body?.detail === "string" ? `: ${body.detail.slice(0, 200)}` : "";
  return new SentryApiError(status, `Sentry query failed (${status})${detail}`);
}

const SPAN_STATUS_OK = new Set(["ok"]);
const SPAN_STATUS_UNKNOWN = new Set(["", "unknown", "unset"]);

function toRawSpan(row: unknown): RawSpan[] {
  if (!row || typeof row !== "object") return [];
  const value = row as Record<string, unknown>;
  const spanId = value.id;
  const op = value["span.op"];
  if (typeof spanId !== "string" || typeof op !== "string") return [];
  const rawStatus = typeof value["span.status"] === "string" ? (value["span.status"] as string) : "";
  // Sentry reports failures as internal_error, deadline_exceeded, ...
  const status = SPAN_STATUS_OK.has(rawStatus) ? "ok" : SPAN_STATUS_UNKNOWN.has(rawStatus) ? "unknown" : "error";
  const start = seconds(value["precise.start_ts"]);
  const end = seconds(value["precise.finish_ts"]);
  return [
    {
      trace_id: typeof value.trace === "string" ? value.trace : "",
      span_id: spanId,
      op,
      status,
      ...(start !== undefined ? { start_timestamp: start } : {}),
      ...(end !== undefined ? { timestamp: end } : {}),
      tags: {
        ...(typeof value.t3_thread_id === "string" && value.t3_thread_id ? { t3_thread_id: value.t3_thread_id } : {}),
        ...(typeof value.t3_run_id === "string" && value.t3_run_id ? { t3_run_id: value.t3_run_id } : {}),
      },
    },
  ];
}

function seconds(value: unknown): number | undefined {
  const number = typeof value === "string" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : undefined;
}
