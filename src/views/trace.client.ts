import { createViewBridge, toolData, type HostContext } from "./bridge.ts";
import { esc, renderTraces, type TracesData } from "./render.ts";

// One view for both tools: inline after sentry_trace/sentry_thread_traces, and
// as the thread panel, where it follows hostContext.t3.threadId.
const root = document.getElementById("app")!;
const bridge = createViewBridge(window as never, { name: "sentry-trace", version: "0.2.0" });

let context: HostContext = {};
let list: TracesData | undefined;
let detail: TracesData | undefined;
let showing: "list" | "detail" = "list";
let error: string | undefined;
let busy = false;

function draw() {
  const data = showing === "detail" ? detail : list;
  if (data) root.innerHTML = renderTraces(data, { back: showing === "detail" && list !== undefined, ...(error ? { error } : {}) });
  else if (error) root.innerHTML = `<p class="error" role="alert">${esc(error)}</p>`;
  else if (busy) root.innerHTML = `<p class="empty">Loading Sentry traces…</p>`;
  else root.innerHTML = `<p class="empty">Open this panel in a thread to see its Sentry traces, or ask the agent to run sentry_trace.</p>`;
}

async function load(name: "sentry_thread_traces" | "sentry_trace", args: Record<string, unknown>) {
  busy = true;
  error = undefined;
  draw();
  try {
    const data = toolData<TracesData>(await bridge.callTool(name, args));
    if (data.mode === "trace") {
      detail = data;
      showing = "detail";
    } else {
      list = data;
      showing = "list";
    }
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  busy = false;
  draw();
}

const loadThread = () => {
  const threadId = context.t3?.threadId;
  if (threadId) void load("sentry_thread_traces", { threadId });
  else draw();
};

bridge.onHostContext = (update) => {
  // host-context-changed may carry only the changed fields, so merge them.
  const previous = context.t3?.threadId;
  context = { ...context, ...update };
  if (context.theme) document.documentElement.dataset.theme = context.theme;
  if (list && context.t3?.threadId !== previous) loadThread();
};

bridge.onToolResult = (result) => {
  if (result.isError) {
    error = result.content?.find((part) => part.type === "text")?.text ?? "Sentry trace failed to load.";
    draw();
    return;
  }
  const data = toolData<TracesData>(result);
  if (data.mode === "trace") {
    detail = data;
    showing = "detail";
  } else {
    list = data;
    showing = "list";
  }
  error = undefined;
  draw();
};

root.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>("[data-action]");
  if (!target || busy) return;
  const action = target.dataset.action;
  if (action === "open-trace" && target.dataset.traceId) void load("sentry_trace", { traceId: target.dataset.traceId });
  if (action === "back") {
    showing = "list";
    error = undefined;
    draw();
  }
  if (action === "refresh") {
    if (showing === "detail" && detail?.traces[0]) void load("sentry_trace", { traceId: detail.traces[0].traceId });
    else if (list?.threadId) void load("sentry_thread_traces", { threadId: list.threadId });
    else loadThread();
  }
});

new ResizeObserver(() => bridge.sendSize(document.documentElement.scrollWidth, document.documentElement.scrollHeight)).observe(document.body);

// Inline, the host delivers the tool result; a thread panel only loads the
// resource, so fetch the thread's traces if nothing arrives.
void bridge.connect().then(() => setTimeout(() => void (list || detail || error ? undefined : loadThread()), 250));
