import { all, run, tx } from "../db.ts";
import { decrypt } from "../crypto.ts";
import { zone } from "../time.ts";
import { fetchIcs, parseIcs } from "./ical.ts";
import { announcePending, feedDecisionKey } from "./approvals.ts";

export type FeedRow = {
  id: number;
  name: string;
  url_enc: string;
  color: string | null;
  enabled: number;
  auto_approve: number;
  last_synced: string | null;
  last_error: string | null;
};

const DAY = 86_400_000;

export async function syncFeed(feed: FeedRow): Promise<{ events: number; newPending: string[] }> {
  try {
    const text = await fetchIcs(decrypt(feed.url_enc));
    const now = Date.now();
    const parsed = parseIcs(text, new Date(now - 30 * DAY), new Date(now + 180 * DAY), zone());
    const decisions = new Map(
      all<{ key: string; decision: string }>("SELECT key, decision FROM calendar_decisions WHERE key LIKE ?", `feed:${feed.id}:%`).map(
        (d) => [d.key, d.decision],
      ),
    );
    const known = new Set(all<{ uid: string }>("SELECT DISTINCT uid FROM events WHERE feed_id = ?", feed.id).map((r) => r.uid));
    const newPending = new Map<string, string>();

    tx(() => {
      run("DELETE FROM events WHERE feed_id = ?", feed.id);
      for (const ev of parsed) {
        const status = feed.auto_approve ? "approved" : (decisions.get(feedDecisionKey(feed.id, ev.uid)) ?? "pending");
        if (status === "pending" && !known.has(ev.uid)) newPending.set(ev.uid, ev.title);
        run(
          `INSERT INTO events (feed_id, source, status, uid, title, start, end, all_day, location, description, url)
           VALUES (?, 'feed', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          feed.id,
          status,
          ev.uid,
          ev.title,
          ev.start,
          ev.end,
          ev.allDay,
          ev.location,
          ev.description,
          ev.url,
        );
      }
      run("UPDATE calendar_feeds SET last_synced = ?, last_error = NULL WHERE id = ?", new Date().toISOString(), feed.id);
    });

    // The first sync of a feed queues everything at once; skip the push for that one.
    if (feed.last_synced) await announcePending(feed.name, [...newPending.values()]);
    return { events: parsed.length, newPending: [...newPending.values()] };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    run("UPDATE calendar_feeds SET last_error = ?, last_synced = ? WHERE id = ?", msg, new Date().toISOString(), feed.id);
    throw err;
  }
}

export async function syncAllFeeds() {
  const feeds = all<FeedRow>("SELECT * FROM calendar_feeds WHERE enabled = 1");
  for (const feed of feeds) {
    try {
      await syncFeed(feed);
    } catch (err) {
      console.error(`[calendar] ${feed.name}:`, err instanceof Error ? err.message : err);
    }
  }
}
