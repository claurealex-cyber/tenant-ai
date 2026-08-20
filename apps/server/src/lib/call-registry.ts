import type WebSocket from "ws";
import type { TranscriptEntry, QuestionDefinition } from "@tenant-ai/shared";

export interface ActiveCall {
  callSid: string;
  streamSid: string;
  twilioWs: WebSocket;
  openaiWs: WebSocket | null;
  applicationId: string | null;
  propertyId: string;
  callerPhone: string;
  callLogId: string;
  isTenant: boolean;
  hasTourSlots: boolean;
  questions: QuestionDefinition[];
  answerValidation: boolean;
  transcript: TranscriptEntry[];
  startTime: Date;
  reconnectCount: number;
}

const activeCalls = new Map<string, ActiveCall>();

export function addCall(streamSid: string, call: ActiveCall): void {
  activeCalls.set(streamSid, call);
}

export function getCall(streamSid: string): ActiveCall | undefined {
  return activeCalls.get(streamSid);
}

/**
 * Find the live call for a caller's phone number (mid-call text answers are
 * correlated by the phone the applicant is calling from). Most recent call
 * wins if a stale entry somehow coexists.
 */
export function getCallByPhone(phone: string): ActiveCall | undefined {
  let best: ActiveCall | undefined;
  for (const call of activeCalls.values()) {
    if (call.callerPhone === phone) {
      if (!best || call.startTime > best.startTime) best = call;
    }
  }
  return best;
}

export function removeCall(streamSid: string): void {
  activeCalls.delete(streamSid);
}

export function getActiveCallCount(): number {
  return activeCalls.size;
}

export function getAllCalls(): Map<string, ActiveCall> {
  return activeCalls;
}

export function getCallByCallSid(callSid: string): ActiveCall | undefined {
  for (const call of activeCalls.values()) {
    if (call.callSid === callSid) return call;
  }
  return undefined;
}
