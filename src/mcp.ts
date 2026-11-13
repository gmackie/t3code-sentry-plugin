#!/usr/bin/env bun
// Stdio entry point for the MCP-native Sentry plugin (manifest v2 `mcpServer`).
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

import { createSentryMcpServer } from "./server.ts";

await createSentryMcpServer().connect(new StdioServerTransport());
