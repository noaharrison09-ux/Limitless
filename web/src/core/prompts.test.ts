import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { all, run } from "./db.ts";
import { api, freshDb } from "./test/helpers.ts";
import { ensurePrompts, promptOptions, promptsFor } from "./prompts.ts";
import { addDays } from "./time.ts";

// Noon in New York on Monday, October 5, 2026.
const NOW = Date.parse("2026-10-05T16:00:00Z");
const TODAY = "2026-10-05";

beforeEach(async () => {
  await freshDb("America/New_York");
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function entry(date: string, values: { went_right?: string; went_wrong?: string; mood?: number }) {
  run(
    "INSERT INTO journal_entries (date, went_right, went_wrong, mood) VALUES (?, ?, ?, ?)",
    date,
    values.went_right ?? null,
    values.went_wrong ?? null,
    values.mood ?? null,
  );
}

describe("daily prompts", () => {
  it("makes a reflection prompt and a recall question for today, and keeps them for the day", async () => {
    const call = api();
    const first = await call<{ reflect: { prompt: string }; recall: { prompt: string } }>("GET", `/journal/prompts/${TODAY}`);
    expect(first.status).toBe(200);
    expect(first.data.reflect.prompt.length).toBeGreaterThan(10);
    expect(first.data.recall.prompt.length).toBeGreaterThan(10);
    const again = await call("GET", `/journal/prompts/${TODAY}`);
    expect(again.data).toEqual(first.data);
    expect(all("SELECT kind FROM journal_prompts ORDER BY kind")).toEqual([{ kind: "recall" }, { kind: "reflect" }]);
  });

  it("changes every day and doesn't repeat a prompt within a month", () => {
    const keys: string[] = [];
    for (let i = 0; i < 30; i++) {
      const day = addDays("2026-09-01", i);
      keys.push(ensurePrompts(day).reflect!.prompt_key);
    }
    expect(new Set(keys).size).toBe(30);
  });

  it("doesn't invent prompts for past days you didn't open", async () => {
    const res = await api()("GET", "/journal/prompts/2026-09-01");
    expect(res.data).toEqual({ date: "2026-09-01", reflect: null, recall: null });
  });

  it("shows today's prompt on the Today screen", async () => {
    const today = await api()<{ journal: { prompt: string } }>("GET", "/today");
    expect(today.data.journal.prompt).toBe(promptsFor(TODAY).reflect!.prompt);
  });
});

describe("memory recall", () => {
  it("quizzes you on an entry from a spaced day back, and reveals what you wrote", async () => {
    entry(addDays(TODAY, -7), { went_right: "Aced the chem quiz" });
    const call = api();
    const { data } = await call<{ recall: { prompt: string; hint: string; source_date: string; revealed: number } }>("GET", `/journal/prompts/${TODAY}`);
    expect(data.recall.prompt).toContain("a week ago, on Monday, Sep 28");
    expect(data.recall.hint).toBe("Aced the chem quiz");
    expect(data.recall.source_date).toBe("2026-09-28");

    await call("PUT", `/journal/prompts/${TODAY}/recall`, { answer: "the chemistry quiz", revealed: true, recalled: 2 });
    expect(promptsFor(TODAY).recall).toMatchObject({ answer: "the chemistry quiz", revealed: 1, recalled: 2 });
  });

  it("asks about past non-negotiables", () => {
    const day = addDays(TODAY, -3);
    run("INSERT INTO non_negotiables (for_date, text, done, position) VALUES (?, 'Gym', 1, 0), (?, 'Read 20 pages', 0, 1)", day, day);
    const recall = ensurePrompts(TODAY).recall!;
    expect(recall.prompt).toContain("non-negotiables 3 days ago");
    expect(recall.hint).toBe("✓ Gym\n✗ Read 20 pages");
  });

  it("doesn't ask about the same day twice in a month", () => {
    entry(addDays(TODAY, -14), { went_right: "Finished the project" });
    const first = ensurePrompts(addDays(TODAY, -2)).recall!;
    expect(first.prompt_key).toBe("right:2026-09-21");
    // Two days later the same entry is 14 days back from a different day, but it was already asked.
    const later = ensurePrompts(TODAY).recall!;
    expect(later.prompt_key).not.toBe("right:2026-09-21");
  });

  it("falls back to general memory exercises with no history", () => {
    const recall = ensurePrompts(TODAY).recall!;
    expect(recall.prompt_key).toMatch(/^gen-/);
    expect(recall.hint).toBeNull();
  });
});

describe("prompts that fit what's going on", () => {
  it("follows up on what went wrong yesterday, ahead of the regular questions", () => {
    entry(addDays(TODAY, -1), { went_wrong: "Skipped the gym and stayed up too late" });
    const followUp = promptOptions(TODAY, "reflect").find((c) => c.key === "sit-followup");
    expect(followUp?.prompt).toBe("Yesterday you wrote that “Skipped the gym and stayed up too late” went wrong. Did today go differently?");
    expect(followUp!.weight).toBeGreaterThan(1);
  });

  it("notices slipping non-negotiables, a dip in mood, overdue work and goals coming due", () => {
    for (let i = 1; i <= 7; i++) {
      const day = addDays(TODAY, -i);
      run("INSERT INTO non_negotiables (for_date, text, done, position) VALUES (?, 'Gym', ?, 0)", day, i === 1 ? 1 : 0);
    }
    [5, 5, 4, 5, 2, 2, 1].forEach((mood, i) => entry(addDays(TODAY, -(7 - i)), { mood }));
    run("INSERT INTO homework (title, due_at) VALUES ('Essay', '2026-10-01T03:59:00.000Z')");
    run("INSERT INTO goals (title, target_date) VALUES ('Bench 225', ?)", addDays(TODAY, 9));
    const keys = promptOptions(TODAY, "reflect").map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(["sit-nn-slipping", "sit-mood-dip", "sit-overdue", "sit-goal-due"]));
    const prompts = promptOptions(TODAY, "reflect").map((c) => c.prompt);
    expect(prompts).toContain("You kept 1 of 7 non-negotiables this past week. Which one keeps slipping, and what's really in the way?");
    expect(prompts).toContain("“Bench 225” is due Wednesday, Oct 14. What's the next concrete step?");
  });

  it("fills prompts with your own goals, projects and classes", () => {
    run("INSERT INTO goals (title) VALUES ('Run a 5K')");
    run("INSERT INTO projects (name) VALUES ('Workout app')");
    run("INSERT INTO homework (title, course) VALUES ('Lab', 'AP Chemistry')");
    const prompts = promptOptions(TODAY, "reflect").map((c) => c.prompt);
    expect(prompts.some((p) => p.includes("“Run a 5K”"))).toBe(true);
    expect(prompts.some((p) => p.includes("Workout app"))).toBe(true);
    expect(prompts.some((p) => p.includes("AP Chemistry"))).toBe(true);
    expect(prompts.some((p) => /\{(goal|project|course|nn)\}/.test(p))).toBe(false);
  });

  it("can be swapped until you've answered it", async () => {
    const call = api();
    const before = ensurePrompts(TODAY).reflect!;
    const swapped = await call<{ prompt_key: string }>("POST", `/journal/prompts/${TODAY}/reflect/shuffle`);
    expect(swapped.status).toBe(200);
    expect(swapped.data.prompt_key).not.toBe(before.prompt_key);
    await call("PUT", `/journal/prompts/${TODAY}/reflect`, { answer: "Done" });
    expect((await call("POST", `/journal/prompts/${TODAY}/reflect/shuffle`)).status).toBe(400);
    expect((await call("POST", "/journal/prompts/2026-09-01/reflect/shuffle")).status).toBe(400);
  });

  it("are included in backups", async () => {
    ensurePrompts(TODAY);
    const backup = await api()<{ tables: Record<string, unknown[]> }>("GET", "/export");
    expect(backup.data.tables.journal_prompts).toHaveLength(2);
  });
});
