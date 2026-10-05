import { useState, type FormEvent } from "react";
import { api, errorMessage } from "../lib/api";
import { ErrorBox } from "../components/ui";

export function Login({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post("/auth/login", { password });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <div className="login-top">
        <img src="/icons/icon-192.png" alt="" width={84} height={84} style={{ borderRadius: 22, boxShadow: "0 10px 30px rgba(0,0,0,.35)" }} />
        <h1 style={{ marginTop: 18 }}>Limitless</h1>
        <p style={{ color: "var(--oak-2)", margin: "6px 0 0" }}>Your days, your goals, your progress.</p>
      </div>
      <form className="login-panel form" onSubmit={submit}>
        <label className="field">
          <span>Password</span>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </label>
        <ErrorBox error={error} />
        <button className="btn primary block" disabled={busy || !password}>
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>
    </div>
  );
}
