import { Router } from "../router.ts";
import { load, patch, type SyncState } from "../settings.ts";
import { MIN_PASSPHRASE, PassphraseError, applySyncPayload, decryptSyncFile, isSyncFile } from "../sync.ts";
import { HttpError } from "./crud.ts";

export const syncRouter = Router();

/** Everything about sync except the passphrase itself. */
function status(state: SyncState = load("sync")) {
  const { passphrase, ...rest } = state;
  return { configured: passphrase.length > 0, ...rest };
}

syncRouter.get("/status", (_req, res) => {
  res.json(status());
});

/** Saves (or, when empty, clears) the passphrase that unlocks synced calendars. */
syncRouter.put("/settings", (req, res) => {
  const passphrase = typeof req.body?.passphrase === "string" ? req.body.passphrase.trim() : null;
  if (passphrase === null) throw new HttpError(400, "passphrase is required");
  if (passphrase && passphrase.length < MIN_PASSPHRASE)
    throw new HttpError(400, `Use at least ${MIN_PASSPHRASE} characters. Four or more random words works well.`);
  // A new passphrase means the next file should be imported even if it was seen before.
  res.json(status(patch("sync", { passphrase, appliedSyncedAt: null, lastError: null, sourceErrors: [] })));
});

/** Imports the file GitHub published, unless it's the one already imported. */
syncRouter.post("/apply", async (req, res) => {
  const state = load("sync");
  if (!state.passphrase) throw new HttpError(400, "Type your sync passphrase in Settings first.");
  const file = req.body?.file;
  const now = new Date().toISOString();
  if (!isSyncFile(file)) {
    patch("sync", { lastCheckedAt: now, lastError: "The synced file on GitHub Pages isn't readable. Run the workflow again." });
    throw new HttpError(400, "The synced file on GitHub Pages isn't readable.");
  }
  if (!req.body?.force && file.syncedAt === state.appliedSyncedAt) {
    res.json({ changed: false, ...status(patch("sync", { lastCheckedAt: now, lastError: null })) });
    return;
  }
  let payload;
  try {
    payload = await decryptSyncFile(file, state.passphrase);
  } catch (err) {
    const message = err instanceof PassphraseError ? err.message : "The synced file couldn't be unlocked.";
    patch("sync", { lastCheckedAt: now, lastError: message });
    throw new HttpError(400, message);
  }
  const result = applySyncPayload(payload);
  const next = patch("sync", {
    appliedSyncedAt: file.syncedAt,
    lastCheckedAt: now,
    lastError: null,
    counts: result.counts,
    sourceErrors: result.errors,
  });
  res.json({ changed: true, ...status(next) });
});

/** Records why the phone couldn't check for synced calendars (offline, not set up yet). */
syncRouter.post("/error", (req, res) => {
  const message = typeof req.body?.message === "string" ? req.body.message.slice(0, 300) : "Couldn't check for synced calendars.";
  res.json(status(patch("sync", { lastCheckedAt: new Date().toISOString(), lastError: message })));
});
