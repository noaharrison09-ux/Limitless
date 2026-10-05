import path from "node:path";

const env = process.env;

export const config = {
  port: Number(env.PORT ?? 8787),
  dataDir: path.resolve(env.DATA_DIR ?? "./data"),
  /** The one password that unlocks the app. Required in production. */
  appPassword: env.APP_PASSWORD ?? "",
  /** Optional extra secret mixed into the at-rest encryption key for stored credentials. */
  appSecret: env.APP_SECRET ?? "",
  /** Public https URL of the deployed app, used in notification links and as the VAPID subject. */
  publicUrl: (env.PUBLIC_URL ?? "").replace(/\/$/, ""),
  /** Optional: enables AI email screening without pasting the key into Settings. */
  anthropicApiKey: env.ANTHROPIC_API_KEY ?? "",
  isProduction: env.NODE_ENV === "production",
  /** Set DISABLE_SCHEDULER=1 to run the API without background jobs (tests, local poking). */
  schedulerEnabled: env.DISABLE_SCHEDULER !== "1",
};

export function assertConfig() {
  if (!config.appPassword) {
    if (config.isProduction) {
      throw new Error("APP_PASSWORD must be set. It is the password you use to unlock the app.");
    }
    config.appPassword = "limitless";
    console.warn('[config] APP_PASSWORD not set; using "limitless" for local development.');
  }
}
