export type NonNegotiable = { id: number; for_date: string; text: string; done: number; position: number };

export type Homework = {
  id: number;
  title: string;
  course: string | null;
  due_at: string | null;
  all_day: number;
  status: "todo" | "doing" | "done";
  priority: number;
  notes: string | null;
  url: string | null;
  source: string;
  completed_at?: string | null;
};

export type CalEvent = {
  id: number;
  source: string;
  title: string;
  start: string;
  end: string | null;
  all_day: number;
  location: string | null;
  description: string | null;
  url?: string | null;
  color: string | null;
  feed_name: string | null;
};

export type GoalStep = { id: number; goal_id: number; title: string; done: number; position: number };

export type Goal = {
  id: number;
  title: string;
  description: string | null;
  category: string | null;
  target_date: string | null;
  kind: "steps" | "number";
  start_value: number | null;
  current_value: number | null;
  target_value: number | null;
  unit: string | null;
  status: "active" | "done" | "archived";
  steps: GoalStep[];
  progress: number;
};

export type Project = {
  id: number;
  name: string;
  description: string | null;
  status: "idea" | "active" | "paused" | "done";
  emoji: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
  task_count?: number;
  tasks_done?: number;
  note_count?: number;
};

export type Note = { id: number; project_id: number | null; body: string; pinned: number; created_at: string; updated_at: string };

export type ProjectTask = { id: number; project_id: number; title: string; done: number; position: number };

export type Today = {
  date: string;
  hour: number;
  name: string;
  units: string;
  nonNegotiables: NonNegotiable[];
  events: CalEvent[];
  homework: { overdue: Homework[]; dueToday: Homework[]; dueTomorrow: Homework[]; upcoming: Homework[]; openCount: number };
  body: {
    latest: { date: string; weight: number } | null;
    avg7: number | null;
    weekChange: number | null;
    ratePerWeek: number | null;
    goalWeight: number | null;
    weighedInToday: boolean;
    calories: number | null;
    protein: number | null;
    calorieTarget: number | null;
    proteinTarget: number | null;
  };
  goals: Goal[];
  projects: Pick<Project, "id" | "name" | "emoji" | "status">[];
  journal: { writtenToday: boolean; streak: number; tomorrowSet: number };
};

export type TimedReminder = { enabled: boolean; time: string };

export type Settings = {
  prefs: { name: string; timezone: string; units: "lb" | "kg" };
  reminders: {
    morningBriefing: TimedReminder;
    weighIn: TimedReminder;
    homeworkEvening: TimedReminder;
    journal: TimedReminder;
    homeworkDueSoon: { enabled: boolean; hours: number };
    events: { enabled: boolean; minutesBefore: number };
  };
  bulk: BulkSettings;
};

export type BulkSettings = {
  goalWeight: number | null;
  startWeight: number | null;
  startDate: string | null;
  targetRate: number | null;
  calorieTarget: number | null;
  proteinTarget: number | null;
};
