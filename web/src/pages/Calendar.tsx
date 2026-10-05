import { useMemo, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { addDays, dateStr, fmtDay, fmtTime, parseDate, todayStr } from "../lib/dates";
import type { CalEvent, Homework } from "../lib/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Fab, Field, Segmented, Sheet, TopBar } from "../components/ui";

type Range = { events: CalEvent[]; homework: Pick<Homework, "id" | "title" | "course" | "due_at" | "all_day" | "status">[] };

type Item =
  | { kind: "event"; key: string; date: string; sort: string; ev: CalEvent }
  | { kind: "homework"; key: string; date: string; sort: string; hw: Range["homework"][number] };

/** Expands events across every local day they touch, plus homework on its due day. */
function itemsByDay(data: Range | null): Map<string, Item[]> {
  const map = new Map<string, Item[]>();
  const push = (date: string, item: Item) => {
    const list = map.get(date) ?? [];
    list.push(item);
    map.set(date, list);
  };
  for (const ev of data?.events ?? []) {
    const first = dateStr(new Date(ev.start));
    const last = ev.end ? dateStr(new Date(new Date(ev.end).getTime() - 1)) : first;
    let d = first;
    for (let i = 0; i < 60 && d <= last; i++, d = addDays(d, 1)) {
      push(d, { kind: "event", key: `e${ev.id}-${d}`, date: d, sort: ev.all_day || d !== first ? "0" : ev.start, ev });
    }
  }
  for (const hw of data?.homework ?? []) {
    if (!hw.due_at) continue;
    const d = dateStr(new Date(hw.due_at));
    push(d, { kind: "homework", key: `h${hw.id}`, date: d, sort: hw.all_day ? "1" : hw.due_at, hw });
  }
  for (const list of map.values()) list.sort((a, b) => a.sort.localeCompare(b.sort));
  return map;
}

function monthGrid(month: string): string[] {
  const first = parseDate(`${month}-01`);
  const start = addDays(dateStr(first), -first.getDay());
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

function ItemRow({ item, onOpen }: { item: Item; onOpen: (ev: CalEvent) => void }) {
  if (item.kind === "homework") {
    const h = item.hw;
    return (
      <Link to="/homework" className="row">
        <div className="time-col">{h.all_day || !h.due_at ? "Due" : fmtTime(h.due_at)}</div>
        <span className="event-bar" style={{ background: "var(--silver)" }} />
        <div className="row-main">
          <div className={`row-title${h.status === "done" ? " done" : ""}`}>{h.title}</div>
          <div className="row-sub">
            <Icon name="book" size={13} /> Homework{h.course ? ` · ${h.course}` : ""}
          </div>
        </div>
      </Link>
    );
  }
  const e = item.ev;
  const multiDayContinuation = !e.all_day && dateStr(new Date(e.start)) !== item.date;
  return (
    <button className="row" onClick={() => onOpen(e)} style={{ cursor: "pointer" }}>
      <div className="time-col">{e.all_day || multiDayContinuation ? "All day" : fmtTime(e.start)}</div>
      <span className="event-bar" style={{ background: e.color ?? "var(--steel-2)" }} />
      <div className="row-main">
        <div className="row-title">{e.title}</div>
        <div className="row-sub">
          {[e.end && !e.all_day ? `until ${fmtTime(e.end)}` : null, e.location, e.feed_name].filter(Boolean).join(" · ") || "Your event"}
        </div>
      </div>
    </button>
  );
}

export function EventSheet({ initialDate, event, onClose }: { initialDate: string; event?: CalEvent; onClose: () => void }) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [date, setDate] = useState(event ? dateStr(new Date(event.start)) : initialDate);
  const [start, setStart] = useState(event && !event.all_day ? new Date(event.start).toTimeString().slice(0, 5) : "");
  const [end, setEnd] = useState(event?.end && !event.all_day ? new Date(event.end).toTimeString().slice(0, 5) : "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const readOnly = event?.source === "feed";

  const save = async (e: FormEvent) => {
    e.preventDefault();
    try {
      const body = { title, date, start_time: start || null, end_time: end || null, location, description };
      if (event) await api.patch(`/calendar/events/${event.id}`, body);
      else await api.post("/calendar/events", body);
      toast(event ? "Event updated" : "Added to calendar");
      refreshAll();
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const remove = async () => {
    if (!event || !confirm("Delete this event?")) return;
    await api.del(`/calendar/events/${event.id}`);
    refreshAll();
    onClose();
  };

  if (readOnly && event) {
    return (
      <Sheet title={event.title} onClose={onClose}>
        <div className="form">
          <div className="notice">
            <strong>{fmtDay(dateStr(new Date(event.start)), { long: true })}</strong>
            {event.all_day ? " · All day" : ` · ${fmtTime(event.start)}${event.end ? ` – ${fmtTime(event.end)}` : ""}`}
            {event.location && <div>{event.location}</div>}
          </div>
          {event.description && <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{event.description}</p>}
          <p className="small muted" style={{ margin: 0 }}>From your linked calendar “{event.feed_name}”. Edit it there.</p>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet title={event ? "Edit event" : "New event"} onClose={onClose}>
      <form className="form" onSubmit={save}>
        <Field label="What">
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Practice, dentist, study group…" autoFocus={!event} />
        </Field>
        <Field label="Date">
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <div className="grid-2">
          <Field label="Starts" hint="blank = all day">
            <input className="input" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="Ends">
            <input className="input" type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!start} />
          </Field>
        </div>
        <Field label="Where">
          <input className="input" value={location} onChange={(e) => setLocation(e.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input" value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={!title || !date}>
          {event ? "Save" : "Add to calendar"}
        </button>
        {event && (
          <button type="button" className="btn danger block" onClick={remove}>
            <Icon name="trash" size={18} /> Delete
          </button>
        )}
      </form>
    </Sheet>
  );
}

export function CalendarPage() {
  const today = todayStr();
  const [view, setView] = useState<"month" | "agenda">("month");
  const [month, setMonth] = useState(today.slice(0, 7));
  const [selected, setSelected] = useState(today);
  const [sheet, setSheet] = useState<{ event?: CalEvent } | null>(null);
  const counts = useApi<{ pendingApprovals: number }>("/notifications").data;

  const grid = useMemo(() => monthGrid(month), [month]);
  const from = view === "month" ? grid[0] : today;
  const to = view === "month" ? addDays(grid[41], 1) : addDays(today, 45);
  const { data, error } = useApi<Range>(
    `/calendar/events?from=${encodeURIComponent(parseDate(from).toISOString())}&to=${encodeURIComponent(parseDate(to).toISOString())}`,
  );
  const byDay = useMemo(() => itemsByDay(data), [data]);

  const shiftMonth = (n: number) => {
    const d = parseDate(`${month}-01`);
    d.setMonth(d.getMonth() + n);
    setMonth(dateStr(d).slice(0, 7));
  };

  const agendaDays = [...byDay.keys()].filter((d) => d >= today).sort();
  const pending = counts?.pendingApprovals ?? 0;

  return (
    <>
      <TopBar
        title="Calendar"
        right={
          <Link to="/approvals" className="icon-btn" aria-label="Approvals">
            <Icon name="approve" />
            {pending ? <span className="dot-badge">{pending > 9 ? "9+" : pending}</span> : null}
          </Link>
        }
      />
      <div className="page">
        {pending > 0 && (
          <Link to="/approvals" className="card accent-edge" style={{ textDecoration: "none", color: "inherit", display: "flex", alignItems: "center", gap: 10 }}>
            <div className="row-main">
              <strong>{pending} waiting for your approval</strong>
              <div className="small muted">Nothing is added to your calendar until you say so.</div>
            </div>
            <Icon name="chevR" />
          </Link>
        )}

        <Segmented
          value={view}
          onChange={setView}
          options={[
            { value: "month", label: "Month" },
            { value: "agenda", label: "Upcoming" },
          ]}
        />
        <ErrorBox error={error} />

        {view === "month" ? (
          <>
            <section className="card">
              <div className="card-head">
                <button className="icon-btn" aria-label="Previous month" onClick={() => shiftMonth(-1)}>
                  <Icon name="chevL" />
                </button>
                <h2>{parseDate(`${month}-01`).toLocaleDateString([], { month: "long", year: "numeric" })}</h2>
                <button className="icon-btn" aria-label="Next month" onClick={() => shiftMonth(1)}>
                  <Icon name="chevR" />
                </button>
              </div>
              <div className="month">
                {["S", "M", "T", "W", "T", "F", "S"].map((d, i) => (
                  <div key={i} className="dow">
                    {d}
                  </div>
                ))}
                {grid.map((d) => {
                  const n = byDay.get(d)?.length ?? 0;
                  const cls = [d.slice(0, 7) !== month && "other", d === today && "today", d === selected && "sel"].filter(Boolean).join(" ");
                  return (
                    <button key={d} className={cls} onClick={() => setSelected(d)} aria-label={`${d}, ${n} items`}>
                      {Number(d.slice(8))}
                      <span className="dots">
                        {Array.from({ length: Math.min(n, 3) }, (_, i) => (
                          <i key={i} />
                        ))}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
            <div className="section-title">
              <h2>{fmtDay(selected, { long: true })}</h2>
              <button className="link-btn" onClick={() => setSheet({})}>
                <Icon name="plus" size={16} /> Add
              </button>
            </div>
            <section className="card flush">
              {(byDay.get(selected) ?? []).length ? (
                <div className="list">
                  {byDay.get(selected)!.map((item) => (
                    <ItemRow key={item.key} item={item} onOpen={(event) => setSheet({ event })} />
                  ))}
                </div>
              ) : (
                <Empty icon="calendar" title="Free day">
                  Nothing scheduled.
                </Empty>
              )}
            </section>
          </>
        ) : (
          <section className="card flush">
            {agendaDays.length ? (
              agendaDays.map((d) => (
                <div key={d}>
                  <div className={`day-head${d === today ? " today" : ""}`}>{fmtDay(d, { long: true })}</div>
                  {byDay.get(d)!.map((item) => (
                    <ItemRow key={item.key} item={item} onOpen={(event) => setSheet({ event })} />
                  ))}
                </div>
              ))
            ) : (
              <Empty icon="calendar" title="Nothing coming up">
                Link your Google or Apple calendar in Settings, or add an event.
              </Empty>
            )}
          </section>
        )}
      </div>
      <Fab label="Add event" onClick={() => setSheet({})} />
      {sheet && <EventSheet initialDate={selected} event={sheet.event} onClose={() => setSheet(null)} />}
    </>
  );
}
