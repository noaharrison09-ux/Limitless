import { useEffect } from "react";
import { Link } from "react-router-dom";
import { api, refreshAll } from "../lib/api";
import { useApi } from "../lib/hooks";
import { ago } from "../lib/dates";
import { Empty, Spinner, TopBar } from "../components/ui";

type Notice = { id: number; title: string; body: string | null; url: string | null; read: number; created_at: string };

export function NotificationsPage() {
  const { data } = useApi<{ items: Notice[]; unread: number }>("/notifications");

  useEffect(() => {
    if (data?.unread) {
      api.post("/notifications/read-all").then(() => refreshAll()).catch(() => {});
    }
  }, [data?.unread]);

  return (
    <>
      <TopBar title="Notifications" back />
      <div className="page">
        {!data ? (
          <Spinner />
        ) : data.items.length === 0 ? (
          <section className="card">
            <Empty icon="bell" title="No notifications yet">
              Reminders, important emails and approval requests will appear here.
            </Empty>
          </section>
        ) : (
          <section className="card flush">
            {data.items.map((n) => (
              <Link key={n.id} to={n.url ?? "/"} className="row" style={!n.read ? { background: "var(--oak-wash)" } : undefined}>
                <div className="row-main">
                  <div className="row-title">{n.title}</div>
                  {n.body && <div className="row-sub">{n.body}</div>}
                </div>
                <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>{ago(n.created_at)}</span>
              </Link>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
