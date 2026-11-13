// Pure HTML renderers shared by the ui:// view (bundled into the browser) and
// the tests. All dynamic text goes through esc().
import type { AgentSpan, MonitoringSummary } from "../types.ts";

export type TracesData = {
  /** "thread": every trace tagged with threadId. "trace": one trace in detail. */
  mode: "thread" | "trace";
  threadId?: string;
  traces: readonly MonitoringSummary[];
  refreshedAt: string;
};

export function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const time = (iso?: string) => (iso ? new Date(iso).toLocaleString() : "");

const tone: Record<MonitoringSummary["status"] | AgentSpan["status"], string> = {
  ok: "positive",
  error: "negative",
  partial: "warning",
  unknown: "neutral",
};

function pill(label: string): string {
  return `<span class="pill pill-${esc(tone[label as keyof typeof tone] ?? "neutral")}">${esc(label)}</span>`;
}

function duration(ms?: number): string {
  if (ms === undefined) return "";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)} s`;
}

function header(title: string, data: TracesData, back: boolean): string {
  return `<header>
  <h1>${esc(title)}</h1>
  <div class="header-meta"><span>Refreshed ${esc(time(data.refreshedAt))}</span>${back ? `<button type="button" data-action="back">Back</button>` : ""}<button type="button" data-action="refresh">Refresh</button></div>
</header>`;
}

export function renderTraces(data: TracesData, options: { back?: boolean; error?: string } = {}): string {
  const error = options.error ? `<p class="error" role="alert">${esc(options.error)}</p>` : "";
  if (data.mode === "trace") return renderTrace(data, options.back ?? false, error);
  const rows = data.traces.length
    ? data.traces
        .map((trace) => {
          const longest = Math.max(0, ...trace.spans.map((span) => span.durationMs ?? 0));
          const runs = [...new Set(trace.spans.flatMap((span) => (span.runId ? [span.runId] : [])))];
          return `<li class="row">
  <div class="row-main">
    <div class="row-title mono">${esc(trace.traceId)}</div>
    <div class="row-meta">${pill(trace.status)}<span>${esc(trace.operationCount)} operations</span>${trace.errorCount ? `<span class="error">${esc(trace.errorCount)} errors</span>` : ""}${longest ? `<span>longest ${esc(duration(longest))}</span>` : ""}${runs.length ? `<span>run ${runs.map(esc).join(", ")}</span>` : ""}</div>
  </div>
  <button type="button" data-action="open-trace" data-trace-id="${esc(trace.traceId)}">Open</button>
</li>`;
        })
        .join("\n")
    : `<li class="empty">No Sentry spans are tagged with this thread yet.</li>`;
  return `${header("Sentry traces", data, false)}
${data.threadId ? `<p class="subject">Thread <span class="mono">${esc(data.threadId)}</span></p>` : ""}
${error}
<section aria-label="Traces"><h2>Traces <span class="count">${data.traces.length}</span></h2><ul>${rows}</ul></section>`;
}

function renderTrace(data: TracesData, back: boolean, error: string): string {
  const trace = data.traces[0];
  if (!trace) return `${header("Sentry trace", data, back)}${error}<p class="empty">No trace.</p>`;
  const spans = trace.spans.length
    ? trace.spans
        .map(
          (span) => `<li class="row">
  <div class="row-main">
    <div class="row-title">${esc(span.operation)}</div>
    <div class="row-meta">${pill(span.status)}${span.durationMs !== undefined ? `<span>${esc(duration(span.durationMs))}</span>` : ""}${span.runId ? `<span>run <span class="mono">${esc(span.runId)}</span></span>` : ""}${span.threadId ? `<span>thread <span class="mono">${esc(span.threadId)}</span></span>` : ""}<span class="mono">${esc(span.spanId)}</span></div>
  </div>
</li>`,
        )
        .join("\n")
    : `<li class="empty">Sentry has no spans for this trace. It may be outside the 30-day window or not ingested yet.</li>`;
  return `${header("Sentry trace", data, back)}
<p class="subject">${pill(trace.status)} <span class="mono">${esc(trace.traceId)}</span> <span>${esc(trace.operationCount)} operations · ${esc(trace.errorCount)} errors</span></p>
${error}
<section aria-label="Operations"><h2>Operations</h2><ul>${spans}</ul></section>`;
}

export const STYLES = `
:root { color-scheme: light dark; --fg: #1f2328; --muted: #656d76; --bg: transparent; --line: #d0d7de; --accent: #0969da; --pos: #1a7f37; --neg: #cf222e; --warn: #9a6700; font: 13px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
:root[data-theme="dark"] { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --fg: #e6edf3; --muted: #8d96a0; --line: #30363d; --accent: #4493f8; --pos: #3fb950; --neg: #f85149; --warn: #d29922; } }
* { box-sizing: border-box; }
body { margin: 0; padding: 12px; color: var(--fg); background: var(--bg); }
header { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; flex-wrap: wrap; }
h1 { font-size: 15px; margin: 0; } h2 { font-size: 12px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); margin: 16px 0 6px; }
.header-meta { display: flex; gap: 8px; align-items: center; color: var(--muted); }
ul { list-style: none; margin: 0; padding: 0; }
.row { display: flex; gap: 8px; align-items: center; padding: 8px 0; border-top: 1px solid var(--line); }
.row-main { flex: 1; min-width: 0; } .row-title { font-weight: 500; overflow-wrap: anywhere; }
.row-meta { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; color: var(--muted); font-size: 12px; margin-top: 2px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; overflow-wrap: anywhere; }
.count { font-weight: 400; } .empty { color: var(--muted); padding: 8px 0; border-top: 1px solid var(--line); }
.pill { border: 1px solid currentColor; border-radius: 999px; padding: 0 7px; font-size: 11px; line-height: 17px; }
.pill-positive { color: var(--pos); } .pill-negative { color: var(--neg); } .pill-warning { color: var(--warn); } .pill-neutral { color: var(--muted); }
button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px; padding: 3px 10px; cursor: pointer; }
button:hover:not(:disabled) { border-color: var(--accent); } button:disabled { opacity: .5; cursor: default; }
.subject { margin: 6px 0 0; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; color: var(--muted); }
.error { color: var(--neg); }
`;
