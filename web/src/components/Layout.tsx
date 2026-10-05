import { NavLink, Outlet } from "react-router-dom";
import { Icon, type IconName } from "./Icon";
import { Toasts } from "./ui";

const TABS: { to: string; label: string; icon: IconName }[] = [
  { to: "/", label: "Today", icon: "home" },
  { to: "/calendar", label: "Calendar", icon: "calendar" },
  { to: "/homework", label: "Homework", icon: "book" },
  { to: "/journal", label: "Journal", icon: "journal" },
  { to: "/more", label: "More", icon: "grid" },
];

export function Layout() {
  return (
    <div className="app">
      <Outlet />
      <nav className="tabbar" aria-label="Main">
        <div className="tabbar-inner">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.to === "/"} className={({ isActive }) => `tab${isActive ? " active" : ""}`}>
              <Icon name={t.icon} size={23} />
              {t.label}
            </NavLink>
          ))}
        </div>
      </nav>
      <Toasts />
    </div>
  );
}
