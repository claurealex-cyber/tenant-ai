import { describe, it, expect, afterEach } from "vitest";
import {
  addCall,
  getCall,
  removeCall,
  type ActiveCall,
} from "../lib/call-registry.js";
import {
  getCallDurationMinutes,
  shouldWrapUp,
  isCallExpired,
  shouldProactiveReconnect,
  PROACTIVE_RECONNECT_MINUTES,
  WRAPUP_BUFFER_MINUTES,
} from "../handlers/call-handler.js";

function makeCall(
  overrides: Partial<ActiveCall> & { streamSid?: string } = {},
): ActiveCall {
  return {
    callSid: overrides.callSid ?? "CA_test",
    streamSid: overrides.streamSid ?? "MZ_test",
    twilioWs: null as any,
    openaiWs: null,
    applicationId: overrides.applicationId ?? "app_test",
    propertyId: overrides.propertyId ?? "prop_test",
    callerPhone: overrides.callerPhone ?? "+13125551234",
    callLogId: overrides.callLogId ?? "test-call-log-id",
    isTenant: overrides.isTenant ?? false,
    hasTourSlots: overrides.hasTourSlots ?? false,
    questions: overrides.questions ?? [],
    answerValidation: overrides.answerValidation ?? false,
    transcript: overrides.transcript ?? [],
    startTime: overrides.startTime ?? new Date(),
    reconnectCount: overrides.reconnectCount ?? 0,
  };
}

afterEach(() => {
  // Clean up any test calls
  for (const sid of [
    "MZ_recon_1",
    "MZ_recon_2",
    "MZ_dur_1",
    "MZ_dur_2",
    "MZ_dur_3",
    "MZ_wrap_1",
    "MZ_proactive",
  ]) {
    removeCall(sid);
  }
});

// ── Transcript Persistence ──

describe("Transcript persistence", () => {
  it("appends transcript entries to call transcript array", () => {
    const call = makeCall({ streamSid: "MZ_recon_1" });
    addCall("MZ_recon_1", call);

    const registered = getCall("MZ_recon_1")!;
    registered.transcript.push({
      role: "ai",
      content: "Hello, welcome!",
      timestamp: new Date(),
    });
    registered.transcript.push({
      role: "user",
      content: "Hi, I want to apply.",
      timestamp: new Date(),
    });

    expect(registered.transcript.length).toBe(2);
    expect(registered.transcript[0].role).toBe("ai");
    expect(registered.transcript[1].content).toBe(
      "Hi, I want to apply.",
    );
  });

  it("transcript persists through reconnect count increment", () => {
    const call = makeCall({ streamSid: "MZ_recon_2" });
    addCall("MZ_recon_2", call);

    const registered = getCall("MZ_recon_2")!;
    registered.transcript.push({
      role: "ai",
      content: "What is your name?",
      timestamp: new Date(),
    });

    // Simulate reconnection
    registered.reconnectCount++;
    registered.openaiWs = null;

    // Transcript survives reconnection
    expect(registered.transcript.length).toBe(1);
    expect(registered.reconnectCount).toBe(1);
    expect(registered.transcript[0].content).toBe(
      "What is your name?",
    );
  });
});

// ── Call Duration ──

describe("Call duration tracking", () => {
  it("calculates elapsed minutes correctly", () => {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const call = makeCall({
      streamSid: "MZ_dur_1",
      startTime: tenMinutesAgo,
    });
    addCall("MZ_dur_1", call);

    const elapsed = getCallDurationMinutes(call);
    expect(elapsed).toBeCloseTo(10, 0);
  });

  it("reports 0 minutes for just-started call", () => {
    const call = makeCall({ streamSid: "MZ_dur_2" });
    addCall("MZ_dur_2", call);

    const elapsed = getCallDurationMinutes(call);
    expect(elapsed).toBeLessThan(1);
  });
});

// ── Wrap-up Logic ──

describe("shouldWrapUp", () => {
  it("returns false when call is young", () => {
    const call = makeCall({ streamSid: "MZ_dur_3" });
    expect(shouldWrapUp(call, 15)).toBe(false);
  });

  it("returns true when within buffer of max", () => {
    const elapsed = 15 - WRAPUP_BUFFER_MINUTES; // 12 minutes
    const startTime = new Date(Date.now() - elapsed * 60 * 1000);
    const call = makeCall({
      streamSid: "MZ_wrap_1",
      startTime,
    });

    expect(shouldWrapUp(call, 15)).toBe(true);
  });

  it("returns true when at exactly max minus buffer", () => {
    const bufferMinutes = WRAPUP_BUFFER_MINUTES;
    const maxMinutes = 15;
    const startTime = new Date(
      Date.now() - (maxMinutes - bufferMinutes) * 60 * 1000,
    );
    const call = makeCall({ startTime });

    expect(shouldWrapUp(call, maxMinutes)).toBe(true);
  });
});

// ── Call Expiration ──

describe("isCallExpired", () => {
  it("returns false for active call within limit", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const call = makeCall({ startTime: fiveMinutesAgo });

    expect(isCallExpired(call, 15)).toBe(false);
  });

  it("returns true when max duration exceeded", () => {
    const sixteenMinutesAgo = new Date(Date.now() - 16 * 60 * 1000);
    const call = makeCall({ startTime: sixteenMinutesAgo });

    expect(isCallExpired(call, 15)).toBe(true);
  });

  it("returns true at exactly max duration", () => {
    const exactlyMax = new Date(Date.now() - 15 * 60 * 1000);
    const call = makeCall({ startTime: exactlyMax });

    expect(isCallExpired(call, 15)).toBe(true);
  });
});

// ── Proactive Reconnect ──

describe("shouldProactiveReconnect", () => {
  it("returns false before 45 minutes", () => {
    const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000);
    const call = makeCall({ startTime: twentyMinutesAgo });

    expect(shouldProactiveReconnect(call)).toBe(false);
  });

  it("returns true at 45 minutes", () => {
    const fortyFiveMinutesAgo = new Date(
      Date.now() - PROACTIVE_RECONNECT_MINUTES * 60 * 1000,
    );
    const call = makeCall({
      streamSid: "MZ_proactive",
      startTime: fortyFiveMinutesAgo,
    });

    expect(shouldProactiveReconnect(call)).toBe(true);
  });

  it("returns true after 45 minutes", () => {
    const fiftyMinutesAgo = new Date(Date.now() - 50 * 60 * 1000);
    const call = makeCall({ startTime: fiftyMinutesAgo });

    expect(shouldProactiveReconnect(call)).toBe(true);
  });
});

// ── Reconnection counter ──

describe("Reconnect counter", () => {
  it("increments reconnectCount on each reconnection", () => {
    const call = makeCall({ streamSid: "MZ_recon_1" });
    addCall("MZ_recon_1", call);

    const registered = getCall("MZ_recon_1")!;
    expect(registered.reconnectCount).toBe(0);

    registered.reconnectCount++;
    expect(registered.reconnectCount).toBe(1);

    registered.reconnectCount++;
    expect(registered.reconnectCount).toBe(2);
  });
});

// ── Constants ──

describe("Duration constants", () => {
  it("proactive reconnect is at 45 minutes", () => {
    expect(PROACTIVE_RECONNECT_MINUTES).toBe(45);
  });

  it("wrapup buffer is 3 minutes", () => {
    expect(WRAPUP_BUFFER_MINUTES).toBe(3);
  });
});
