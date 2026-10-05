import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Each test file gets its own throwaway data dir (for the encryption key) before app modules load.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "limitless-test-"));
process.env.DISABLE_SCHEDULER = "1";
process.env.APP_PASSWORD = "test-password";
