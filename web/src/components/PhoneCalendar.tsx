import { useState } from "react";
import { api, errorMessage, toast } from "../lib/api";
import { shareOrDownload } from "../lib/device";
import { Icon } from "./Icon";

/**
 * Sends an item (or your daily reminders) to the phone's own Calendar app as a calendar file
 * with an alert, so the phone notifies you even when Limitless is closed.
 */
export function PhoneCalendarButton({ path, label = "Add to phone calendar (with alert)", primary = false }: { path: string; label?: string; primary?: boolean }) {
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      const { filename, text } = await api.get<{ filename: string; text: string }>(path);
      const how = await shareOrDownload(filename, text, "text/calendar");
      if (how === "shared") toast("Choose Save to Files, then open the file and tap Add All");
      if (how === "downloaded") toast("Calendar file downloaded — open it to add to your calendar");
    } catch (err) {
      toast(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button type="button" className={`btn block${primary ? " primary" : ""}`} onClick={go} disabled={busy}>
      <Icon name="bell" size={18} /> {busy ? "Preparing…" : label}
    </button>
  );
}
