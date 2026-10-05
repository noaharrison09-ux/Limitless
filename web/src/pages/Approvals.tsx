import { useState } from "react";
import { EventSheet } from "./Calendar";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { dateStr, fmtDay, fmtDue, fmtTime } from "../lib/dates";
import type { CalEvent, Homework } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, Empty, ErrorBox, Spinner, TopBar } from "../components/ui";

type PendingEvent = {
  id: number;
  email_id: number | null;
  description: string | null;
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

/** The email an appointment came from, shown inline so you can check it before approving. */
function EmailPreview({ emailId }: { emailId: number }) {
  const { data, error } = useApi<{ subject: string; from_name: string | null; from_addr: string | null; received_at: string; body: string | null; snippet: string | null }>(
    `/email/important/${emailId}`,
  );
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return (
    <div className="email-preview">
      <div className="small">
        <strong>{data.from_name || data.from_addr}</strong> · {new Date(data.received_at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
      </div>
      <div style={{ fontWeight: 600, margin: "2px 0 8px" }}>{data.subject}</div>
      <div className="email-body">{data.body || data.snippet || "(No text in this email.)"}</div>
    </div>
  );
}

function when(e: PendingEvent) {
  const day = fmtDay(dateStr(new Date(e.start)), { long: true });
  return e.all_day ? `${day} · All day` : `${day} · ${fmtTime(e.start)}`;
}

export function ApprovalsPage() {
  const { data, error, setData } = useApi<Pending>("/approvals");
  const [busy, setBusy] = useState<string | null>(null);
  const [reading, setReading] = useState<number | null>(null);
  const [editing, setEditing] = useState<PendingEvent | null>(null);

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
          Things Limitless finds on its own (Schoology work, linked calendars, appointments in your email) wait here. Nothing reaches your calendar until you approve it.
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
                    <span className="event-bar" style={{ background: e.feed_color ?? "var(--silver)" }} />
                    <div className="row-main">
                      <div className="row-title">{e.title}</div>
                      <div className="row-sub">{when(e)}{e.location ? ` · ${e.location}` : ""}</div>
                      <div className="row-sub" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                        {e.source === "email" ? (
                          <span className="chip">
                            <Icon name="mail" size={12} /> Appointment email · {e.email?.from_name || e.email?.from_addr}
                          </span>
                        ) : (
                          <span className="chip">{e.feed_name}</span>
                        )}
                        {e.occurrences > 1 && <span className="chip">Repeats · {e.occurrences} times</span>}
                      </div>
                      {e.email?.subject && <div className="tiny muted" style={{ marginTop: 4 }}>“{e.email.subject}”</div>}
                    </div>
                  </div>
                  {e.source === "email" && (
                    <div style={{ display: "flex", gap: 14 }}>
                      {e.email_id && (
                        <button className="link-btn" onClick={() => setReading(reading === e.id ? null : e.id)}>
                          <Icon name="mail" size={15} /> {reading === e.id ? "Hide email" : "Read email"}
                        </button>
                      )}
                      <button className="link-btn" onClick={() => setEditing(e)}>
                        <Icon name="edit" size={15} /> Edit details
                      </button>
                    </div>
                  )}
                  {reading === e.id && e.email_id && <EmailPreview emailId={e.email_id} />}
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
      {editing && (
        <EventSheet
          initialDate={editing.start.slice(0, 10)}
          event={{ ...editing, url: null, color: editing.feed_color, feed_name: editing.feed_name } as CalEvent}
          onClose={() => setEditing(null)}
        />
      )}
    </>
  );
}
