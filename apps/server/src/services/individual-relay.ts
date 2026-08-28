import { resolveConfig } from "@tenant-ai/shared";
import { prisma } from "../lib/prisma.js";
import { withGuiLock } from "../lib/gui-lock.js";
import { resolveSurveyLink, buildIntakeReply } from "../handlers/survey-intake.js";
import { relaySendWithGuards } from "./relay-guards.js";
import { rewriteForRelay } from "../routes/telnyx-sms.js";
import { setGroupViaApi, groupIdFromUrl } from "./textemall-api.js";
import { fireIndividualTrigger } from "./individual-trigger.js";
import { claimFire } from "./fire-ledger.js";

const E164 = /^\+1\d{10}$/;

export interface IndividualRelayJobData {
  propertyId: string;
  callerPhone: string;
  source: string;
}
export type IndividualRelayOutcome =
  | { via: "textemall"; status: number }
  | { via: "relay-fallback"; reason: string }
  | { via: "skipped"; reason: string };

/**
 * Pre-check used at WIRING time to decide enqueue-vs-relay (R1 truth table, cheap
 * half): the individual Text-Em-All path is attempted only when the channel is on,
 * the trigger is ARMED, and (if a test-whitelist is set) the number is on it.
 * Every other case → deliver via relay directly (no enqueue).
 */
export async function individualTextEmAllEligible(phone: string): Promise<boolean> {
  if ((await resolveConfig("sms_relay", "individual_channel")) !== "textemall") return false;
  if ((await resolveConfig("textemall", "individual_trigger_armed")) !== "true") return false;
  const wl = (await resolveConfig("textemall", "individual_test_numbers"))?.trim();
  if (wl) {
    const set = new Set(wl.split(",").map((s) => s.trim()).filter(Boolean));
    if (!set.has(phone)) return false;
  }
  return true;
}

/** True if this phone already got an individual Text-Em-All fire within the cooldown. */
async function firedRecently(phone: string, now: Date): Promise<boolean> {
  const mins = parseInt((await resolveConfig("textemall", "individual_cooldown_min")) || "60", 10);
  const since = new Date(now.getTime() - mins * 60_000);
  const row = await prisma.textEmAllFire.findFirst({
    where: { path: "individual", ref: phone, createdAt: { gte: since } },
    select: { id: true },
  });
  return !!row;
}

/**
 * The job body (M2). GUI-locked Iris sets the individual group to exactly this
 * number, then fires the trigger — and on ANY non-fire outcome (opted-out aside)
 * falls back to the RELAY so the caller always gets exactly one link (R1). Never
 * throws; returns the outcome. `deps` injectable for tests.
 */
export async function runIndividualRelay(
  data: IndividualRelayJobData,
  deps: {
    now?: Date;
    setGroup?: typeof setGroupViaApi;
    fire?: typeof fireIndividualTrigger;
    relay?: typeof relaySendWithGuards;
  } = {},
): Promise<IndividualRelayOutcome> {
  const now = deps.now ?? new Date();
  const setGroup = deps.setGroup ?? setGroupViaApi;
  const fire = deps.fire ?? fireIndividualTrigger;
  const relay = deps.relay ?? relaySendWithGuards;
  const phone = data.callerPhone;

  const property = await prisma.property.findUnique({
    where: { id: data.propertyId },
    select: { id: true, userId: true, name: true, twilioPhone: true },
  });
  if (!property) return { via: "skipped", reason: "property not found" };
  if (!E164.test(phone)) return { via: "skipped", reason: "no textable phone" };

  // Respect STOP on BOTH channels — never deliver a marketing link to an opt-out.
  if (await prisma.smsOptOut.findFirst({ where: { phone } })) return { via: "skipped", reason: "opted out" };
  // Business dedupe (F6/D): one individual delivery per phone per cooldown window.
  if (await firedRecently(phone, now)) return { via: "skipped", reason: "cooldown" };

  const group = (await resolveConfig("textemall", "individual_group")) ?? "2. leads 08-28-2026";
  const groupUrl = (await resolveConfig("textemall", "individual_group_url")) ?? undefined;
  const groupId = groupIdFromUrl(groupUrl);
  const { url, invite } = await resolveSurveyLink(property, phone);
  const text = buildIntakeReply({ name: property.name, intakeAutoReply: null }, url);
  const relayText = rewriteForRelay(text, property.name, property.twilioPhone ?? property.name);
  const doRelay = async (reason: string): Promise<IndividualRelayOutcome> => {
    await relay(phone, relayText, { kind: "caller", inviteId: invite.id });
    return { via: "relay-fallback", reason };
  };

  // Attempt Text-Em-All: GUI-locked group edit → verify → cap → fire.
  if (!groupId) return doRelay("no individual_group_url configured");
  // Always include the owner's check number (owner: text me every time it texts an
  // individual) so the owner gets a copy of every caller's link as a live delivery check.
  const ownerCheck = ((await resolveConfig("textemall", "always_include_phone")) ?? "+17084158984").trim();
  const digits = (s: string) => s.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
  const phones = ownerCheck && digits(ownerCheck) !== digits(phone) ? [phone, ownerCheck] : [phone];
  const edit = await withGuiLock("individual-relay", () => setGroup({ groupId, phones }));
  if (edit.status !== "ok") return doRelay(`group-set ${edit.status}`);

  const claim = await claimFire("individual", { ref: phone, now });
  if (!claim.allowed) return doRelay(`monthly cap ${claim.count}/${claim.cap}`);

  const res = await fire({ phone, dryRun: false });
  if (!res.fired) {
    // Armed-check flipped since enqueue, etc. — fall back so the link still lands.
    return doRelay(`trigger not fired (${(res as { reason?: string }).reason})`);
  }

  // Fired: settle briefly (F1 floor; instant Zap consumes the response) before the
  // queue lets the next caller re-point the group. Bounded + concurrency=1.
  const settleSec = parseInt((await resolveConfig("textemall", "individual_settle_sec")) || "30", 10);
  if (settleSec > 0) await new Promise((r) => setTimeout(r, settleSec * 1000));
  return { via: "textemall", status: res.status };
}

/**
 * Text-path helper (M4/F4): if the individual Text-Em-All path is eligible for
 * this number, enqueue the link delivery and return a reply that OMITS the URL
 * (the link comes via Text-Em-All / its relay fallback). Returns null when not
 * eligible, so the caller builds its normal link reply unchanged.
 */
export async function maybeIndividualLinkReply(
  property: { id: string; name: string },
  callerPhone: string,
  greeting: string | null,
): Promise<{ replies: string[]; shouldRespond: true; replyKind: "ai" } | null> {
  const E164local = /^\+1\d{10}$/;
  if (!E164local.test(callerPhone)) return null;
  if (!(await individualTextEmAllEligible(callerPhone))) return null;
  const { addJob } = await import("../jobs/scheduler.js");
  const minute = Math.floor(Date.now() / 60_000);
  await addJob(
    "individual-relay",
    { propertyId: property.id, callerPhone, source: "text" },
    { jobId: `ind:${callerPhone}:${minute}` },
  );
  const g = greeting?.trim();
  const msg = g
    ? `${g} We're texting you the application link now.`
    : `Thanks for reaching out to ${property.name}! We're texting you the application link shortly.`;
  return { replies: [msg], shouldRespond: true, replyKind: "ai" };
}

/**
 * Q&A-path helper (Option B): if the individual Text-Em-All path is eligible for
 * this number, enqueue the link delivery and return true (the caller then OMITS
 * the link from its relay reply). Returns false when not eligible → caller keeps
 * its normal behavior. Same eligibility + E164 + jobId-dedupe as the first-contact
 * wiring; the job itself handles cooldown, cap, opt-out, and relay-fallback.
 */
export async function enqueueIndividualIfEligible(
  propertyId: string,
  callerPhone: string,
  source: string,
): Promise<boolean> {
  const E164 = /^\+1\d{10}$/;
  if (!E164.test(callerPhone)) return false;
  if (!(await individualTextEmAllEligible(callerPhone))) return false;
  const { addJob } = await import("../jobs/scheduler.js");
  const minute = Math.floor(Date.now() / 60_000);
  await addJob(
    "individual-relay",
    { propertyId, callerPhone, source },
    { jobId: `ind:${callerPhone}:${minute}` },
  );
  return true;
}
