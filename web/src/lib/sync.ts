/**
 * Checks GitHub Pages for calendars synced by the "Deploy to GitHub Pages" workflow and imports
 * them. Runs when the app opens and whenever you come back to it.
 */
import { api, refreshAll } from "./api";

export type SyncStatus = {
  configured: boolean;
  appliedSyncedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  counts: { homework: number; events: number } | null;
  sourceErrors: { source: string; message: string }[];
  changed?: boolean;
};

/** GitHub refreshes every 3 hours; past this, the schedule has probably stopped. */
export const STALE_AFTER_MS = 26 * 3_600_000;

let inFlight: Promise<SyncStatus> | null = null;

async function check(force: boolean): Promise<SyncStatus> {
  let res: Response;
  try {
    // Never a saved copy: the whole point is to see what GitHub published most recently.
    res = await fetch(new URL("sync/data.json", document.baseURI), { cache: "no-store" });
  } catch {
    // Offline: not a problem worth flagging; the next check will catch up.
    throw new Error("Couldn't reach GitHub Pages. Are you offline?");
  }
  if (res.status === 404) {
    return api.post<SyncStatus>("/sync/error", {
      message: "No synced calendars on GitHub yet. Add the secrets on GitHub, then run the workflow once.",
    });
  }
  if (!res.ok) return api.post<SyncStatus>("/sync/error", { message: `GitHub Pages answered ${res.status}. Try again later.` });
  const file = await res.json().catch(() => null);
  return api.post<SyncStatus>("/sync/apply", { file, force });
}

/** Checks now. Throws with a readable message when the passphrase is wrong or the file is unreadable. */
export function runSync(force = false): Promise<SyncStatus> {
  inFlight ??= check(force)
    .then((status) => {
      if (status.changed) refreshAll();
      return status;
    })
    .finally(() => {
      inFlight = null;
    });
  return inFlight;
}

let lastAuto = 0;

/** Quietly checks for new calendars, at most every 10 minutes, if sync is set up. */
export function autoSync() {
  if (Date.now() - lastAuto < 10 * 60_000) return;
  lastAuto = Date.now();
  api
    .get<SyncStatus>("/sync/status")
    .then((s) => (s.configured ? runSync() : null))
    .catch(() => {
      // Shown on the Settings screen instead.
    });
}
