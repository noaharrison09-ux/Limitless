import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { dateStr, fmtDue, fmtLongDate, fmtTime, greeting, isOverdue, todayStr } from "../lib/dates";
import { currentSubscription, enablePush, isIos, needsInstallForPush, pushSupported } from "../lib/push";
import type { Homework, Settings, Today } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, ErrorBox, Progress, Spinner, fmtNum, signed } from "../components/ui";

function NotificationPrompt() {
  const [state, setState] = useState<"unknown" | "on" | "off">("unknown");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    currentSubscription()
      .then((s) => setState(s ? "on" : "off"))
      .catch(() => setState("off"));
  }, []);
  if (state !== "off") return null;

  if (needsInstallForPush()) {
    return (
      <Card className="accent-edge" eyebrow="Get notifications" title="Add Limitless to your Home Screen">
        <p className="small" style={{ margin: 0, color: "var(--ink-2)" }}>
          On iPhone, notifications only work for apps on your Home Screen. Tap <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open Limitless from there and tap “Turn on”.
        </p>
      </Card>
    );
  }
  if (!pushSupported()) return null;

  const turnOn = async () => {
    setError(null);
    try {
      const s = await api.get<Settings>("/settings");
      await enablePush(s.push.publicKey);
      setState("on");
      toast("Notifications on");
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <Card className="accent-edge" eyebrow="Stay in the loop" title="Turn on notifications">
      <p className="small" style={{ margin: "0 0 12px", color: "var(--ink-2)" }}>
        Morning briefing, homework due soon, important emails, and things waiting for your approval.
      </p>
      <ErrorBox error={error} />
      <button className="btn primary block" onClick={turnOn} style={{ marginTop: error ? 10 : 0 }}>
        <Icon name="bell" size={18} /> Turn on
      </button>
      {isIos() && <p className="tiny muted" style={{ margin: "8px 0 0" }}>Requires iOS 16.4 or newer.</p>}
    </Card>
  );
}

function HomeworkRow({ h, onDone }: { h: Homework; onDone: (h: Homework) => void }) {
  const late = isOverdue(h.due_at, h.all_day);
  return (
    <div className="row" style={{ padding: "10px 0" }}>
      <input type="checkbox" className="check" aria-label={`Mark ${h.title} done`} onChange={() => onDone(h)} />
      <div className="row-main">
        <div className="row-title">{h.title}</div>
        <div className="row-sub">
          {h.course ? `${h.course} · ` : ""}
          <span style={late ? { color: "var(--bad)", fontWeight: 600 } : undefined}>{fmtDue(h.due_at, h.all_day)}</span>
        </div>
      </div>
    </div>
  );
}

function QuickWeigh({ units, onSaved }: { units: string; onSaved: () => void }) {
  const [value, setValue] = useState("");
  const save = async () => {
    const weight = Number(value);
    if (!weight) return;
    try {
      await api.post("/body/weights", { date: todayStr(), weight });
      setValue("");
      toast("Weigh-in saved");
      onSaved();
    } catch (err) {
      toast(errorMessage(err));
    }
  };
  return (
    <div className="kbd-add" style={{ marginTop: 12 }}>
      <input
        className="input"
        inputMode="decimal"
        placeholder={`Today's weight (${units})`}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && save()}
      />
      <button className="btn primary" onClick={save} disabled={!value}>
        Log
      </button>
    </div>
  );
}

export function TodayPage() {
  const { data, error, reload, setData } = useApi<Today>("/today");
  const counts = useApi<{ unread: number }>("/notifications").data;
  const [nnText, setNnText] = useState("");

  if (!data) return error ? <div className="page"><ErrorBox error={error} /></div> : <Spinner />;

  const hw = data.homework;
  const dueNow = [...hw.overdue, ...hw.dueToday];
  const todaysEvents = data.events.filter((e) => {
    const first = dateStr(new Date(e.start));
    const last = e.end ? dateStr(new Date(new Date(e.end).getTime() - 1)) : first;
    return first <= data.date && last >= data.date;
  });
  const nnDone = data.nonNegotiables.filter((n) => n.done).length;

  const toggleNN = async (id: number, done: boolean) => {
    setData({ ...data, nonNegotiables: data.nonNegotiables.map((n) => (n.id === id ? { ...n, done: done ? 1 : 0 } : n)) });
    await api.patch(`/journal/non-negotiables/${id}`, { done }).catch(() => reload());
  };

  const addNN = async () => {
    const text = nnText.trim();
    if (!text) return;
    setNnText("");
    await api.post("/journal/non-negotiables", { for_date: data.date, text });
    reload();
  };

  const completeHw = async (h: Homework) => {
    await api.patch(`/homework/${h.id}`, { status: "done" });
    toast(`Done: ${h.title}`);
    reload();
  };

  const b = data.body;
  const evening = data.hour >= 17;

  return (
    <>
      <header className="hero">
        <div className="hero-row">
          <div>
            <div className="eyebrow">{fmtLongDate(data.date)}</div>
            <h1>
              {greeting(data.hour)}
              {data.name ? `, ${data.name}` : ""}
            </h1>
          </div>
          <Link to="/notifications" className="icon-btn" aria-label="Notifications">
            <Icon name="bell" />
            {counts?.unread ? <span className="dot-badge">{counts.unread > 9 ? "9+" : counts.unread}</span> : null}
          </Link>
        </div>
        <div className="hero-stats">
          <div className="hero-stat">
            <div className="v">{dueNow.length}</div>
            <div className="l">{hw.overdue.length ? `due (${hw.overdue.length} late)` : "due today"}</div>
          </div>
          <div className="hero-stat">
            <div className="v">{todaysEvents.length}</div>
            <div className="l">{todaysEvents.length === 1 ? "event" : "events"}</div>
          </div>
          <div className="hero-stat">
            <div className="v">
              {data.journal.streak}
              <Icon name="flame" size={16} className="" />
            </div>
            <div className="l">day streak</div>
          </div>
        </div>
      </header>

      <div className="page">
        {data.pendingApprovals > 0 && (
          <Link to="/approvals" style={{ textDecoration: "none", color: "inherit" }}>
            <section className="card accent-edge" style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="row-main">
                <div className="eyebrow">Needs your OK</div>
                <h2 style={{ fontSize: 18 }}>
                  {data.pendingApprovals} {data.pendingApprovals === 1 ? "item" : "items"} waiting for approval
                </h2>
                <div className="small muted">Approve them to add to your calendar.</div>
              </div>
              <Icon name="chevR" />
            </section>
          </Link>
        )}

        <NotificationPrompt />

        <Card
          eyebrow="Non-negotiables"
          title={data.nonNegotiables.length ? `${nnDone} of ${data.nonNegotiables.length} done` : "Today's must-dos"}
          action={
            <Link className="link-btn" to="/journal">
              Journal <Icon name="chevR" size={16} />
            </Link>
          }
        >
          {data.nonNegotiables.length > 0 && <Progress value={nnDone / data.nonNegotiables.length} />}
          <div style={{ marginTop: 6 }}>
            {data.nonNegotiables.map((n) => (
              <label key={n.id} className="row" style={{ padding: "10px 0", cursor: "pointer" }}>
                <input type="checkbox" className="check" checked={!!n.done} onChange={(e) => toggleNN(n.id, e.target.checked)} />
                <span className={`row-title${n.done ? " done" : ""}`}>{n.text}</span>
              </label>
            ))}
          </div>
          {!data.nonNegotiables.length && (
            <p className="small muted" style={{ margin: "0 0 10px" }}>
              Set tomorrow's in tonight's journal, or add one for today:
            </p>
          )}
          <div className="kbd-add" style={{ marginTop: 6 }}>
            <input
              className="input"
              placeholder="Add a non-negotiable"
              value={nnText}
              onChange={(e) => setNnText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addNN()}
            />
            <button className="btn" onClick={addNN} aria-label="Add">
              <Icon name="plus" size={18} />
            </button>
          </div>
        </Card>

        <Card
          eyebrow="Schedule"
          title="Today"
          action={
            <Link className="link-btn" to="/calendar">
              Calendar <Icon name="chevR" size={16} />
            </Link>
          }
        >
          {todaysEvents.length === 0 ? (
            <p className="small muted" style={{ margin: 0 }}>Nothing on the calendar today.</p>
          ) : (
            todaysEvents.map((e) => (
              <div key={e.id} className="row" style={{ padding: "9px 0", minHeight: 0 }}>
                <div className="time-col">{e.all_day ? "All day" : fmtTime(e.start)}</div>
                <span className="event-bar" style={{ background: e.color ?? "var(--steel-2)" }} />
                <div className="row-main">
                  <div className="row-title">{e.title}</div>
                  {e.location && <div className="row-sub">{e.location}</div>}
                </div>
              </div>
            ))
          )}
        </Card>

        <Card
          eyebrow="Homework"
          title={dueNow.length ? `${dueNow.length} due today` : hw.dueTomorrow.length ? `${hw.dueTomorrow.length} due tomorrow` : "All caught up"}
          action={
            <Link className="link-btn" to="/homework">
              All <Icon name="chevR" size={16} />
            </Link>
          }
        >
          {[...dueNow, ...hw.dueTomorrow].slice(0, 6).map((h) => (
            <HomeworkRow key={h.id} h={h} onDone={completeHw} />
          ))}
          {!dueNow.length && !hw.dueTomorrow.length && (
            <p className="small muted" style={{ margin: 0 }}>
              {hw.openCount ? `${hw.openCount} open assignment${hw.openCount > 1 ? "s" : ""} later this week.` : "No open assignments. Nice."}
            </p>
          )}
        </Card>

        <Card
          eyebrow="Bulk"
          title={b.latest ? `${fmtNum(b.avg7 ?? b.latest.weight)} ${data.units}` : "Start tracking"}
          action={
            <Link className="link-btn" to="/body">
              Progress <Icon name="chevR" size={16} />
            </Link>
          }
        >
          {b.latest && (
            <div className="small" style={{ color: "var(--ink-2)" }}>
              7-day average · {b.weekChange !== null ? `${signed(b.weekChange)} ${data.units} this week` : "keep logging daily"}
              {b.goalWeight ? ` · ${fmtNum(b.goalWeight - (b.avg7 ?? b.latest.weight))} ${data.units} to goal` : ""}
            </div>
          )}
          {(b.calorieTarget || b.proteinTarget) && (
            <div className="grid-2" style={{ marginTop: 12 }}>
              {b.calorieTarget ? (
                <div>
                  <div className="tiny muted">Calories {fmtNum(b.calories ?? 0, 0)} / {fmtNum(b.calorieTarget, 0)}</div>
                  <Progress value={(b.calories ?? 0) / b.calorieTarget} />
                </div>
              ) : null}
              {b.proteinTarget ? (
                <div>
                  <div className="tiny muted">Protein {fmtNum(b.protein ?? 0, 0)}g / {fmtNum(b.proteinTarget, 0)}g</div>
                  <Progress value={(b.protein ?? 0) / b.proteinTarget} />
                </div>
              ) : null}
            </div>
          )}
          {!b.weighedInToday && <QuickWeigh units={data.units} onSaved={() => refreshAll()} />}
        </Card>

        {data.emails.unread > 0 && (
          <Card
            eyebrow="Important email"
            title={`${data.emails.unread} unread`}
            action={
              <Link className="link-btn" to="/inbox">
                Inbox <Icon name="chevR" size={16} />
              </Link>
            }
          >
            {data.emails.items.slice(0, 3).map((m) => (
              <Link key={m.id} to="/inbox" className="row" style={{ padding: "10px 0" }}>
                <Icon name="mail" size={20} />
                <div className="row-main">
                  <div className="row-title">{m.from_name || m.from_addr}</div>
                  <div className="row-sub">{m.summary || m.subject}</div>
                </div>
              </Link>
            ))}
          </Card>
        )}

        {data.goals.length > 0 && (
          <Card
            eyebrow="Goals"
            title="In progress"
            action={
              <Link className="link-btn" to="/goals">
                All <Icon name="chevR" size={16} />
              </Link>
            }
          >
            <div className="inline-list">
              {data.goals.map((g) => (
                <div key={g.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 5 }}>
                    <strong>{g.title}</strong>
                    <span className="muted">{Math.round(g.progress * 100)}%</span>
                  </div>
                  <Progress value={g.progress} />
                </div>
              ))}
            </div>
          </Card>
        )}

        <Card
          eyebrow="Reflect"
          title={data.journal.writtenToday ? "Journal written" : evening ? "How did today go?" : "Tonight's journal"}
        >
          <p className="small" style={{ margin: "0 0 12px", color: "var(--ink-2)" }}>
            {data.journal.writtenToday
              ? data.journal.tomorrowSet
                ? `Tomorrow's ${data.journal.tomorrowSet} non-negotiable${data.journal.tomorrowSet > 1 ? "s are" : " is"} set.`
                : "Add tomorrow's non-negotiables before bed."
              : "What went right, what went wrong, and the non-negotiables for tomorrow."}
          </p>
          <Link to="/journal" className={`btn block ${data.journal.writtenToday ? "" : "primary"}`}>
            <Icon name="journal" size={18} /> {data.journal.writtenToday ? "Open journal" : "Write today's entry"}
          </Link>
        </Card>
      </div>
    </>
  );
}
