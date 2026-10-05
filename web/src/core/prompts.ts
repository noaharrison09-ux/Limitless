/**
 * Daily journal prompts, made on the phone from your own entries. Nothing is sent anywhere.
 *
 * Each day gets two:
 * - reflect: a fresh question, sometimes shaped by what's going on (a goal coming due,
 *   non-negotiables slipping, a dip in mood). Questions don't repeat for weeks.
 * - recall: a memory check on your own past entries, picked at spaced intervals
 *   (1, 3, 7, 14, 30, 60 days back), which is how recall practice sticks. Write your answer
 *   first, then reveal what you actually wrote.
 *
 * A day's prompts are made the first time you open them and then stay put for that day.
 */
import { DateTime } from "luxon";
import { all, get, run } from "./db.ts";
import { addDays, localDateOf, localToUtcIso } from "./time.ts";

export type PromptKind = "reflect" | "recall";

export type PromptRow = {
  id: number;
  date: string;
  kind: PromptKind;
  prompt_key: string;
  prompt: string;
  hint: string | null;
  source_date: string | null;
  answer: string | null;
  revealed: number;
  recalled: number | null;
};

type Candidate = { key: string; prompt: string; hint?: string; sourceDate?: string; weight: number };

/* ---------- Seeded randomness: the same day always starts from the same pick ---------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: string) {
  let a = hash(seed);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickWeighted(items: Candidate[], rand: () => number): Candidate | null {
  const total = items.reduce((sum, c) => sum + c.weight, 0);
  if (!items.length || total <= 0) return null;
  let r = rand() * total;
  for (const c of items) {
    r -= c.weight;
    if (r < 0) return c;
  }
  return items[items.length - 1];
}

const pickOne = <T,>(list: T[], rand: () => number): T => list[Math.floor(rand() * list.length)];

/* ---------- Reflection prompts ---------- */

type Template = { key: string; text: string; needs?: "goal" | "project" | "course" | "nn"; weekdays?: number[] };

/** {goal}, {project}, {course} and {nn} are filled from your own data. weekdays: 1 = Monday … 7 = Sunday. */
const LIBRARY: Template[] = [
  // Mindset
  { key: "mind-energy", text: "What gave you energy today, and what drained it?" },
  { key: "mind-proud", text: "What's one thing you did today that the version of you from a year ago would be proud of?" },
  { key: "mind-avoid", text: "What are you avoiding right now? What's the smallest step toward it?" },
  { key: "mind-hard", text: "What was the hardest moment of today, and how did you handle it?" },
  { key: "mind-redo", text: "If you could replay one hour of today, which would it be and what would you change?" },
  { key: "mind-focus", text: "When did you feel most focused today? What made that possible?" },
  { key: "mind-worry", text: "What's on your mind that you haven't said out loud? Write it down here." },
  { key: "mind-control", text: "What's one thing stressing you that's actually out of your control? What is in your control?" },
  { key: "mind-advice", text: "What advice would you give a friend who had the day you just had?" },
  { key: "mind-surprise", text: "What surprised you today?" },
  { key: "mind-comfort", text: "Where did you step outside your comfort zone today, even a little?" },
  { key: "mind-excuse", text: "What excuse did you catch yourself making today?" },
  { key: "mind-patient", text: "Where do you need more patience with yourself right now?" },
  { key: "mind-identity", text: "Finish the sentence: \"I'm the kind of person who…\" Did today back that up?" },
  { key: "mind-phone", text: "How much of today did your phone get? Was it worth it?" },
  { key: "mind-decision", text: "What's a decision you've been putting off? What would you decide if you had to today?" },
  { key: "mind-fear", text: "What would you try if you knew you couldn't fail?" },
  { key: "mind-win-small", text: "Name three tiny wins from today, even ones that feel too small to count." },
  { key: "mind-mood", text: "Describe your mood today in one word. Why that word?" },
  { key: "mind-reset", text: "If tomorrow were a fresh start, what's the first thing you'd do differently?" },
  // Gratitude & people
  { key: "grat-three", text: "List three things you're grateful for today, and why each one matters." },
  { key: "grat-person", text: "Who made your day better today? Have you told them?" },
  { key: "grat-overlook", text: "What's something you usually take for granted that you appreciated today?" },
  { key: "ppl-conversation", text: "What was the best conversation you had today?" },
  { key: "ppl-help", text: "Who could you help this week, and how?" },
  { key: "ppl-reach", text: "Who haven't you talked to in a while that you should reach out to?" },
  { key: "ppl-learn", text: "What's something you learned from someone else today?" },
  { key: "ppl-influence", text: "Who are you spending the most time with? Are they pulling you up?" },
  // Growth & learning
  { key: "grow-learned", text: "What's the most useful thing you learned today?" },
  { key: "grow-mistake", text: "What mistake taught you something recently?" },
  { key: "grow-skill", text: "What skill are you building right now? How did you practice it today?" },
  { key: "grow-feedback", text: "What feedback have you gotten lately that you haven't acted on yet?" },
  { key: "grow-curious", text: "What are you curious about right now? How could you learn more about it this week?" },
  { key: "grow-habit", text: "What's one habit that's quietly helping you, and one that's quietly hurting you?" },
  { key: "grow-better", text: "In what way are you better than you were a month ago?" },
  { key: "grow-next-level", text: "What would \"next level\" look like for you three months from now?" },
  // School
  { key: "school-course", text: "What's one thing you learned in {course} recently? Explain it in your own words.", needs: "course" },
  { key: "school-hardest", text: "Which class is giving you the most trouble right now? What would make it easier?" },
  { key: "school-ahead", text: "What's one assignment you could get ahead on this week?" },
  { key: "school-study", text: "How did you study today? What actually worked, and what was just busywork?" },
  { key: "school-teacher", text: "What's a question you should ask in {course}?", needs: "course" },
  { key: "school-grade", text: "What grade do you want in {course} this term, and what does it take from here?", needs: "course" },
  // Body & training
  { key: "body-train", text: "How did training feel today? What's one thing to push next session?" },
  { key: "body-eat", text: "Did you eat enough today to grow? What would make hitting your calories easier?" },
  { key: "body-sleep", text: "How did you sleep last night, and how did it show up in your day?" },
  { key: "body-recover", text: "What does your body need more of this week: rest, food, water or movement?" },
  { key: "body-strong", text: "When did you feel strongest this week, in body or mind?" },
  { key: "body-pr", text: "What's the next personal record you're chasing, and what's the plan to get it?" },
  // Goals & projects
  { key: "goal-why", text: "Why does “{goal}” matter to you? Write the real reason.", needs: "goal" },
  { key: "goal-step", text: "What's one step you could take toward “{goal}” in the next 24 hours?", needs: "goal" },
  { key: "goal-blocker", text: "What's the biggest thing standing between you and “{goal}”?", needs: "goal" },
  { key: "goal-done", text: "Picture “{goal}” done. What changed to get you there?", needs: "goal" },
  { key: "proj-idea", text: "What's a new idea for {project}, even a rough one?", needs: "project" },
  { key: "proj-stuck", text: "Where is {project} stuck, and what would get it moving?", needs: "project" },
  { key: "proj-ship", text: "What's the smallest version of {project} you could finish this week?", needs: "project" },
  { key: "idea-wild", text: "Write down one idea you've had lately, no matter how wild." },
  { key: "idea-problem", text: "What's a problem you noticed today that someone should solve?" },
  // Non-negotiables
  { key: "nn-why", text: "Why is “{nn}” one of your non-negotiables? Is it still the right one?", needs: "nn" },
  { key: "nn-easier", text: "How could you make “{nn}” easier to stick to tomorrow?", needs: "nn" },
  { key: "nn-new", text: "Is there a new non-negotiable you should add? What would it change?" },
  // Days of the week
  { key: "week-mon", text: "What would make this week a win? Name it specifically.", weekdays: [1] },
  { key: "week-wed", text: "Halfway through the week: on track, or time to adjust?", weekdays: [3] },
  { key: "week-fri", text: "What's one thing from this week you want to remember?", weekdays: [5] },
  { key: "week-sat", text: "How do you want to spend this weekend so Monday-you is glad you did?", weekdays: [6] },
  { key: "week-sun", text: "Look back at the week: what went well, what didn't, and what's the plan for next week?", weekdays: [7] },
];

function context(date: string) {
  const since = addDays(date, -14);
  return {
    goals: all<{ title: string }>("SELECT title FROM goals WHERE status = 'active'").map((g) => g.title),
    projects: all<{ name: string }>("SELECT name FROM projects WHERE status IN ('active', 'idea')").map((p) => p.name),
    courses: all<{ course: string }>(
      "SELECT DISTINCT course FROM homework WHERE course IS NOT NULL AND course != '' AND hidden = 0",
    ).map((h) => h.course),
    nns: [
      ...new Set(
        all<{ text: string }>("SELECT text FROM non_negotiables WHERE for_date >= ? AND for_date <= ?", since, date).map((n) => n.text),
      ),
    ],
    weekday: DateTime.fromISO(date).weekday,
  };
}

function snippet(text: string, max = 90): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

const fmtDate = (d: string) => DateTime.fromISO(d).toFormat("cccc, LLL d");
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Prompts drawn from what's going on in your data right now. */
function situational(date: string): Candidate[] {
  const out: Candidate[] = [];

  const yesterday = get<{ went_wrong: string | null }>("SELECT went_wrong FROM journal_entries WHERE date = ?", addDays(date, -1));
  if (yesterday?.went_wrong?.trim()) {
    out.push({
      key: "sit-followup",
      prompt: `Yesterday you wrote that “${snippet(yesterday.went_wrong)}” went wrong. Did today go differently?`,
      weight: 3,
    });
  }

  const week = get<{ total: number; done: number | null }>(
    "SELECT COUNT(*) AS total, SUM(done) AS done FROM non_negotiables WHERE for_date >= ? AND for_date < ?",
    addDays(date, -7),
    date,
  );
  if (week && week.total >= 5 && (week.done ?? 0) / week.total < 0.6) {
    out.push({
      key: "sit-nn-slipping",
      prompt: `You kept ${week.done ?? 0} of ${week.total} non-negotiables this past week. Which one keeps slipping, and what's really in the way?`,
      weight: 2.5,
    });
  }
  let perfect = 0;
  for (let i = 1; i <= 30; i++) {
    const day = get<{ total: number; done: number | null }>(
      "SELECT COUNT(*) AS total, SUM(done) AS done FROM non_negotiables WHERE for_date = ?",
      addDays(date, -i),
    );
    if (!day || day.total === 0 || (day.done ?? 0) < day.total) break;
    perfect++;
  }
  if (perfect >= 3) {
    out.push({
      key: "sit-nn-streak",
      prompt: `You've kept every non-negotiable for ${perfect} days straight. What's making it work, and how do you protect it?`,
      weight: 2.5,
    });
  }

  const moods = all<{ mood: number }>(
    "SELECT mood FROM journal_entries WHERE mood IS NOT NULL AND date < ? ORDER BY date DESC LIMIT 10",
    date,
  ).map((m) => m.mood);
  if (moods.length >= 6) {
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    if (avg(moods.slice(0, 3)) <= avg(moods.slice(3)) - 1) {
      out.push({
        key: "sit-mood-dip",
        prompt: "Your mood has dipped over the last few days. What's weighing on you, and what's one small thing that would help?",
        weight: 3,
      });
    }
  }

  const overdue = get<{ n: number }>(
    "SELECT COUNT(*) AS n FROM homework WHERE hidden = 0 AND status != 'done' AND due_at IS NOT NULL AND due_at < ?",
    localToUtcIso(date),
  )?.n;
  if (overdue) {
    out.push({
      key: "sit-overdue",
      prompt: `You have ${plural(overdue, "overdue assignment")}. What's actually getting in the way, and when will you knock out the first one?`,
      weight: 1.5,
    });
  }

  const dueGoal = get<{ title: string; target_date: string }>(
    "SELECT title, target_date FROM goals WHERE status = 'active' AND target_date >= ? AND target_date <= ? ORDER BY target_date LIMIT 1",
    date,
    addDays(date, 14),
  );
  if (dueGoal) {
    out.push({
      key: "sit-goal-due",
      prompt: `“${dueGoal.title}” is due ${fmtDate(dueGoal.target_date)}. What's the next concrete step?`,
      weight: 2,
    });
  }
  return out;
}

/** Keys used on or after `since` (and before `date`), so they aren't repeated too soon. */
function recentKeys(kind: PromptKind, date: string, days: number): Set<string> {
  return new Set(
    all<{ prompt_key: string }>(
      "SELECT prompt_key FROM journal_prompts WHERE kind = ? AND date >= ? AND date < ?",
      kind,
      addDays(date, -days),
      date,
    ).map((r) => r.prompt_key),
  );
}

function reflectCandidates(date: string, rand: () => number): Candidate[] {
  const ctx = context(date);
  const usedLong = recentKeys("reflect", date, 30);
  const usedShort = recentKeys("reflect", date, 4);
  const fills: Record<NonNullable<Template["needs"]>, string[]> = {
    goal: ctx.goals,
    project: ctx.projects,
    course: ctx.courses,
    nn: ctx.nns,
  };
  const library = LIBRARY.filter((t) => !usedLong.has(t.key))
    .filter((t) => !t.weekdays || t.weekdays.includes(ctx.weekday))
    .filter((t) => !t.needs || fills[t.needs].length > 0)
    .map((t) => ({
      key: t.key,
      prompt: t.needs ? t.text.replace(`{${t.needs}}`, pickOne(fills[t.needs], rand)) : t.text,
      // Day-of-week prompts are only eligible one day a week, so give them a better chance that day.
      weight: t.weekdays ? 6 : t.needs ? 1.3 : 1,
    }));
  const smart = situational(date).filter((c) => !usedShort.has(c.key));
  const pool = [...smart, ...library];
  // Everything used in the last 30 days: fall back to the whole library rather than nothing.
  return pool.length ? pool : LIBRARY.filter((t) => !t.needs && !t.weekdays).map((t) => ({ key: t.key, prompt: t.text, weight: 1 }));
}

/* ---------- Memory recall ---------- */

/** Spaced intervals (days back) and how strongly each is preferred. */
const SPACING: [number, number][] = [
  [1, 1],
  [3, 3],
  [7, 3.5],
  [14, 3],
  [30, 3],
  [60, 2],
];

function when(offset: number, sourceDate: string): string {
  const day = fmtDate(sourceDate);
  if (offset === 1) return `yesterday (${day})`;
  if (offset === 7) return `a week ago, on ${day}`;
  if (offset === 14) return `two weeks ago, on ${day}`;
  if (offset === 30) return `a month ago, on ${day}`;
  if (offset === 60) return `two months ago, on ${day}`;
  return `${offset} days ago, on ${day}`;
}

const GENERAL_RECALL: Template[] = [
  { key: "gen-yesterday", text: "Without checking your phone, walk through yesterday from morning to night. What do you remember?" },
  { key: "gen-meals", text: "What did you eat for each meal yesterday? Try to recall every detail." },
  { key: "gen-class", text: "What's one thing you learned in {course} this week? Explain it as if you're teaching a friend.", needs: "course" },
  { key: "gen-said", text: "Recall three things someone said to you today, word for word if you can." },
  { key: "gen-read", text: "What were the main points of the last thing you read or watched?" },
  { key: "gen-best", text: "Picture the best moment of this past week. Describe it in as much detail as you can." },
  { key: "gen-names", text: "Name everyone you talked to today, and one thing each of them said." },
  { key: "gen-lift", text: "What were your weights and reps on your last workout? Write them before you check." },
  { key: "gen-week", text: "List what you did each day this week, Monday until today." },
  { key: "gen-goal", text: "Without looking, write down every step of your goal “{goal}”.", needs: "goal" },
];

function recallCandidates(date: string, rand: () => number): Candidate[] {
  const used = recentKeys("recall", date, 30);
  const out: Candidate[] = [];

  for (const [offset, weight] of SPACING) {
    const d = addDays(date, -offset);
    const entry = get<{ went_right: string | null; went_wrong: string | null }>(
      "SELECT went_right, went_wrong FROM journal_entries WHERE date = ?",
      d,
    );
    if (entry?.went_right?.trim()) {
      out.push({ key: `right:${d}`, prompt: `Memory check: what did you say went right ${when(offset, d)}?`, hint: entry.went_right, sourceDate: d, weight });
    }
    if (entry?.went_wrong?.trim()) {
      out.push({
        key: `wrong:${d}`,
        prompt: `What went wrong ${when(offset, d)}, and has anything changed since?`,
        hint: entry.went_wrong,
        sourceDate: d,
        weight: weight * 0.8,
      });
    }
    const nns = all<{ text: string; done: number }>("SELECT text, done FROM non_negotiables WHERE for_date = ? ORDER BY position, id", d);
    if (nns.length >= 2) {
      out.push({
        key: `nn:${d}`,
        prompt: `Without looking: what were your non-negotiables ${when(offset, d)}? Which did you keep?`,
        hint: nns.map((n) => `${n.done ? "✓" : "✗"} ${n.text}`).join("\n"),
        sourceDate: d,
        weight: weight * 0.8,
      });
    }
  }

  // Older entries that don't land on a spaced day still count, at a lower weight.
  if (!out.length) {
    const older = all<{ date: string; went_right: string | null }>(
      "SELECT date, went_right FROM journal_entries WHERE date >= ? AND date <= ? AND went_right IS NOT NULL AND went_right != ''",
      addDays(date, -90),
      addDays(date, -2),
    );
    for (const e of older) {
      const offset = DateTime.fromISO(date).diff(DateTime.fromISO(e.date), "days").days;
      out.push({ key: `right:${e.date}`, prompt: `Memory check: what did you say went right ${when(Math.round(offset), e.date)}?`, hint: e.went_right!, sourceDate: e.date, weight: 1 });
    }
  }

  const notes = all<{ id: number; body: string; created_at: string; project: string | null }>(
    `SELECT n.id, n.body, n.created_at, p.name AS project FROM notes n LEFT JOIN projects p ON p.id = n.project_id
     WHERE n.created_at >= ? AND n.created_at < ? ORDER BY n.created_at DESC LIMIT 20`,
    localToUtcIso(addDays(date, -60)),
    localToUtcIso(addDays(date, -1)),
  );
  for (const n of notes.slice(0, 5)) {
    out.push({
      key: `note:${n.id}`,
      prompt: n.project
        ? `What was the idea you wrote down for ${n.project} on ${fmtDate(localDateOf(n.created_at))}?`
        : `What idea did you capture on ${fmtDate(localDateOf(n.created_at))}?`,
      hint: snippet(n.body, 400),
      weight: 1.2,
    });
  }

  const finished = all<{ title: string }>(
    "SELECT title FROM homework WHERE status = 'done' AND completed_at >= ? AND completed_at < ? ORDER BY completed_at",
    localToUtcIso(addDays(date, -7)),
    localToUtcIso(date),
  );
  if (finished.length >= 2) {
    out.push({
      key: `hw-done:${date}`,
      prompt: "Name every assignment you finished in the last week.",
      hint: finished.map((h) => `• ${h.title}`).join("\n"),
      weight: 1,
    });
  }

  const goal = get<{ id: number; title: string }>(
    `SELECT g.id, g.title FROM goals g WHERE g.status = 'active' AND g.kind = 'steps'
     AND (SELECT COUNT(*) FROM goal_steps s WHERE s.goal_id = g.id AND s.done = 0) >= 2 ORDER BY g.id LIMIT 1`,
  );
  if (goal) {
    const steps = all<{ title: string }>("SELECT title FROM goal_steps WHERE goal_id = ? AND done = 0 ORDER BY position, id", goal.id);
    out.push({ key: `steps:${goal.id}`, prompt: `What steps are left on your goal “${goal.title}”?`, hint: steps.map((s) => `• ${s.title}`).join("\n"), weight: 1 });
  }

  const fresh = out.filter((c) => !used.has(c.key));
  if (fresh.length) return fresh;

  // No history to quiz you on yet: general memory exercises.
  const ctx = context(date);
  const fills: Record<string, string[]> = { course: ctx.courses, goal: ctx.goals };
  const general = GENERAL_RECALL.filter((t) => !t.needs || fills[t.needs].length > 0).map((t) => ({
    key: t.key,
    prompt: t.needs ? t.text.replace(`{${t.needs}}`, pickOne(fills[t.needs], rand)) : t.text,
    weight: 1,
  }));
  const recent = recentKeys("recall", date, 10);
  const unused = general.filter((c) => !recent.has(c.key));
  return unused.length ? unused : general;
}

/* ---------- Making and keeping a day's prompts ---------- */

/** Everything a day's prompt could be picked from (for tests and curiosity). */
export function promptOptions(date: string, kind: PromptKind): Candidate[] {
  const rand = rng(`${date}|${kind}|options`);
  return kind === "reflect" ? reflectCandidates(date, rand) : recallCandidates(date, rand);
}

function generate(date: string, kind: PromptKind, attempt: number, exclude: string[] = []): Candidate {
  const rand = rng(`${date}|${kind}|${attempt}`);
  const pool = (kind === "reflect" ? reflectCandidates(date, rand) : recallCandidates(date, rand)).filter((c) => !exclude.includes(c.key));
  return pickWeighted(pool, rand) ?? { key: "mind-energy", prompt: LIBRARY[0].text, weight: 1 };
}

export function promptsFor(date: string): { reflect: PromptRow | null; recall: PromptRow | null } {
  const rows = all<PromptRow>("SELECT * FROM journal_prompts WHERE date = ?", date);
  return { reflect: rows.find((r) => r.kind === "reflect") ?? null, recall: rows.find((r) => r.kind === "recall") ?? null };
}

/** Today's prompts, made the first time they're asked for. */
export function ensurePrompts(date: string) {
  for (const kind of ["reflect", "recall"] as const) {
    if (get("SELECT 1 FROM journal_prompts WHERE date = ? AND kind = ?", date, kind)) continue;
    const c = generate(date, kind, 0);
    run(
      "INSERT INTO journal_prompts (date, kind, prompt_key, prompt, hint, source_date) VALUES (?, ?, ?, ?, ?, ?)",
      date,
      kind,
      c.key,
      c.prompt,
      c.hint ?? null,
      c.sourceDate ?? null,
    );
  }
  return promptsFor(date);
}

/** Swaps a prompt you'd rather skip for a different one. */
export function shufflePrompt(date: string, kind: PromptKind): PromptRow {
  const current = ensurePrompts(date)[kind]!;
  const c = generate(date, kind, Date.now(), [current.prompt_key]);
  run(
    "UPDATE journal_prompts SET prompt_key = ?, prompt = ?, hint = ?, source_date = ?, answer = NULL, revealed = 0, recalled = NULL WHERE id = ?",
    c.key,
    c.prompt,
    c.hint ?? null,
    c.sourceDate ?? null,
    current.id,
  );
  return get<PromptRow>("SELECT * FROM journal_prompts WHERE id = ?", current.id)!;
}
