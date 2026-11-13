// The v1 plugin had one setting, a Sentry DSN, used by hooks to send agent
// telemetry. v2 has no hooks, so the plugin reads traces back from Sentry's
// API instead, which needs an auth token and an organization (DSNs only ingest).
// These env vars are declared under mcpServer.transport.env in t3-plugin.json.
export type SentryConfig = {
  readonly baseUrl: string;
  readonly token: string;
  readonly org: string;
};

export const DEFAULT_SENTRY_URL = "https://sentry.io";

export class SentryConfigError extends Error {}

// Read per tool call, not at startup: the server must still start and list its
// tools when settings are missing, and each call explains what to fill in.
export function loadConfig(env: Record<string, string | undefined> = process.env): SentryConfig {
  const token = env.SENTRY_AUTH_TOKEN?.trim();
  const org = env.SENTRY_ORG?.trim();
  const missing = [token ? undefined : "SENTRY_AUTH_TOKEN", org ? undefined : "SENTRY_ORG"].filter(Boolean);
  if (missing.length) {
    throw new SentryConfigError(`Sentry is not configured: set ${missing.join(" and ")} in the Sentry plugin's settings (Settings → Tools → sentry).`);
  }
  const raw = env.SENTRY_URL?.trim() || DEFAULT_SENTRY_URL;
  let baseUrl: URL;
  try {
    baseUrl = new URL(raw);
  } catch {
    throw new SentryConfigError("SENTRY_URL is not a valid URL (e.g. https://sentry.io).");
  }
  if (baseUrl.protocol !== "https:" && baseUrl.protocol !== "http:") throw new SentryConfigError("SENTRY_URL must be an http(s) URL.");
  return { baseUrl: baseUrl.href.replace(/\/+$/, ""), token: token!, org: org! };
}
