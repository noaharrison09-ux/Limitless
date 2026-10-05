import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { addDays, fmtDay, fmtLongDate, todayStr } from "../lib/dates";
import type { NonNegotiable } from "../lib/types";
import { Icon } from "../components/Icon";
import { Card, ErrorBox, Spinner, TopBar } from "../components/ui";

type Entry = { id: number; date: string; went_right: string | null; went_wrong: string | null; notes: string | null; mood: number | null };
type Day = { date: string; entry: Entry | null; today: NonNegotiable[]; tomorrow: NonNegotiable[] };
type History = {
  streak: number;
  entries: (Entry & { nonNegotiables: { total: number; done: number } | null })[];
};

const MOODS = ["😣", "😕", "😐", "🙂", "😄"];

function JournalEditor({ day, onSaved }: { day: Day; onSaved: (d: Day) => void }) {
  const [right, setRight] = useState(day.entry?.went_right ?? "");
  const [wrong, setWrong] = useState(day.entry?.went_wrong ?? "");
  const [notes, setNotes] = useState(day.entry?.notes ?? "");
  const [mood, setMood] = useState<number | null>(day.entry?.mood ?? null);
  const [tomorrow, setTomorrow] = useState<string[]>(day.tomorrow.length ? day.tomorrow.map((n) => n.text) : ["", "", ""]);
  const [todayList, setTodayList] = useState(day.today);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const saved = await api.put<Day>(`/journal/day/${day.date}`, {
        went_right: right,
        went_wrong: wrong,
        notes,
        mood,
        tomorrow: tomorrow.filter((t) => t.trim()),
      });
      onSaved(saved);
      toast("Journal saved");
      refreshAll();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (n: NonNegotiable) => {
    setTodayList(todayList.map((x) => (x.id === n.id ? { ...x, done: x.done ? 0 : 1 } : x)));
    await api.patch(`/journal/non-negotiables/${n.id}`, { done: !n.done });
  };

  const setLine = (i: number, v: string) => setTomorrow(tomorrow.map((t, j) => (j === i ? v : t)));

  return (
    <>
      {todayList.length > 0 && (
        <Card eyebrow="Did you hold the line?" title={`${fmtDay(day.date)}'s non-negotiables`}>
          {todayList.map((n) => (
            <label key={n.id} className="row" style={{ padding: "9px 0", cursor: "pointer" }}>
              <input type="checkbox" className="check" checked={!!n.done} onChange={() => toggle(n)} />
              <span className={`row-title${n.done ? " done" : ""}`}>{n.text}</span>
            </label>
          ))}
        </Card>
      )}

      <Card>
        <div className="form">
          <div>
            <div className="journal-q" style={{ marginBottom: 8 }}>How was the day?</div>
            <div className="mood-row">
              {MOODS.map((m, i) => (
                <button key={m} className={mood === i + 1 ? "on" : ""} onClick={() => setMood(mood === i + 1 ? null : i + 1)} aria-label={`Mood ${i + 1} of 5`}>
                  {m}
                </button>
              ))}
            </div>
          </div>
          <label className="field">
            <span className="journal-q" style={{ color: "var(--good)" }}>
              <Icon name="thumbUp" size={18} /> What went right
            </span>
            <textarea className="input" value={right} onChange={(e) => setRight(e.target.value)} placeholder="Wins, big or small…" rows={4} />
          </label>
          <label className="field">
            <span className="journal-q" style={{ color: "var(--bad)" }}>
              <Icon name="thumbDown" size={18} /> What went wrong
            </span>
            <textarea className="input" value={wrong} onChange={(e) => setWrong(e.target.value)} placeholder="What would you do differently?" rows={4} />
          </label>
        </div>
      </Card>

      <Card eyebrow={`For ${fmtDay(addDays(day.date, 1)).toLowerCase()}`} title="Non-negotiables" className="wood-edge">
        <p className="small muted" style={{ margin: "-4px 0 10px" }}>
          The things that happen no matter what. You'll see them in tomorrow's morning briefing.
        </p>
        <div className="inline-list">
          {tomorrow.map((t, i) => (
            <div key={i} className="kbd-add">
              <input className="input" value={t} onChange={(e) => setLine(i, e.target.value)} placeholder={["Gym", "Read 20 pages", "Finish the essay"][i] ?? "Another one"} />
              <button className="icon-btn" style={{ height: 46, width: 46 }} aria-label="Remove" onClick={() => setTomorrow(tomorrow.filter((_, j) => j !== i))}>
                <Icon name="x" size={18} />
              </button>
            </div>
          ))}
        </div>
        <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setTomorrow([...tomorrow, ""])}>
          <Icon name="plus" size={16} /> Add another
        </button>
      </Card>

      <Card title="Anything else">
        <textarea className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Thoughts, gratitude, lessons…" rows={3} />
      </Card>

      <ErrorBox error={error} />
      <button className="btn primary block" onClick={save} disabled={busy}>
        <Icon name="check" size={18} /> {busy ? "Saving…" : day.entry ? "Update entry" : "Save entry"}
      </button>
    </>
  );
}

export function JournalPage() {
  const params = useParams();
  const navigate = useNavigate();
  const date = params.date ?? todayStr();
  const { data, error, setData } = useApi<Day>(`/journal/day/${date}`);
  const history = useApi<History>("/journal?limit=30").data;
  const [key, setKey] = useState(0);

  useEffect(() => setKey((k) => k + 1), [data?.date]);

  const go = (d: string) => navigate(d === todayStr() ? "/journal" : `/journal/${d}`);

  return (
    <>
      <TopBar
        title="Journal"
        right={
          history?.streak ? (
            <span className="chip wood">
              <Icon name="flame" size={14} /> {history.streak}
            </span>
          ) : undefined
        }
      />
      <div className="page">
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="icon-btn" aria-label="Previous day" onClick={() => go(addDays(date, -1))}>
            <Icon name="chevL" />
          </button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div className="eyebrow">{fmtDay(date)}</div>
            <h2 style={{ fontSize: 19 }}>{fmtLongDate(date)}</h2>
          </div>
          <button className="icon-btn" aria-label="Next day" onClick={() => go(addDays(date, 1))} disabled={date >= todayStr()} style={date >= todayStr() ? { opacity: 0.4 } : undefined}>
            <Icon name="chevR" />
          </button>
        </div>

        <ErrorBox error={error} />
        {!data || data.date !== date ? <Spinner /> : <JournalEditor key={`${date}-${key}`} day={data} onSaved={setData} />}

        {history && history.entries.length > 0 && (
          <>
            <div className="section-title">
              <h2>Past entries</h2>
            </div>
            <section className="card flush">
              {history.entries
                .filter((e) => e.date !== date)
                .slice(0, 14)
                .map((e) => (
                  <Link key={e.id} to={`/journal/${e.date}`} className="row">
                    <div style={{ fontSize: 22, width: 28, textAlign: "center" }}>{e.mood ? MOODS[e.mood - 1] : "📓"}</div>
                    <div className="row-main">
                      <div className="row-title">{fmtDay(e.date, { long: true })}</div>
                      <div className="row-sub" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {e.went_right || e.went_wrong || e.notes || "—"}
                      </div>
                    </div>
                    {e.nonNegotiables && (
                      <span className={`chip ${e.nonNegotiables.done === e.nonNegotiables.total ? "good" : ""}`}>
                        {e.nonNegotiables.done}/{e.nonNegotiables.total}
                      </span>
                    )}
                  </Link>
                ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}
