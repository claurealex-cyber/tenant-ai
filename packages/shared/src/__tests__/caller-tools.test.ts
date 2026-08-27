import { describe, it, expect } from "vitest";
import { buildTools, buildPrompt, normalizeCallerLink, normalizeVoiceIntake } from "../index";

describe("caller config normalizers", () => {
  it("caller_link", () => {
    expect(normalizeCallerLink("when_asked")).toBe("when_asked");
    expect(normalizeCallerLink("every call")).toBe("every_call");
    expect(normalizeCallerLink("")).toBe("off");
    expect(normalizeCallerLink("yes")).toBe("off");
  });
  it("voice_intake", () => {
    expect(normalizeVoiceIntake("link")).toBe("link");
    expect(normalizeVoiceIntake("phone")).toBe("phone");
    expect(normalizeVoiceIntake(null)).toBe("phone");
  });
});

describe("text_application_link tool gating", () => {
  it("absent by default, present when callerLink", () => {
    expect(buildTools({}).some((t) => t.name === "text_application_link")).toBe(false);
    expect(buildTools({ callerLink: true }).some((t) => t.name === "text_application_link")).toBe(true);
  });
});

describe("voice prompt", () => {
  const base = {
    property: { name: "Acme", address: "1 St", amenities: [] as string[] },
    questions: [], application: null, channel: "voice" as const,
  };
  it("no offer-to-text line by default", () => {
    const p = buildPrompt(base);
    expect(p).not.toContain("offer to text");
    expect(p).not.toContain("text_application_link");
  });
  it("offer-to-text line when callerLink on", () => {
    const p = buildPrompt({ ...base, callerLink: true });
    expect(p).toContain("text_application_link");
  });
  it("voiceIntake=link removes application collection by voice", () => {
    const p = buildPrompt({ ...base, callerLink: true, voiceIntake: "link" });
    expect(p).toContain("Do NOT collect application details");
  });
});

describe("voice greeting script (voice_intake=link)", () => {
  const base = {
    property: { name: "Ghem Properties", address: "1 St", amenities: [] as string[] },
    questions: [], application: null, channel: "voice" as const,
  };
  const SCRIPT = "Hello, thank you for calling Ghem Properties. We are texting you a link...";
  it("uses voiceGreeting verbatim when voiceIntake=link", () => {
    const p = buildPrompt({ ...base, callerLink: true, voiceIntake: "link", voiceGreeting: SCRIPT });
    expect(p).toContain("Open the call by saying EXACTLY this");
    expect(p).toContain(SCRIPT);
    expect(p).toContain("Do NOT collect application details");
  });
  it("ignores voiceGreeting when voiceIntake=phone (default flow unchanged)", () => {
    const p = buildPrompt({ ...base, voiceIntake: "phone", voiceGreeting: SCRIPT });
    expect(p).not.toContain(SCRIPT);
  });
  it("empty voiceGreeting falls back to the generic greeting", () => {
    const p = buildPrompt({ ...base, callerLink: true, voiceIntake: "link", voiceGreeting: "   " });
    expect(p).toContain("Greet the caller warmly");
  });
  it("voiceIntake=link removes start_application from the SMS/voice tool set is not applicable here, but the prompt forbids it", () => {
    const p = buildPrompt({ ...base, callerLink: true, voiceIntake: "link", voiceGreeting: SCRIPT });
    expect(p).toContain("Never ask start_application");
  });
});
