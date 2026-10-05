import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api, errorMessage, refreshAll, toast } from "../lib/api";
import { readFileText } from "../lib/device";
import { Icon } from "../components/Icon";
import { Card, ErrorBox, Segmented, TopBar } from "../components/ui";

type Result = { added: number; updated: number };

export function ImportPage() {
  const [as, setAs] = useState<"homework" | "events">("homework");
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await readFileText(file);
      const r = await api.post<Result>("/import/ics", { text, as });
      setResult(r);
      toast(`Imported ${r.added} new, updated ${r.updated}`);
      refreshAll();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <TopBar title="Import calendar" back />
      <div className="page">
        <Card eyebrow="From a calendar file (.ics)" title="Bring in homework or events">
          <p className="small" style={{ margin: "0 0 12px", color: "var(--ink-2)" }}>
            Pick a calendar file saved on your phone. Importing the same file again later updates what's here without making duplicates, and
            anything you've checked off or removed stays that way.
          </p>
          <Segmented
            value={as}
            onChange={setAs}
            options={[
              { value: "homework", label: "As homework" },
              { value: "events", label: "As calendar events" },
            ]}
          />
          <input ref={input} type="file" accept=".ics,text/calendar" style={{ display: "none" }} onChange={(e) => onFile(e.target.files?.[0])} />
          <button className="btn primary block" style={{ marginTop: 12 }} disabled={busy} onClick={() => input.current?.click()}>
            <Icon name="download" size={18} /> {busy ? "Importing…" : "Choose calendar file"}
          </button>
          <ErrorBox error={error} />
          {result && (
            <div className="notice" style={{ marginTop: 10 }}>
              {result.added} new · {result.updated} updated.{" "}
              <Link to={as === "homework" ? "/homework" : "/calendar"}>See them</Link>
            </div>
          )}
        </Card>

        <Card title="Schoology homework">
          <ol className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--ink-2)" }}>
            <li>In Safari, sign in to Schoology and open <strong>Calendar</strong>.</li>
            <li>Tap the <strong>iCal</strong> / <strong>Export</strong> button and copy the link it shows.</li>
            <li>
              Paste the link into Safari's address bar, change <code>webcal://</code> to <code>https://</code>, and open it. Save the file (Share →{" "}
              <strong>Save to Files</strong>).
            </li>
            <li>
              Come back here, choose <strong>As homework</strong>, and pick that file.
            </li>
          </ol>
          <p className="tiny muted" style={{ margin: "8px 0 0" }}>Repeat whenever you want new assignments; re-importing only adds what's new.</p>
        </Card>

        <Card title="Google Calendar">
          <ol className="small" style={{ margin: 0, paddingLeft: 20, color: "var(--ink-2)" }}>
            <li>
              On a computer, open Google Calendar → ⚙ <strong>Settings</strong> → <strong>Import &amp; export</strong> → <strong>Export</strong>.
            </li>
            <li>Unzip the download and get the .ics file for the calendar you want onto your phone (AirDrop, Drive, or email it to yourself).</li>
            <li>
              Choose <strong>As calendar events</strong> above and pick the file.
            </li>
          </ol>
        </Card>
      </div>
    </>
  );
}
