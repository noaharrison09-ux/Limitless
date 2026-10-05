import { describe, expect, it } from "vitest";
import { applyRules, type IncomingEmail, type Rule } from "./email.ts";

const email = (over: Partial<IncomingEmail> = {}): IncomingEmail => ({
  fromName: "Ms. Rivera",
  fromAddr: "rivera@lincoln.k12.us",
  subject: "Quiz moved",
  text: "The chemistry quiz is now on Friday.",
  labels: [],
  bulk: false,
  ...over,
});

let id = 0;
const rule = (field: Rule["field"], pattern: string, enabled = 1): Rule => ({ id: ++id, field, pattern, label: null, enabled });

describe("applyRules", () => {
  it("matches senders by domain or name, case-insensitively", () => {
    expect(applyRules(email(), [rule("from", "@LINCOLN.k12.us")]).important).toBe(true);
    expect(applyRules(email(), [rule("from", "rivera")]).reason).toBe("From: rivera");
    expect(applyRules(email(), [rule("from", "coach")]).important).toBe(false);
  });

  it("supports comma-separated keyword lists", () => {
    expect(applyRules(email({ subject: "Practice cancelled" }), [rule("subject", "test, cancelled, deadline")]).important).toBe(true);
    expect(applyRules(email(), [rule("body", "friday")]).important).toBe(true);
    expect(applyRules(email(), [rule("any", "scholarship")]).important).toBe(false);
  });

  it("lets block rules win over matches", () => {
    const v = applyRules(email({ fromAddr: "noreply@lincoln.k12.us" }), [rule("from", "lincoln"), rule("block", "noreply@")]);
    expect(v).toEqual({ important: false, blocked: true, reason: null });
  });

  it("uses Gmail's Important label when asked", () => {
    expect(applyRules(email({ labels: ["\\Important"] }), [rule("gmail_important", "*")]).important).toBe(true);
    expect(applyRules(email({ labels: ["\\Inbox"] }), [rule("gmail_important", "*")]).important).toBe(false);
  });

  it("ignores disabled rules", () => {
    expect(applyRules(email(), [rule("from", "rivera", 0)]).important).toBe(false);
  });
});
