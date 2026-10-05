import { useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { useApi } from "../lib/hooks";
import { ago } from "../lib/dates";
import type { ImportantEmail } from "../lib/types";
import { Icon } from "../components/Icon";
import { Empty, ErrorBox, Segmented, Spinner, TopBar } from "../components/ui";

/** Deep link that opens the message in Gmail when the account is a Gmail one. */
function openLink(m: ImportantEmail): string | null {
  if (!m.message_id || !/gmail|googlemail/.test(m.account_host ?? "")) return null;
  const id = m.message_id.replace(/^<|>$/g, "");
  return `https://mail.google.com/mail/u/0/#search/rfc822msgid%3A${encodeURIComponent(id)}`;
}

function FullEmail({ id }: { id: number }) {
  const { data, error } = useApi<{ body: string | null; snippet: string | null }>(`/email/important/${id}`);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <Spinner />;
  return <div className="email-body" style={{ marginTop: 10 }}>{data.body || data.snippet || "(No text in this email.)"}</div>;
}

export function InboxPage() {
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const { data, error, setData, reload } = useApi<ImportantEmail[]>(`/email/important?filter=${filter}`);
  const accounts = useApi<{ id: number }[]>("/email/accounts").data;
  const [checking, setChecking] = useState(false);
  const [open, setOpen] = useState<number | null>(null);

  const markRead = async (m: ImportantEmail, read = true) => {
    setData((data ?? []).map((x) => (x.id === m.id ? { ...x, read: read ? 1 : 0 } : x)).filter((x) => filter === "all" || !x.read));
    await api.patch(`/email/important/${m.id}`, { read });
    refreshAll();
  };

  const check = async () => {
    setChecking(true);
    try {
      await api.post("/email/check");
      toast("Checked your email");
      reload();
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setChecking(false);
    }
  };

  const readAll = async () => {
    await api.post("/email/important/read-all");
    reload();
    refreshAll();
  };

  return (
    <>
      <TopBar
        title="Important email"
        back
        right={
          accounts?.length ? (
            <button className="icon-btn" aria-label="Check now" onClick={check} disabled={checking}>
              <Icon name="refresh" className={checking ? "spin" : ""} />
            </button>
          ) : undefined
        }
      />
      <div className="page">
        {accounts && accounts.length === 0 && (
          <div className="notice">
            No email connected yet. <Link to="/settings#email">Connect your email</Link> and choose what counts as important.
          </div>
        )}
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ flex: 1 }}>
            <Segmented
              value={filter}
              onChange={setFilter}
              options={[
                { value: "unread", label: "Unread" },
                { value: "all", label: "All" },
              ]}
            />
          </div>
          <button className="btn small" onClick={readAll}>
            Mark all read
          </button>
        </div>
        <ErrorBox error={error} />
        {!data ? (
          <Spinner />
        ) : data.length === 0 ? (
          <section className="card">
            <Empty icon="mail" title={filter === "unread" ? "You're all caught up" : "Nothing flagged yet"}>
              Emails that match your rules show up here and on your lock screen.
            </Empty>
          </section>
        ) : (
          data.map((m) => {
            const link = openLink(m);
            return (
              <section key={m.id} className="card" style={m.read ? { opacity: 0.75 } : undefined}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{m.from_name || m.from_addr}</strong>
                  <span className="tiny muted" style={{ whiteSpace: "nowrap" }}>{ago(m.received_at)}</span>
                </div>
                <div style={{ fontWeight: 600, marginTop: 2 }}>{m.subject}</div>
                {m.summary && <p className="small" style={{ margin: "6px 0 0" }}>{m.summary}</p>}
                {!m.summary && m.snippet && open !== m.id && <p className="small muted" style={{ margin: "6px 0 0" }}>{m.snippet}</p>}
                {open === m.id && <FullEmail id={m.id} />}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10, alignItems: "center" }}>
                  {m.reason && <span className="chip">{m.reason}</span>}
                  {m.appointment_count ? (
                    <Link to="/approvals" className="chip metal" style={{ textDecoration: "none" }}>
                      <Icon name="calendar" size={12} /> On calendar list
                    </Link>
                  ) : null}
                  {m.account_label && <span className="chip">{m.account_label}</span>}
                  <span style={{ flex: 1 }} />
                  {link && (
                    <a className="btn small" href={link} target="_blank" rel="noreferrer" onClick={() => markRead(m)}>
                      <Icon name="external" size={15} /> Open
                    </a>
                  )}
                  <button className="btn small" onClick={() => setOpen(open === m.id ? null : m.id)}>
                    <Icon name="mail" size={15} /> {open === m.id ? "Close" : "Read"}
                  </button>
                  <button className="btn small" onClick={() => markRead(m, !m.read)}>
                    <Icon name="check" size={15} /> {m.read ? "Unread" : "Read"}
                  </button>
                </div>
              </section>
            );
          })
        )}
      </div>
    </>
  );
}
