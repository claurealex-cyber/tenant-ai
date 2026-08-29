import { resolveConfig } from "@tenant-ai/shared";
import { resolveZillowDelivery, resolveBroadcastMethod } from "./delivery-method.js";
import { individualChannelState } from "./individual-relay.js";

/**
 * Effective-delivery-path readout (M1). Computes, per lane, the path a message
 * ACTUALLY takes at runtime — reusing the SAME predicates the runtime uses
 * (resolveZillowDelivery, individualChannelState) so the readout can never drift
 * (P2). Renders the caveats that silently change the outcome (P3/P4/P5/S5/S6).
 * This is channel-level truth; per-caller guards (tenant, opt-out, cooldown,
 * outstanding invite) still apply and are surfaced as a footnote by the caller.
 */
export interface LaneStatus {
  lane: "zillow" | "individual";
  transport: "textemall" | "relay";
  method: "api" | "form";
  /** One-line human effective path. */
  effective: string;
  /** Conditions that block or alter delivery right now. */
  caveats: string[];
}
export interface RoutingStatus {
  zillow: LaneStatus;
  individual: LaneStatus;
  perCallerNote: string;
}

function relayLabel(relayEnabled: boolean): string {
  return relayEnabled ? "Apple iMessage relay" : "Telnyx SMS (relay disabled)";
}

/** True when survey_mode and the broadcast_message link kind disagree (S6). */
function messageModeMismatch(surveyMode: string | null, msg: string | null): boolean {
  if (!msg) return false;
  const hasForm = /docs\.google\.com\/forms/i.test(msg);
  if (surveyMode === "google_form") return !hasForm; // form mode but message has no Google Form link
  return hasForm; // hosted mode but message points at a Google Form
}

export async function resolveRoutingStatus(): Promise<RoutingStatus> {
  const relayEnabled = (await resolveConfig("sms_relay", "enabled")) === "true";
  const surveyMode = await resolveConfig("sms_relay", "survey_mode");
  const broadcastMessage = await resolveConfig("textemall", "broadcast_message");
  const msgMismatch = messageModeMismatch(surveyMode, broadcastMessage);

  // ── Zillow lane ──
  const z = await resolveZillowDelivery();
  const zAuto = (await resolveConfig("zillow", "auto_enabled")) === "true";
  const zArmed = (await resolveConfig("textemall", "trigger_armed")) === "true";
  const zCaveats: string[] = [];
  let zEffective: string;
  if (z.transport === "relay") {
    zEffective = relayLabel(relayEnabled);
  } else if (z.method === "api") {
    zEffective = "Text-Em-All (direct API)";
    if (msgMismatch) zCaveats.push("broadcast message link doesn't match survey mode");
  } else {
    zEffective = "Text-Em-All (Google Form → Zapier)";
    if (!zArmed) zCaveats.push("trigger NOT armed — broadcast will upload but not send");
  }
  if (!zAuto) zCaveats.push("auto-run is OFF — the Zillow workflow is idle");

  // ── Individual lane (governs inbound TEXTS and CALLS) ──
  const ind = await individualChannelState();
  const iMethod = await resolveBroadcastMethod("individual");
  const iCaveats: string[] = [];
  let iEffective: string;
  if (!ind.on) {
    iEffective = relayLabel(relayEnabled);
  } else if (!ind.armed) {
    iEffective = relayLabel(relayEnabled);
    iCaveats.push("channel is ON but NOT armed — currently using the relay");
  } else {
    iEffective = iMethod === "api" ? "Text-Em-All (direct API)" : "Text-Em-All (Google Form → Zapier)";
    iCaveats.push(`${relayLabel(relayEnabled)} is the guaranteed fallback if a send fails`);
    if (ind.whitelist.length) {
      iCaveats.push(`RESTRICTED to ${ind.whitelist.length} test number(s) — all other callers use the relay`);
    }
    if (iMethod === "api" && msgMismatch) iCaveats.push("broadcast message link doesn't match survey mode");
  }

  return {
    zillow: { lane: "zillow", transport: z.transport, method: z.method, effective: zEffective, caveats: zCaveats },
    individual: { lane: "individual", transport: ind.on ? "textemall" : "relay", method: iMethod, effective: iEffective, caveats: iCaveats },
    perCallerNote: "Per-caller: existing tenants, opt-outs, and the delivery cooldown still apply regardless of channel.",
  };
}
