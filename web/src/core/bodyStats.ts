import { DateTime } from "luxon";

export type WeightPoint = { date: string; weight: number };

export type WeightStats = {
  latest: WeightPoint | null;
  /** Mean of weigh-ins in the last 7 days (smooths water-weight noise). */
  avg7: number | null;
  /** Change of the 7-day average vs the previous 7 days. */
  weekChange: number | null;
  /** Least-squares trend over the last 28 days, in units per week. */
  ratePerWeek: number | null;
  /** Gain since the start weight (or first weigh-in), using the 7-day average. */
  totalGain: number | null;
  toGoal: number | null;
  /** Projected date to reach the goal at the current rate. */
  eta: string | null;
  pace: "on-track" | "slow" | "fast" | "losing" | null;
  /** Trailing 7-day average for every weigh-in date, for the chart. */
  trend: { date: string; avg: number }[];
};

function daysBetween(a: string, b: string): number {
  return DateTime.fromISO(b).diff(DateTime.fromISO(a), "days").days;
}

function mean(xs: number[]): number | null {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
}

function inWindow(points: WeightPoint[], from: string, to: string): number[] {
  return points.filter((p) => p.date >= from && p.date <= to).map((p) => p.weight);
}

function round(n: number | null, places = 2): number | null {
  if (n === null) return null;
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export function weightStats(
  points: WeightPoint[],
  today: string,
  opts: { goalWeight?: number | null; startWeight?: number | null; targetRate?: number | null },
): WeightStats {
  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const shift = (d: string, n: number) => DateTime.fromISO(d).plus({ days: n }).toISODate()!;

  const trend = sorted.map((p) => ({
    date: p.date,
    avg: round(mean(inWindow(sorted, shift(p.date, -6), p.date))!)!,
  }));

  const latest = sorted.at(-1) ?? null;
  const avg7 = mean(inWindow(sorted, shift(today, -6), today)) ?? (trend.at(-1)?.avg ?? null);
  const prev7 = mean(inWindow(sorted, shift(today, -13), shift(today, -7)));
  const weekChange = avg7 !== null && prev7 !== null ? avg7 - prev7 : null;

  // Linear regression over the last 28 days of weigh-ins.
  const recent = sorted.filter((p) => p.date >= shift(today, -27));
  let ratePerWeek: number | null = null;
  if (recent.length >= 4 && daysBetween(recent[0].date, recent.at(-1)!.date) >= 6) {
    const xs = recent.map((p) => daysBetween(recent[0].date, p.date));
    const ys = recent.map((p) => p.weight);
    const mx = mean(xs)!;
    const my = mean(ys)!;
    let num = 0;
    let den = 0;
    for (let i = 0; i < xs.length; i++) {
      num += (xs[i] - mx) * (ys[i] - my);
      den += (xs[i] - mx) ** 2;
    }
    ratePerWeek = den ? (num / den) * 7 : null;
  }

  const base = opts.startWeight ?? sorted[0]?.weight ?? null;
  const totalGain = avg7 !== null && base !== null ? avg7 - base : null;
  const toGoal = avg7 !== null && opts.goalWeight ? opts.goalWeight - avg7 : null;

  let eta: string | null = null;
  if (toGoal !== null && ratePerWeek !== null && toGoal > 0 && ratePerWeek > 0.05) {
    eta = DateTime.fromISO(today).plus({ days: Math.ceil((toGoal / ratePerWeek) * 7) }).toISODate();
  }

  let pace: WeightStats["pace"] = null;
  if (ratePerWeek !== null) {
    const target = opts.targetRate ?? 0.5;
    if (ratePerWeek < -0.1) pace = "losing";
    else if (ratePerWeek < target * 0.6) pace = "slow";
    else if (ratePerWeek > target * 1.6) pace = "fast";
    else pace = "on-track";
  }

  return {
    latest,
    avg7: round(avg7),
    weekChange: round(weekChange),
    ratePerWeek: round(ratePerWeek),
    totalGain: round(totalGain),
    toGoal: round(toGoal),
    eta,
    pace,
    trend,
  };
}

/** Epley estimated one-rep max. */
export function e1rm(weight: number, reps: number): number {
  if (reps <= 1) return weight;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}
