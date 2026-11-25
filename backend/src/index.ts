import { createApp } from "./app.js";
import { config } from "./config.js";
import { log, logDir } from "./logger.js";
import { tzName } from "./ai/time.js";

createApp().listen(config.port, () => {
  log.info("backend started", {
    port: config.port,
    mockCalendar: config.useMock,
    model: config.anthropicModel,
    llmKeyPresent: Boolean(config.anthropicApiKey),
    googleClientConfigured: Boolean(config.google.clientId && config.google.clientSecret),
    googleRedirectUri: config.google.redirectUri,
    node: process.version,
    timezone: tzName(),
    logs: logDir(),
  });
  if (config.useMock) log.warn("USE_MOCK=true: changes stay in this app's memory. Nothing is sent to Google Calendar and no invites/emails are sent.");
});

process.on("unhandledRejection", (e) => log.error("unhandledRejection", { err: e }));
process.on("uncaughtException", (e) => log.error("uncaughtException", { err: e }));
