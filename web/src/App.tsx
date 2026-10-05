import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { api, refreshAll } from "./lib/api";
import type { Settings } from "./lib/types";
import { Layout } from "./components/Layout";
import { Spinner } from "./components/ui";
import { Login } from "./pages/Login";
import { TodayPage } from "./pages/Today";
import { CalendarPage } from "./pages/Calendar";
import { HomeworkPage } from "./pages/Homework";
import { JournalPage } from "./pages/Journal";
import { MorePage } from "./pages/More";
import { BodyPage } from "./pages/Body";
import { GoalsPage } from "./pages/Goals";
import { ProjectsPage } from "./pages/Projects";
import { ProjectDetailPage } from "./pages/ProjectDetail";
import { InboxPage } from "./pages/Inbox";
import { ApprovalsPage } from "./pages/Approvals";
import { SettingsPage } from "./pages/Settings";
import { NotificationsPage } from "./pages/Notifications";

export function App() {
  const [authed, setAuthed] = useState<boolean | null>(null);

  useEffect(() => {
    api
      .get<{ authenticated: boolean }>("/auth/session")
      .then((r) => setAuthed(r.authenticated))
      .catch(() => setAuthed(false));
    const onUnauthorized = () => setAuthed(false);
    const onVisible = () => document.visibilityState === "visible" && refreshAll();
    window.addEventListener("limitless:unauthorized", onUnauthorized);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("limitless:unauthorized", onUnauthorized);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Reminders fire on the server, so it needs to know the phone's timezone.
  useEffect(() => {
    if (!authed) return;
    api
      .get<Settings>("/settings")
      .then((s) => {
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
        if (!s.prefs.timezoneConfirmed && tz) return api.put("/settings/prefs", { timezone: tz });
      })
      .catch(() => {});
  }, [authed]);

  if (authed === null) return <Spinner />;
  if (!authed) return <Login onDone={() => setAuthed(true)} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<TodayPage />} />
          <Route path="calendar" element={<CalendarPage />} />
          <Route path="homework" element={<HomeworkPage />} />
          <Route path="journal" element={<JournalPage />} />
          <Route path="journal/:date" element={<JournalPage />} />
          <Route path="more" element={<MorePage />} />
          <Route path="body" element={<BodyPage />} />
          <Route path="goals" element={<GoalsPage />} />
          <Route path="projects" element={<ProjectsPage />} />
          <Route path="projects/:id" element={<ProjectDetailPage />} />
          <Route path="inbox" element={<InboxPage />} />
          <Route path="approvals" element={<ApprovalsPage />} />
          <Route path="notifications" element={<NotificationsPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
