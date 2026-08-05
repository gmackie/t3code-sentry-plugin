# T3 Code Sentry monitoring plugin

This sample is based on upstream PR #5376, which adds Sentry agent monitoring
as a beta workflow. The plugin owns DSN configuration, transport, trace/span
normalization, and Sentry-side retention. T3 receives redacted monitoring
summaries and correlation IDs for thread/run panels.

The sample deliberately does not expose raw event payloads or arbitrary Sentry
tags to T3 clients.
