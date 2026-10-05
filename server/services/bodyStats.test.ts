import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import { e1rm, weightStats } from "./bodyStats.ts";

function series(days: number, start: number, perWeek: number, today: string) {
  return Array.from({ length: days }, (_, i) => ({
    date: DateTime.fromISO(today).minus({ days: days - 1 - i }).toISODate()!,
    // a lean bulk with +/-0.4 lb of daily water noise
    weight: start + (perWeek / 7) * i + (i % 2 ? 0.4 : -0.4),
  }));
}

describe("weightStats", () => {
  const today = "2026-10-05";

  it("recovers the weekly rate through daily noise", () => {
    const s = weightStats(series(28, 160, 0.5, today), today, { goalWeight: 170, targetRate: 0.5 });
    expect(s.ratePerWeek).toBeCloseTo(0.5, 1);
    expect(s.pace).toBe("on-track");
    // Week-over-week compares two 7-day means, so +/-0.4 alternating noise leaves up to ~0.12 of wobble.
    expect(Math.abs(s.weekChange! - 0.5)).toBeLessThan(0.15);
    expect(s.eta).not.toBeNull();
    expect(s.trend).toHaveLength(28);
  });

  it("flags a stalled bulk as slow and a cut as losing", () => {
    expect(weightStats(series(21, 160, 0.1, today), today, { targetRate: 0.5 }).pace).toBe("slow");
    expect(weightStats(series(21, 160, -0.6, today), today, { targetRate: 0.5 }).pace).toBe("losing");
  });

  it("needs a week of data before estimating a rate", () => {
    const s = weightStats(series(3, 160, 0.5, today), today, {});
    expect(s.ratePerWeek).toBeNull();
    expect(s.pace).toBeNull();
    expect(s.avg7).not.toBeNull();
  });

  it("handles no data", () => {
    expect(weightStats([], today, {})).toMatchObject({ latest: null, avg7: null, trend: [] });
  });
});

describe("e1rm", () => {
  it("uses the Epley formula", () => {
    expect(e1rm(200, 1)).toBe(200);
    expect(e1rm(185, 5)).toBe(215.8);
  });
});
