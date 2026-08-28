import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { resolveSurveyLink, buildIntakeReply } from "../handlers/survey-intake.js";
import { relaySendWithGuards } from "./relay-guards.js";
import { rewriteForRelay } from "../routes/telnyx-sms.js";
import { sendTelnyxSms } from "./telnyx-client.js";
import { individualTextEmAllEligible } from "./individual-relay.js";
import { addJob } from "../jobs/scheduler.js";

export type CallerLinkResult =
  | { status: "sent" | "already_sent" }
  | { status: "cannot_text"; reason: string };

const E164 = /^\+1\d{10}$/;

/**
 * Text the application link (whatever the survey toggle selects) to a caller.
 * Shared by the voice tool (when_asked) and the end-of-call auto-send
 * (every_call). Skips known tenants, anonymous/blocked caller IDs and opted-out
 * numbers; idempotent per phone via the outstanding-invite + relay cooldown.
 */
export async function textLinkToCaller(opts: {
  property: { id: string; userId: string; name: string; twilioPhone: string | null };
  callerPhone: string;
  source: "voice_tool" | "call_end" | "call_start";
}): Promise<CallerLinkResult> {
  const { property, callerPhone } = opts;

  if (!E164.test(callerPhone)) {
    return { status: "cannot_text", reason: "no textable phone number (blocked or anonymous caller)" };
  }
  // Known tenant? Don't send a prospect application link.
  const tenant = await prisma.tenant.findFirst({ where: { phone: callerPhone, userId: property.userId } });
  if (tenant) return { status: "cannot_text", reason: "caller is an existing tenant" };

  const optedOut = await prisma.smsOptOut.findFirst({ where: { phone: callerPhone } });
  if (optedOut) return { status: "cannot_text", reason: "caller has opted out of texts" };

  // Individual Text-Em-All relay (toggle): when the channel is on, armed, and the
  // number is whitelisted (if a whitelist is set), hand the LINK delivery to the
  // queued job — it sets the group to this number, fires the trigger, and falls
  // back to the relay on any failure (R1). Every other case → relay below. jobId
  // dedupes webhook retries within the minute (R6).
  if (await individualTextEmAllEligible(callerPhone)) {
    const minute = Math.floor(Date.now() / 60_000);
    await addJob(
      "individual-relay",
      { propertyId: property.id, callerPhone, source: opts.source },
      { jobId: `ind:${callerPhone}:${minute}` },
    );
    return { status: "sent" };
  }

  const { url, invite } = await resolveSurveyLink(property, callerPhone);
  const text = buildIntakeReply({ name: property.name, intakeAutoReply: null }, url);

  const relayEnabled = (await resolveConfig("sms_relay", "enabled")) === "true";
  if (relayEnabled) {
    const outcome = await relaySendWithGuards(
      callerPhone,
      rewriteForRelay(text, property.name, property.twilioPhone ?? property.name),
      { kind: "caller", inviteId: invite.id },
    );
    if (outcome.status === "sent" || outcome.status === "deferred") return { status: "sent" };
    if (outcome.status === "skipped" && outcome.reason === "cooldown") return { status: "already_sent" };
    if (outcome.status === "skipped" && outcome.reason === "opted out") return { status: "cannot_text", reason: "caller has opted out of texts" };
    return { status: "cannot_text", reason: outcome.reason ?? "send failed" };
  }

  try {
    await sendTelnyxSms(property.twilioPhone ?? "", callerPhone, text);
    return { status: "sent" };
  } catch (err) {
    return { status: "cannot_text", reason: err instanceof Error ? err.message : String(err) };
  }
}
