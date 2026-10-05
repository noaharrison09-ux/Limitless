import { NavLink, Outlet } from "react-router-dom";
import { useApi } from "../lib/hooks";
import { Icon, type IconName } from "./Icon";
import { Toasts } from "./ui";

type Counts = { unread: number; pendingApprovals: number };

const TABS: { to: string; label: string; icon: IconName; badge?: keyof Counts }[] = [
  { to: "/", label: "Today", icon: "home" },
  { to: "/calendar", label: "Calendar", icon: "calendar", badge: "pendingApprovals" },
  { to: "/homework", label: "Homework", icon: "book" },
  { to: "/journal", label: "Journal", icon: "journal" },
  { to: "/more", label: "More", icon: "grid" },
];

export function Layout() {
  const { data } = useApi<Counts>("/notifications");
  return (
    <div className="app">
      <Outlet />
      <nav className="tabbar" aria-label="Main">
        <div className="tabbar-inner">
          {TABS.map((t) => {
            const n = t.badge && data ? data[t.badge] : 0;
            return (
              <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
                <Icon name={t.icon} size={23} />
                {t.label}
                {n ? <span className="badge-inline">{n > 99 ? "99+" : n}</span> : null}
              </NavLink>
            );
          })}
        </div>
      </nav>
      <Toasts />
    </div>
  );
}
