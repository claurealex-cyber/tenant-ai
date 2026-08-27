import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { resolveSurveyLink, buildIntakeReply } from "../handlers/survey-intake.js";
import { relaySendWithGuards } from "./relay-guards.js";
import { rewriteForRelay } from "../routes/telnyx-sms.js";
import { sendTelnyxSms } from "./telnyx-client.js";

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
