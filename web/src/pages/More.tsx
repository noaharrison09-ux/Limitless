import { Link } from "react-router-dom";
import { useApi } from "../lib/hooks";
import type { Today } from "../lib/types";
import { Icon, type IconName } from "../components/Icon";
import { TopBar, fmtNum } from "../components/ui";

export function MorePage() {
  const today = useApi<Today>("/today").data;
  const counts = useApi<{ unread: number; pendingApprovals: number }>("/notifications").data;

  const tiles: { to: string; icon: IconName; title: string; sub: string; badge?: number }[] = [
    {
      to: "/body",
      icon: "dumbbell",
      title: "Body & bulk",
      sub: today?.body.avg7 ? `${fmtNum(today.body.avg7)} ${today.units} avg` : "Weight, food, lifts",
    },
    { to: "/goals", icon: "target", title: "Goals", sub: today?.goals.length ? `${today.goals.length} active` : "Set your targets" },
    { to: "/projects", icon: "bulb", title: "Ideas & projects", sub: "Thoughts and plans" },
    { to: "/inbox", icon: "mail", title: "Important email", sub: "Screened for you", badge: today?.emails.unread },
    { to: "/approvals", icon: "approve", title: "Approvals", sub: "Calendar requests", badge: counts?.pendingApprovals },
    { to: "/notifications", icon: "bell", title: "Notifications", sub: "Recent alerts", badge: counts?.unread },
    { to: "/journal", icon: "journal", title: "Journal", sub: today?.journal.streak ? `${today.journal.streak}-day streak` : "Daily reflection" },
    { to: "/settings", icon: "gear", title: "Settings", sub: "Connections & reminders" },
  ];

  return (
    <>
      <TopBar title="More" />
      <div className="page">
        <div className="tiles">
          {tiles.map((t) => (
            <Link key={t.to} to={t.to} className="tile">
              <div className="tile-icon">
                <Icon name={t.icon} />
              </div>
              <strong>{t.title}</strong>
              <div className="tile-sub">{t.sub}</div>
              {t.badge ? <span className="dot-badge" style={{ top: 10, right: 10 }}>{t.badge > 99 ? "99+" : t.badge}</span> : null}
            </Link>
          ))}
        </div>
      </div>
    </>
  );
}
