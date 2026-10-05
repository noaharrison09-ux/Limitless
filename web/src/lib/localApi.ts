/**
 * Runs the app's data layer on the phone: SQLite (compiled to WebAssembly) holds everything,
 * and the database file is saved to this device's storage (IndexedDB) after every change.
 */
import initSqlJs from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";
import { exportDb, inTransaction, openDb } from "../core/db";
import { createApp } from "../core/app";
import { handle } from "../core/router";

const IDB_NAME = "limitless";
const STORE = "files";
const KEY = "database.sqlite";

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function readSaved(): Promise<Uint8Array | null> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const req = d.transaction(STORE, "readonly").objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve(req.result ? new Uint8Array(req.result as ArrayBuffer) : null);
    req.onerror = () => reject(req.error);
  });
}

async function writeSaved(bytes: Uint8Array): Promise<void> {
  const d = await idb();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, "readwrite");
    t.objectStore(STORE).put(bytes.slice().buffer, KEY);
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
  });
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let dirty = false;

async function saveNow() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = null;
  if (!dirty || inTransaction()) return;
  dirty = false;
  try {
    await writeSaved(exportDb());
  } catch (err) {
    dirty = true;
    console.error("Couldn't save to this device", err);
  }
}

function scheduleSave() {
  dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 250);
}

let ready: Promise<ReturnType<typeof createApp>> | null = null;

function start() {
  ready ??= (async () => {
    const SQL = await initSqlJs({ locateFile: () => wasmUrl });
    const saved = await readSaved().catch(() => null);
    openDb(saved ? new SQL.Database(saved) : new SQL.Database(), { onWrite: scheduleSave });
    if (!saved) {
      dirty = true;
      await saveNow();
    }
    // Ask the browser not to clear this app's storage when space runs low.
    void navigator.storage?.persist?.().catch(() => false);
    // Save right away if the app is being closed or sent to the background.
    document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && void saveNow());
    window.addEventListener("pagehide", () => void saveNow());
    return createApp();
  })();
  return ready;
}

export async function localRequest(method: string, path: string, body?: unknown) {
  const app = await start();
  const res = await handle(app, method, path, body);
  if (method !== "GET") await saveNow();
  return res;
}

/** True when the browser has promised not to clear this app's data. */
export async function storageIsPersistent(): Promise<boolean> {
  return (await navigator.storage?.persisted?.()) ?? false;
}
