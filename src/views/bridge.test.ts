import { afterAll, describe, expect, it } from "bun:test";
import { AppBridge } from "@modelcontextprotocol/ext-apps/app-bridge";

import { connectedClient, fakeSentry, TRACE_A } from "../testing.ts";
import { createViewBridge, toolData, type BridgeWindow, type CallToolResult } from "./bridge.ts";
import type { TracesData } from "./render.ts";

// Wires the view bridge to ext-apps' reference host (AppBridge) the way an
// iframe is wired to its parent: the host sends with postMessage into the view
// window, the view posts to window.parent.
function frame() {
  const listeners: ((event: { data: unknown; source?: unknown }) => void)[] = [];
  const parent = {
    postMessage(message: unknown) {
      queueMicrotask(() => hostTransport.onmessage?.(structuredClone(message) as never));
    },
  };
  const win: BridgeWindow = { parent, addEventListener: (_type, listener) => void listeners.push(listener) };
  const hostTransport = {
    onmessage: undefined as ((message: never) => void) | undefined,
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    async start() {},
    async close() {
      hostTransport.onclose?.();
    },
    async send(message: unknown) {
      queueMicrotask(() => listeners.forEach((listener) => listener({ data: structuredClone(message), source: parent })));
    },
  };
  return { win, hostTransport, inject: (data: unknown, source: unknown) => listeners.forEach((listener) => listener({ data, source })) };
}

const sentry = fakeSentry();
afterAll(() => sentry.stop());

describe("view bridge against the ext-apps reference host", () => {
  it("initializes with the thread context, receives the tool result and calls server tools", async () => {
    const { client } = await connectedClient({ env: { SENTRY_URL: sentry.url, SENTRY_ORG: "acme", SENTRY_AUTH_TOKEN: "t" } });
    const host = new AppBridge(client as never, { name: "reference-host", version: "1.0.0" }, { serverTools: {} }, { hostContext: { t3: { threadId: "thread-1" } } as never });
    const { win, hostTransport } = frame();
    const initialized = new Promise<void>((resolve) => {
      host.oninitialized = () => resolve();
    });
    await host.connect(hostTransport as never);

    const view = createViewBridge(win, { name: "sentry-trace", version: "0.2.0" });
    const received: CallToolResult[] = [];
    view.onToolResult = (result) => received.push(result);
    const { hostContext } = await view.connect();
    await initialized;
    expect(hostContext?.t3?.threadId).toBe("thread-1");

    await host.sendToolResult((await client.callTool({ name: "sentry_thread_traces", arguments: { threadId: "thread-1" } })) as never);
    await Bun.sleep(0);
    expect(toolData<TracesData>(received[0]!).traces).toHaveLength(2);

    // View → host → MCP server round trip, as the Open button does.
    const detail = toolData<TracesData>(await view.callTool("sentry_trace", { traceId: TRACE_A }));
    expect(detail.traces[0]?.operationCount).toBe(2);
  });

  it("ignores messages that do not come from the host frame", () => {
    const { win, inject } = frame();
    const view = createViewBridge(win, { name: "sentry", version: "0" });
    let called = false;
    view.onToolResult = () => {
      called = true;
    };
    inject({ jsonrpc: "2.0", method: "ui/notifications/tool-result", params: {} }, { evil: true });
    expect(called).toBe(false);
  });

  it("surfaces tool errors from structured results", () => {
    expect(() => toolData({ isError: true, content: [{ type: "text", text: "Sentry is temporarily unavailable" }] })).toThrow("Sentry is temporarily unavailable");
  });
});
