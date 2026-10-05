import { useState } from "react";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { dateStr, fmtDay, fmtDue, fmtTime } from "../lib/dates";
import type { Homework } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, Empty, ErrorBox, Spinner, TopBar } from "../components/ui";

type PendingEvent = {
  id: number;
  source: "feed" | "email" | "local";
  title: string;
  start: string;
  end: string | null;
  all_day: number;
  location: string | null;
  feed_id: number | null;
  feed_name: string | null;
  feed_color: string | null;
  occurrences: number;
  email: { subject: string; from_name: string | null; from_addr: string | null } | null;
};

type Pending = { events: PendingEvent[]; homework: Homework[]; count: number };

function when(e: PendingEvent) {
  const day = fmtDay(dateStr(new Date(e.start)), { long: true });
  return e.all_day ? `${day} · All day` : `${day} · ${fmtTime(e.start)}`;
}

export function ApprovalsPage() {
  const { data, error, setData } = useApi<Pending>("/approvals");
  const [busy, setBusy] = useState<string | null>(null);

  const decide = async (kind: "event" | "homework", id: number, decision: "approved" | "declined") => {
    setBusy(`${kind}${id}`);
    try {
      setData(await api.post<Pending>("/approvals/decide", { kind, id, decision }));
      toast(decision === "approved" ? "Added to your calendar" : "Declined");
      refreshAll();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const approveAll = async (body: Record<string, unknown> = {}) => {
    if (!confirm("Approve everything in this list?")) return;
    setData(await api.post<Pending>("/approvals/approve-all", body));
    toast("All approved");
    refreshAll();
  };

  if (!data) return <>{<TopBar title="Approvals" back />}{error ? <div className="page"><ErrorBox error={error} /></div> : <Spinner />}</>;

  const feeds = new Map<number, string>();
  for (const e of data.events) if (e.feed_id && e.feed_name) feeds.set(e.feed_id, e.feed_name);

  const Actions = ({ kind, id }: { kind: "event" | "homework"; id: number }) => (
    <div className="actions">
      <button className="btn small" disabled={busy === `${kind}${id}`} onClick={() => decide(kind, id, "declined")}>
        <Icon name="x" size={16} /> Decline
      </button>
      <button className="btn small primary" disabled={busy === `${kind}${id}`} onClick={() => decide(kind, id, "approved")}>
        <Icon name="check" size={16} /> Approve
      </button>
    </div>
  );

  return (
    <>
      <TopBar title="Approvals" back />
      <div className="page">
        <p className="small" style={{ margin: "0 2px", color: "var(--ink-2)" }}>
          Things Limitless finds on its own (Schoology work, linked calendars, dates in important emails) wait here. Nothing reaches your calendar until you approve it.
        </p>

        {data.count === 0 && (
          <Card>
            <Empty icon="approve" title="All clear">
              New items will show up here, and you'll get a notification.
            </Empty>
          </Card>
        )}

        {data.homework.length > 0 && (
          <Card
            eyebrow="Schoology"
            title={`${data.homework.length} assignment${data.homework.length > 1 ? "s" : ""}`}
            action={
              <button className="link-btn" onClick={() => approveAll({ kind: "homework" })}>
                Approve all
              </button>
            }
            className="flush"
          >
            <div>
              {data.homework.map((h) => (
                <div key={h.id} className="approval">
                  <div>
                    <div className="row-title">{h.title}</div>
                    <div className="row-sub">
                      {h.course ? `${h.course} · ` : ""}Due {fmtDue(h.due_at, h.all_day)}
                    </div>
                  </div>
                  <Actions kind="homework" id={h.id} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {data.events.length > 0 && (
          <Card
            eyebrow="Calendar"
            title={`${data.events.length} event${data.events.length > 1 ? "s" : ""}`}
            action={
              <button className="link-btn" onClick={() => approveAll({ kind: "events" })}>
                Approve all
              </button>
            }
            className="flush"
          >
            <div>
              {data.events.map((e) => (
                <div key={e.id} className="approval">
                  <div style={{ display: "flex", gap: 10 }}>
                    <span className="event-bar" style={{ background: e.feed_color ?? "var(--oak)" }} />
                    <div className="row-main">
                      <div className="row-title">{e.title}</div>
                      <div className="row-sub">{when(e)}{e.location ? ` · ${e.location}` : ""}</div>
                      <div className="row-sub" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                        {e.source === "email" ? (
                          <span className="chip">
                            <Icon name="mail" size={12} /> From email: {e.email?.from_name || e.email?.from_addr}
                          </span>
                        ) : (
                          <span className="chip">{e.feed_name}</span>
                        )}
                        {e.occurrences > 1 && <span className="chip">Repeats · {e.occurrences} times</span>}
                      </div>
                      {e.email?.subject && <div className="tiny muted" style={{ marginTop: 4 }}>“{e.email.subject}”</div>}
                    </div>
                  </div>
                  <Actions kind="event" id={e.id} />
                </div>
              ))}
            </div>
          </Card>
        )}

        {feeds.size > 0 && (
          <p className="tiny muted" style={{ margin: "0 2px" }}>
            Trust a calendar completely? Turn on “Auto-approve” for it in Settings → Calendars.
          </p>
        )}
      </div>
    </>
  );
}
