import { describe, it, expect } from "vitest";
import {
  normalizeIntakeStyle,
  decideIntakeStyle,
  resolveIntakeStyle,
  buildIntakeGreeting,
  isIntakeLinkRequest,
  DEFAULT_INTAKE_GREETING,
  INTAKE_QA_OFFER_LINE,
} from "../intake-style";

describe("normalizeIntakeStyle", () => {
  it("treats only link_and_qa (any case/spacing) as Q&A", () => {
    expect(normalizeIntakeStyle("link_and_qa")).toBe("link_and_qa");
    expect(normalizeIntakeStyle(" Link and QA ")).toBe("link_and_qa");
    expect(normalizeIntakeStyle("LINK-AND-QA")).toBe("link_and_qa");
    expect(normalizeIntakeStyle("link_only")).toBe("link_only");
    expect(normalizeIntakeStyle("")).toBe("link_only");
    expect(normalizeIntakeStyle(null)).toBe("link_only");
    expect(normalizeIntakeStyle("qa")).toBe("link_only");
    expect(normalizeIntakeStyle("true")).toBe("link_only");
  });
});

describe("decideIntakeStyle", () => {
  it("uses the configured greeting, falling back to the default", () => {
    expect(decideIntakeStyle("link_and_qa", "Hey there")).toEqual({ style: "link_and_qa", greeting: "Hey there" });
    expect(decideIntakeStyle("link_and_qa", "   ")).toEqual({ style: "link_and_qa", greeting: DEFAULT_INTAKE_GREETING });
    expect(decideIntakeStyle(null, null)).toEqual({ style: "link_only", greeting: DEFAULT_INTAKE_GREETING });
  });
});

describe("resolveIntakeStyle", () => {
  it("uses the injected reader in the right order", async () => {
    const calls: string[] = [];
    const cfg = await resolveIntakeStyle(async (ns, key) => {
      calls.push(`${ns}.${key}`);
      return key === "intake_style" ? "link_and_qa" : "Custom greeting";
    });
    expect(cfg).toEqual({ style: "link_and_qa", greeting: "Custom greeting" });
    expect(calls).toEqual(["sms_relay.intake_style", "sms_relay.intake_greeting"]);
  });
});

describe("buildIntakeGreeting", () => {
  it("is intro + link + fixed offer + STOP line", () => {
    const out = buildIntakeGreeting({ greeting: "Hi! Apply here:", link: "https://x.example/apply" });
    expect(out).toBe(`Hi! Apply here:\nhttps://x.example/apply\n\n${INTAKE_QA_OFFER_LINE}\n\nReply STOP to opt out.`);
  });
  it("does NOT contain the phrase rewriteForRelay rewrites twice by accident", () => {
    // buildIntakeGreeting DOES include 'Reply STOP to opt out.' (a link/greeting reply, rewritten once) — that's fine.
    // The invariant we care about elsewhere (Q&A answers) is tested in the server suite.
    const out = buildIntakeGreeting({ greeting: DEFAULT_INTAKE_GREETING, link: "https://x/y" });
    expect(out.match(/Reply STOP to opt out\./g)).toHaveLength(1);
  });
});

describe("isIntakeLinkRequest", () => {
  it("treats explicit link/apply requests as resends", () => {
    for (const t of [
      "link", "apply", "application", "form", "resend",
      "send me the link", "can you resend the link", "text me the application link",
      "apply online", "how do I apply online", "I want to apply", "ready to apply",
      "send it again link", "the link please",
    ]) expect(isIntakeLinkRequest(t)).toBe(true);
  });
  it("treats questions (even containing apply/application) as NOT link requests", () => {
    for (const t of [
      "application fee?", "how much is rent", "is the 2 bedroom available",
      "do you allow pets?", "what's the deposit", "can I tour it this weekend?",
      "how big is the unit", "", "   ",
    ]) expect(isIntakeLinkRequest(t)).toBe(false);
  });
});
