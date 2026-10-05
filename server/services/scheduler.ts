import { syncAllFeeds } from "./calendarSync.ts";
import { checkAllEmail } from "./email.ts";
import { runReminders } from "./reminders.ts";
import { syncSchoology } from "./schoology.ts";

const MINUTE = 60_000;
const EMAIL_EVERY = Number(process.env.EMAIL_POLL_MINUTES ?? 5) * MINUTE;
const SYNC_EVERY = Number(process.env.SYNC_MINUTES ?? 30) * MINUTE;

function log(label: string) {
  return (err: unknown) => console.error(`[scheduler] ${label}:`, err instanceof Error ? err.message : err);
}

export function startScheduler() {
  let lastEmail = 0;
  let lastSync = 0;

  const tick = async () => {
    const now = Date.now();
    if (now - lastSync >= SYNC_EVERY) {
      lastSync = now;
      // Calendar + Schoology first so the reminders below see fresh data.
      await syncAllFeeds().catch(log("calendar sync"));
      await syncSchoology().catch(log("schoology sync"));
    }
    if (now - lastEmail >= EMAIL_EVERY) {
      lastEmail = now;
      checkAllEmail().catch(log("email"));
    }
    await runReminders().catch(log("reminders"));
  };

  setTimeout(() => void tick(), 5_000);
  setInterval(() => void tick(), MINUTE);
  console.log("[scheduler] running: email every %d min, sync every %d min", EMAIL_EVERY / MINUTE, SYNC_EVERY / MINUTE);
}
