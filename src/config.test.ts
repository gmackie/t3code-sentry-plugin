import { describe, expect, it } from "bun:test";

import { loadConfig } from "./config.ts";

describe("Sentry config", () => {
  it("defaults to sentry.io and trims values", () => {
    expect(loadConfig({ SENTRY_ORG: " acme ", SENTRY_AUTH_TOKEN: " tok " })).toEqual({ baseUrl: "https://sentry.io", org: "acme", token: "tok" });
    expect(loadConfig({ SENTRY_URL: "https://us.sentry.io/", SENTRY_ORG: "acme", SENTRY_AUTH_TOKEN: "tok" }).baseUrl).toBe("https://us.sentry.io");
  });

  it("names exactly the missing or invalid settings", () => {
    expect(() => loadConfig({ SENTRY_ORG: "acme" })).toThrow("set SENTRY_AUTH_TOKEN in");
    expect(() => loadConfig({ SENTRY_AUTH_TOKEN: "tok", SENTRY_ORG: "  " })).toThrow("set SENTRY_ORG in");
    expect(() => loadConfig({ SENTRY_URL: "not a url", SENTRY_ORG: "acme", SENTRY_AUTH_TOKEN: "tok" })).toThrow("SENTRY_URL is not a valid URL");
    expect(() => loadConfig({ SENTRY_URL: "file:///etc", SENTRY_ORG: "acme", SENTRY_AUTH_TOKEN: "tok" })).toThrow("must be an http(s) URL");
  });
});
