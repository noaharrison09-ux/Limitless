import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertConfig, config } from "./config.ts";
import { openDb } from "./db.ts";
import { createApp } from "./app.ts";
import { startScheduler } from "./services/scheduler.ts";
import { vapidPublicKey } from "./services/push.ts";

assertConfig();
openDb(path.join(config.dataDir, "limitless.db"));
vapidPublicKey();

const here = path.dirname(fileURLToPath(import.meta.url));
const app = createApp({ staticDir: path.resolve(here, "../dist") });

app.listen(config.port, () => {
  console.log(`[limitless] listening on http://localhost:${config.port}`);
  if (config.schedulerEnabled) startScheduler();
});
