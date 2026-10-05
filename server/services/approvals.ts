import { all, get, run, tx } from "../db.ts";
import { sha256 } from "../crypto.ts";
import { notify } from "./push.ts";

export type Decision = "approved" | "declined";

export function feedDecisionKey(feedId: number, uid: string) {
  return `feed:${feedId}:${uid}`;
}

type EventRow = {
  id: number;
  feed_id: number | null;
  source: string;
  status: string;
  uid: string | null;
  title: string;
  start: string;
  end: string | null;
  all_day: number;
  location: string | null;
  description: string | null;
  email_id: number | null;
};

/** Everything waiting for a yes/no before it lands on the calendar. */
export function listPending() {
  const events = all<EventRow & { feed_name: string | null; feed_color: string | null; occurrences: number }>(`
    SELECT e.*, f.name AS feed_name, f.color AS feed_color, COUNT(*) AS occurrences
    FROM events e LEFT JOIN calendar_feeds f ON f.id = e.feed_id
    WHERE e.status = 'pending'
    GROUP BY COALESCE(e.feed_id || ':' || e.uid, 'id:' || e.id)
    ORDER BY MIN(e.start)
  `);
  const emailIds = events.map((e) => e.email_id).filter((x): x is number => x !== null);
  const emails = new Map(
    emailIds.length
      ? all<{ id: number; subject: string; from_name: string | null; from_addr: string | null }>(
          `SELECT id, subject, from_name, from_addr FROM important_emails WHERE id IN (${emailIds.map(() => "?").join(",")})`,
          ...emailIds,
        ).map((m) => [m.id, m])
      : [],
  );
  const homework = all(
    "SELECT * FROM homework WHERE approval = 'pending' AND hidden = 0 ORDER BY due_at IS NULL, due_at",
  );
  return {
    events: events.map((e) => ({ ...e, email: e.email_id ? emails.get(e.email_id) ?? null : null })),
    homework,
    count: events.length + homework.length,
  };
}

export function pendingCount(): number {
  const e = get<{ n: number }>(
    "SELECT COUNT(DISTINCT COALESCE(feed_id || ':' || uid, 'id:' || id)) AS n FROM events WHERE status = 'pending'",
  );
  const h = get<{ n: number }>("SELECT COUNT(*) AS n FROM homework WHERE approval = 'pending' AND hidden = 0");
  return (e?.n ?? 0) + (h?.n ?? 0);
}

export function decideEvent(id: number, decision: Decision) {
  const ev = get<EventRow>("SELECT * FROM events WHERE id = ?", id);
  if (!ev) return false;
  tx(() => {
    if (ev.feed_id !== null && ev.uid) {
      // Linked-calendar events: remember the decision for the whole series across re-syncs.
      run(
        `INSERT INTO calendar_decisions (key, decision, decided_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET decision = excluded.decision, decided_at = excluded.decided_at`,
        feedDecisionKey(ev.feed_id, ev.uid),
        decision,
        new Date().toISOString(),
      );
      run("UPDATE events SET status = ? WHERE feed_id = ? AND uid = ?", decision, ev.feed_id, ev.uid);
    } else if (decision === "declined") {
      run("DELETE FROM events WHERE id = ?", id);
    } else {
      run("UPDATE events SET status = 'approved' WHERE id = ?", id);
    }
  });
  return true;
}

export function decideHomework(id: number, decision: Decision) {
  const r = run(
    "UPDATE homework SET approval = ?, hidden = ? WHERE id = ?",
    decision,
    decision === "declined" ? 1 : 0,
    id,
  );
  return r.changes > 0;
}

export function approveAll(opts: { feedId?: number; kind?: "events" | "homework" } = {}) {
  tx(() => {
    if (opts.kind !== "homework") {
      const pending = all<{ id: number }>(
        `SELECT MIN(id) AS id FROM events WHERE status = 'pending' ${opts.feedId ? "AND feed_id = ?" : ""}
         GROUP BY COALESCE(feed_id || ':' || uid, 'id:' || id)`,
        ...(opts.feedId ? [opts.feedId] : []),
      );
      for (const p of pending) decideEvent(p.id, "approved");
    }
    if (opts.kind !== "events" && !opts.feedId) {
      run("UPDATE homework SET approval = 'approved' WHERE approval = 'pending'");
    }
  });
}

/** One push for a batch of newly-queued items, so syncs don't spam the phone. */
export async function announcePending(source: string, titles: string[]) {
  if (!titles.length) return;
  const shown = titles.slice(0, 4).join(" · ");
  const more = titles.length > 4 ? ` +${titles.length - 4} more` : "";
  await notify({
    title: `${titles.length} new ${titles.length === 1 ? "item" : "items"} to approve`,
    body: `${source}: ${shown}${more}`,
    url: "/approvals",
    tag: "approvals",
    dedupeKey: `pending:${sha256(source + titles.join("|"))}:${new Date().toISOString().slice(0, 10)}`,
  });
}
