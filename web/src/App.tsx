import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { TodayPage } from "./pages/Today";
import { CalendarPage } from "./pages/Calendar";
import { HomeworkPage } from "./pages/Homework";
import { JournalPage } from "./pages/Journal";
import { MorePage } from "./pages/More";
import { BodyPage } from "./pages/Body";
import { GoalsPage } from "./pages/Goals";
import { ProjectsPage } from "./pages/Projects";
import { ProjectDetailPage } from "./pages/ProjectDetail";
import { ImportPage } from "./pages/Import";
import { SettingsPage } from "./pages/Settings";

// Hash URLs (#/calendar) keep every screen working on static hosting like GitHub Pages,
// including refreshes and launching from the Home Screen.
export function App() {
  return (
    <HashRouter>
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
          <Route path="import" element={<ImportPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
