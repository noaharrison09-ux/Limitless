import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { refreshAll } from "./lib/api";
import { autoSync } from "./lib/sync";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Refresh "today" when you come back to the app after a while, and pick up newly synced calendars.
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible") return;
  refreshAll();
  autoSync();
});
autoSync();

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  window.addEventListener("load", () => {
    // Relative path: registers under wherever the app is hosted (e.g. /Limitless/ on GitHub Pages).
    navigator.serviceWorker.register("./sw.js").catch((err) => console.warn("Service worker failed", err));
  });
}
