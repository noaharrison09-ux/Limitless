import { openDb } from "../db.ts";
import { save } from "../settings.ts";

export function freshDb(timezone = "America/New_York") {
  const db = openDb(":memory:");
  save("prefs", { name: "Test", timezone, timezoneConfirmed: true, units: "lb" });
  return db;
}
