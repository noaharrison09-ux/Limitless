import { useMemo, useState, type FormEvent } from "react";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { addDays, fmtDay, todayStr } from "../lib/dates";
import type { BulkSettings } from "../lib/types";
import { Icon } from "../components/Icon";
import { LineChart } from "../components/LineChart";
import { Card, Empty, ErrorBox, Field, Progress, Segmented, Sheet, Spinner, TopBar, fmtNum, signed } from "../components/ui";

type Summary = {
  units: string;
  bulk: BulkSettings;
  weight: {
    latest: { date: string; weight: number } | null;
    avg7: number | null;
    weekChange: number | null;
    ratePerWeek: number | null;
    totalGain: number | null;
    toGoal: number | null;
    eta: string | null;
    pace: "on-track" | "slow" | "fast" | "losing" | null;
    trend: { date: string; avg: number }[];
  };
  nutrition: { today: { calories: number | null; protein: number | null } | null; avgCalories7: number | null; avgProtein7: number | null; daysLogged7: number };
  prs: { exercise: string; e1rm: number; weight: number; reps: number; date: string; sessions: number }[];
  weighedInToday: boolean;
};

type WeightRow = { id: number; date: string; weight: number; note: string | null };
type FoodRow = { id: number; date: string; calories: number | null; protein: number | null; note: string | null };
type LiftRow = { id: number; date: string; exercise: string; weight: number; reps: number; sets: number | null };
type MeasureRow = { id: number; date: string; name: string; value: number };

const PACE: Record<string, { label: string; cls: string; tip: string }> = {
  "on-track": { label: "On pace", cls: "good", tip: "Right in the lean-bulk zone." },
  slow: { label: "Slow", cls: "warn", tip: "Add ~200 calories a day." },
  fast: { label: "Fast", cls: "warn", tip: "Gaining quickly — trim ~200 calories to keep it lean." },
  losing: { label: "Losing", cls: "bad", tip: "You're trending down — eat more." },
};

function WeightTab({ s, reload }: { s: Summary; reload: () => void }) {
  const [range, setRange] = useState<"30" | "90" | "180" | "all">("90");
  const rows = useApi<WeightRow[]>("/body/weights");
  const [value, setValue] = useState("");
  const [date, setDate] = useState(todayStr());
  const [showAll, setShowAll] = useState(false);

  const since = range === "all" ? "0000" : addDays(todayStr(), -Number(range));
  const points = useMemo(
    () => (rows.data ?? []).filter((r) => r.date >= since).map((r) => ({ date: r.date, value: r.weight })).reverse(),
    [rows.data, since],
  );
  const line = s.weight.trend.filter((t) => t.date >= since).map((t) => ({ date: t.date, value: t.avg }));

  const log = async (e: FormEvent) => {
    e.preventDefault();
    if (!Number(value)) return;
    await api.post("/body/weights", { date, weight: Number(value) });
    setValue("");
    toast("Weight logged");
    rows.reload();
    reload();
    refreshAll();
  };

  const remove = async (id: number) => {
    if (!confirm("Delete this weigh-in?")) return;
    await api.del(`/body/weights/${id}`);
    rows.reload();
    reload();
  };

  const w = s.weight;
  const pace = w.pace ? PACE[w.pace] : null;
  const progress =
    s.bulk.goalWeight && w.avg7 && (s.bulk.startWeight ?? w.trend[0]?.avg)
      ? (w.avg7 - (s.bulk.startWeight ?? w.trend[0].avg)) / (s.bulk.goalWeight - (s.bulk.startWeight ?? w.trend[0].avg))
      : null;

  return (
    <>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">7-day average</div>
          <div className="value">{fmtNum(w.avg7)}</div>
          <div className="delta">{s.units}</div>
        </div>
        <div className="stat">
          <div className="label">This week</div>
          <div className="value">{signed(w.weekChange)}</div>
          <div className="delta">vs last week</div>
        </div>
        <div className="stat">
          <div className="label">Rate</div>
          <div className="value">{signed(w.ratePerWeek, 2)}</div>
          <div className="delta">
            {s.units}/week {pace && <span className={`chip ${pace.cls}`}>{pace.label}</span>}
          </div>
        </div>
      </div>

      {s.bulk.goalWeight ? (
        <Card eyebrow="Goal" title={`${fmtNum(s.bulk.goalWeight)} ${s.units}`}>
          {progress !== null && <Progress value={progress} />}
          <div className="small" style={{ marginTop: 8, color: "var(--ink-2)" }}>
            {w.toGoal !== null && w.toGoal > 0 ? `${fmtNum(w.toGoal)} ${s.units} to go` : w.toGoal !== null ? "Goal reached 🎉" : ""}
            {w.totalGain !== null ? ` · ${signed(w.totalGain)} ${s.units} so far` : ""}
            {w.eta ? ` · on pace for ${new Date(`${w.eta}T12:00:00`).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}` : ""}
          </div>
          {pace && <div className="tiny muted" style={{ marginTop: 4 }}>{pace.tip}</div>}
        </Card>
      ) : null}

      <Card
        title="Weight trend"
        action={
          <Segmented
            value={range}
            onChange={setRange}
            options={[
              { value: "30", label: "1M" },
              { value: "90", label: "3M" },
              { value: "180", label: "6M" },
              { value: "all", label: "All" },
            ]}
          />
        }
      >
        {line.length ? (
          <LineChart points={points} line={line} lineLabel="7-day average" pointsLabel="Weigh-in" goal={s.bulk.goalWeight} unit={s.units} />
        ) : (
          <Empty icon="scale" title="No weigh-ins yet">
            Weigh in each morning; the 7-day average smooths out water weight.
          </Empty>
        )}
      </Card>

      <Card title="Log weight">
        <form className="kbd-add" onSubmit={log}>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} style={{ maxWidth: 160 }} />
          <input className="input" inputMode="decimal" placeholder={s.units} value={value} onChange={(e) => setValue(e.target.value)} />
          <button className="btn primary" disabled={!value}>
            Log
          </button>
        </form>
      </Card>

      {rows.data && rows.data.length > 0 && (
        <section className="card flush">
          {rows.data.slice(0, showAll ? 365 : 10).map((r, i) => {
            const prev = rows.data![i + 1];
            return (
              <div key={r.id} className="row" style={{ minHeight: 48 }}>
                <div className="row-main">
                  <div className="row-title">{fmtDay(r.date)}</div>
                </div>
                <strong style={{ fontVariantNumeric: "tabular-nums" }}>
                  {fmtNum(r.weight)} {s.units}
                </strong>
                <span className="tiny muted" style={{ width: 44, textAlign: "right" }}>{prev ? signed(r.weight - prev.weight) : ""}</span>
                <button className="icon-btn" style={{ width: 34, height: 34 }} aria-label="Delete" onClick={() => remove(r.id)}>
                  <Icon name="trash" size={16} />
                </button>
              </div>
            );
          })}
          {rows.data.length > 10 && (
            <button className="row link-btn" style={{ justifyContent: "center" }} onClick={() => setShowAll(!showAll)}>
              {showAll ? "Show less" : `Show all ${rows.data.length} weigh-ins`}
            </button>
          )}
        </section>
      )}
    </>
  );
}

function FoodTab({ s, reload }: { s: Summary; reload: () => void }) {
  const rows = useApi<FoodRow[]>("/body/nutrition");
  const today = rows.data?.find((r) => r.date === todayStr());
  const [calories, setCalories] = useState("");
  const [protein, setProtein] = useState("");

  const save = async (add: boolean) => {
    const c = Number(calories) || 0;
    const p = Number(protein) || 0;
    await api.post("/body/nutrition", {
      date: todayStr(),
      calories: add ? (today?.calories ?? 0) + c : c,
      protein: add ? (today?.protein ?? 0) + p : p,
    });
    setCalories("");
    setProtein("");
    toast(add ? "Added to today" : "Saved");
    rows.reload();
    reload();
    refreshAll();
  };

  return (
    <>
      <Card eyebrow="Today" title="Fuel the bulk">
        <div className="grid-2">
          <div>
            <div className="small muted">Calories</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 600 }}>
              {fmtNum(today?.calories ?? 0, 0)}
              {s.bulk.calorieTarget ? <span className="small muted"> / {fmtNum(s.bulk.calorieTarget, 0)}</span> : null}
            </div>
            {s.bulk.calorieTarget ? <Progress value={(today?.calories ?? 0) / s.bulk.calorieTarget} /> : null}
          </div>
          <div>
            <div className="small muted">Protein</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 26, fontWeight: 600 }}>
              {fmtNum(today?.protein ?? 0, 0)}g
              {s.bulk.proteinTarget ? <span className="small muted"> / {fmtNum(s.bulk.proteinTarget, 0)}g</span> : null}
            </div>
            {s.bulk.proteinTarget ? <Progress value={(today?.protein ?? 0) / s.bulk.proteinTarget} /> : null}
          </div>
        </div>
        <div className="grid-2" style={{ marginTop: 14 }}>
          <input className="input" inputMode="numeric" placeholder="+ calories" value={calories} onChange={(e) => setCalories(e.target.value)} />
          <input className="input" inputMode="numeric" placeholder="+ protein (g)" value={protein} onChange={(e) => setProtein(e.target.value)} />
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn primary" disabled={!calories && !protein} onClick={() => save(true)}>
            Add meal
          </button>
          <button className="btn" disabled={!calories && !protein} onClick={() => save(false)}>
            Set total
          </button>
        </div>
      </Card>
      <div className="stat-grid">
        <div className="stat">
          <div className="label">Avg calories (7d)</div>
          <div className="value">{fmtNum(s.nutrition.avgCalories7, 0)}</div>
        </div>
        <div className="stat">
          <div className="label">Avg protein (7d)</div>
          <div className="value">{s.nutrition.avgProtein7 !== null ? `${s.nutrition.avgProtein7}g` : "—"}</div>
        </div>
        <div className="stat">
          <div className="label">Days logged</div>
          <div className="value">{s.nutrition.daysLogged7}/7</div>
        </div>
      </div>
      {rows.data && rows.data.length > 0 && (
        <section className="card flush">
          {rows.data.slice(0, 14).map((r) => (
            <div key={r.id} className="row" style={{ minHeight: 48 }}>
              <div className="row-main row-title">{fmtDay(r.date)}</div>
              <span className="small">{fmtNum(r.calories ?? 0, 0)} cal</span>
              <span className="small muted" style={{ width: 56, textAlign: "right" }}>{fmtNum(r.protein ?? 0, 0)}g</span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function LiftsTab({ s, reload }: { s: Summary; reload: () => void }) {
  const [selected, setSelected] = useState<string | null>(s.prs[0]?.exercise ?? null);
  const history = useApi<{ date: string; value: number }[]>(selected ? `/body/lift-history?exercise=${encodeURIComponent(selected)}` : null);
  const [form, setForm] = useState({ exercise: s.prs[0]?.exercise ?? "", weight: "", reps: "", sets: "" });
  const [error, setError] = useState<string | null>(null);

  const log = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/body/lifts", { date: todayStr(), exercise: form.exercise, weight: Number(form.weight), reps: Number(form.reps), sets: Number(form.sets) || null });
      toast("Set logged");
      setSelected(form.exercise);
      setForm({ ...form, weight: "", reps: "", sets: "" });
      reload();
      history.reload();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <Card title="Log a lift">
        <form className="form" onSubmit={log}>
          <input className="input" list="exercises" placeholder="Exercise (e.g. Bench press)" value={form.exercise} onChange={(e) => setForm({ ...form, exercise: e.target.value })} />
          <datalist id="exercises">
            {[...new Set([...s.prs.map((p) => p.exercise), "Bench press", "Squat", "Deadlift", "Overhead press", "Barbell row", "Pull-up"])].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <div className="grid-3">
            <input className="input" inputMode="decimal" placeholder={s.units} value={form.weight} onChange={(e) => setForm({ ...form, weight: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder="reps" value={form.reps} onChange={(e) => setForm({ ...form, reps: e.target.value })} />
            <input className="input" inputMode="numeric" placeholder="sets" value={form.sets} onChange={(e) => setForm({ ...form, sets: e.target.value })} />
          </div>
          <ErrorBox error={error} />
          <button className="btn primary block" disabled={!form.exercise || !form.weight || !form.reps}>
            Log set
          </button>
        </form>
      </Card>
      {s.prs.length > 0 ? (
        <>
          <section className="card flush">
            {s.prs.map((p) => (
              <button key={p.exercise} className="row" onClick={() => setSelected(p.exercise)} style={{ cursor: "pointer", background: selected === p.exercise ? "var(--oak-wash)" : undefined }}>
                <div className="row-main">
                  <div className="row-title">{p.exercise}</div>
                  <div className="row-sub">
                    Best: {fmtNum(p.weight)} × {p.reps} · {fmtDay(p.date)}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <strong>{fmtNum(p.e1rm)}</strong>
                  <div className="tiny muted">est. 1RM</div>
                </div>
              </button>
            ))}
          </section>
          {selected && history.data && history.data.length > 0 && (
            <Card title={`${selected} — estimated 1RM`}>
              <LineChart line={history.data} lineLabel="Est. 1RM" unit={s.units} height={170} />
            </Card>
          )}
        </>
      ) : (
        <Card>
          <Empty icon="dumbbell" title="No lifts yet">
            Log your main lifts to watch strength climb with the bulk.
          </Empty>
        </Card>
      )}
    </>
  );
}

function MeasureTab() {
  const rows = useApi<MeasureRow[]>("/body/measurements");
  const [name, setName] = useState("");
  const [value, setValue] = useState("");

  const add = async (e: FormEvent) => {
    e.preventDefault();
    await api.post("/body/measurements", { date: todayStr(), name, value: Number(value) });
    setValue("");
    toast("Saved");
    rows.reload();
  };

  const latest = new Map<string, MeasureRow[]>();
  for (const r of rows.data ?? []) latest.set(r.name, [...(latest.get(r.name) ?? []), r]);

  return (
    <>
      <Card title="Add a measurement" eyebrow="Tape measure">
        <form className="kbd-add" onSubmit={add}>
          <input className="input" list="measures" placeholder="Arms, chest, waist…" value={name} onChange={(e) => setName(e.target.value)} />
          <datalist id="measures">
            {["Arms", "Chest", "Waist", "Thighs", "Shoulders", "Neck", "Calves", "Body fat %"].map((x) => (
              <option key={x} value={x} />
            ))}
          </datalist>
          <input className="input" inputMode="decimal" placeholder="in" value={value} onChange={(e) => setValue(e.target.value)} style={{ maxWidth: 90 }} />
          <button className="btn primary" disabled={!name || !value}>
            Add
          </button>
        </form>
      </Card>
      {latest.size > 0 ? (
        <section className="card flush">
          {[...latest.entries()].map(([n, list]) => {
            const [cur, ...rest] = list;
            const first = rest.at(-1);
            return (
              <div key={n} className="row">
                <div className="row-main">
                  <div className="row-title">{n}</div>
                  <div className="row-sub">{fmtDay(cur.date)}</div>
                </div>
                <strong>{fmtNum(cur.value)}</strong>
                <span className="tiny muted" style={{ width: 60, textAlign: "right" }}>{first ? `${signed(cur.value - first.value)} total` : ""}</span>
              </div>
            );
          })}
        </section>
      ) : (
        <Card>
          <Empty icon="target" title="No measurements yet">
            Measuring every couple of weeks shows where the size is going.
          </Empty>
        </Card>
      )}
    </>
  );
}

function BulkSettingsSheet({ s, onClose, onSaved }: { s: Summary; onClose: () => void; onSaved: () => void }) {
  const [v, setV] = useState({
    goalWeight: s.bulk.goalWeight?.toString() ?? "",
    startWeight: s.bulk.startWeight?.toString() ?? "",
    targetRate: s.bulk.targetRate?.toString() ?? "0.5",
    calorieTarget: s.bulk.calorieTarget?.toString() ?? "",
    proteinTarget: s.bulk.proteinTarget?.toString() ?? "",
  });
  const save = async (e: FormEvent) => {
    e.preventDefault();
    await api.put("/body/settings", v);
    toast("Bulk targets saved");
    onSaved();
    onClose();
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });
  return (
    <Sheet title="Bulk targets" onClose={onClose}>
      <form className="form" onSubmit={save}>
        <div className="grid-2">
          <Field label="Goal weight">
            <input className="input" inputMode="decimal" value={v.goalWeight} onChange={set("goalWeight")} placeholder={s.units} />
          </Field>
          <Field label="Start weight">
            <input className="input" inputMode="decimal" value={v.startWeight} onChange={set("startWeight")} placeholder="first weigh-in" />
          </Field>
        </div>
        <Field label="Target gain per week" hint={`${s.units}; 0.25–0.5 is a lean bulk`}>
          <input className="input" inputMode="decimal" value={v.targetRate} onChange={set("targetRate")} />
        </Field>
        <div className="grid-2">
          <Field label="Daily calories">
            <input className="input" inputMode="numeric" value={v.calorieTarget} onChange={set("calorieTarget")} />
          </Field>
          <Field label="Daily protein (g)">
            <input className="input" inputMode="numeric" value={v.proteinTarget} onChange={set("proteinTarget")} />
          </Field>
        </div>
        <button className="btn primary block">Save targets</button>
      </form>
    </Sheet>
  );
}

export function BodyPage() {
  const { data, error, reload } = useApi<Summary>("/body/summary");
  const [tab, setTab] = useState<"weight" | "food" | "lifts" | "measure">("weight");
  const [editing, setEditing] = useState(false);

  return (
    <>
      <TopBar
        title="Body & bulk"
        back
        right={
          <button className="icon-btn" aria-label="Bulk targets" onClick={() => setEditing(true)}>
            <Icon name="target" />
          </button>
        }
      />
      <div className="page">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: "weight", label: "Weight" },
            { value: "food", label: "Food" },
            { value: "lifts", label: "Lifts" },
            { value: "measure", label: "Measure" },
          ]}
        />
        <ErrorBox error={error} />
        {!data ? (
          <Spinner />
        ) : tab === "weight" ? (
          <WeightTab s={data} reload={reload} />
        ) : tab === "food" ? (
          <FoodTab s={data} reload={reload} />
        ) : tab === "lifts" ? (
          <LiftsTab s={data} reload={reload} />
        ) : (
          <MeasureTab />
        )}
      </div>
      {editing && data && <BulkSettingsSheet s={data} onClose={() => setEditing(false)} onSaved={reload} />}
    </>
  );
}
