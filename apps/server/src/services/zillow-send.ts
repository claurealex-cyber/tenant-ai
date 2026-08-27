import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { resolveSurveyLink } from "../handlers/survey-intake.js";
import { relaySendWithGuards } from "./relay-guards.js";
import { sendTelnyxSms } from "./telnyx-client.js";
import { prettyPhone } from "../routes/telnyx-sms.js";

/**
 * Send the survey link to Zillow leads.
 *
 * Copy is Zillow-specific: these people never texted us, so the relay's usual
 * "(you texted …)" identity line would be false. They inquired on Zillow — say
 * that, and point STOP at the Telnyx number (the only number that processes
 * STOP), exactly like the relay rewrite does.
 *
 * Pacing is the relay guards' job (hourly/daily caps, cooldown, opt-out,
 * ledger). This module maps outcomes onto lead lifecycle state and never
 * bypasses a guard.
 */

export const BATCH_MAX_AGE_DAYS = 60;

export interface SendOutcome {
  leadId: string;
  result: "sent" | "deferred" | "skipped" | "failed";
  detail?: string;
}

export function zillowLeadCopy(propertyName: string, url: string, stopNumber: string): string {
  return (
    `${propertyName} (you inquired on Zillow): Thanks for your interest! ` +
    `Start your rental application here:\n${url}\n\nTo opt out, text STOP to ${prettyPhone(stopNumber)}.`
  );
}

/** Send to one lead. Enforces the lead-side state machine before any guard runs. */
export async function sendSurveyToLead(leadId: string): Promise<SendOutcome> {
  const lead = await prisma.zillowLead.findUnique({ where: { id: leadId } });
  if (!lead) return { leadId, result: "skipped", detail: "not found" };
  if (lead.status !== "new") return { leadId, result: "skipped", detail: `status is ${lead.status}` };
  if (!lead.phone) return { leadId, result: "skipped", detail: "no phone" };
  if (!lead.propertyId) return { leadId, result: "skipped", detail: "no matched property" };

  const property = await prisma.property.findUnique({
    where: { id: lead.propertyId },
    select: { id: true, userId: true, name: true, twilioPhone: true, isActive: true },
  });
  if (!property?.isActive || !property.twilioPhone) {
    return { leadId, result: "skipped", detail: "property inactive or has no number" };
  }

  // Honors sms_relay.survey_mode (hosted survey vs Google Form).
  const { url, invite } = await resolveSurveyLink(property, lead.phone);
  const text = zillowLeadCopy(property.name, url, property.twilioPhone);

  const relayEnabled = (await resolveConfig("sms_relay", "enabled")) === "true";

  if (relayEnabled) {
    const outcome = await relaySendWithGuards(lead.phone, text, { kind: "link", inviteId: invite.id });
    if (outcome.status === "sent" || outcome.status === "deferred") {
      await prisma.zillowLead.update({
        where: { id: lead.id },
        data: { status: "invited", inviteId: invite.id, sendError: null },
      });
      return { leadId, result: outcome.status === "sent" ? "sent" : "deferred" };
    }
    if (outcome.status === "skipped" && outcome.reason === "opted out") {
      await prisma.zillowLead.update({ where: { id: lead.id }, data: { status: "opted_out", sendError: null } });
      return { leadId, result: "skipped", detail: "opted out" };
    }
    // cooldown / duplicate-in-flight / hard failure: lead stays sendable with
    // the reason visible so the operator can retry.
    await prisma.zillowLead.update({
      where: { id: lead.id },
      data: { sendError: (outcome.reason ?? "send failed").slice(0, 200) },
    });
    return { leadId, result: outcome.status === "skipped" ? "skipped" : "failed", detail: outcome.reason };
  }

  // Direct Telnyx path (post-10DLC). No relay ledger — a throw is a failure.
  try {
    await sendTelnyxSms(property.twilioPhone, lead.phone, text);
    await prisma.zillowLead.update({
      where: { id: lead.id },
      data: { status: "invited", inviteId: invite.id, sendError: null },
    });
    return { leadId, result: "sent" };
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 200);
    await prisma.zillowLead.update({ where: { id: lead.id }, data: { sendError: detail } });
    return { leadId, result: "failed", detail };
  }
}

export interface BatchResult {
  eligible: number;
  sent: number;
  deferred: number;
  skipped: number;
  failed: number;
  outcomes: SendOutcome[];
}

/**
 * Queue the survey for every sendable lead. Default scope: first contact
 * within BATCH_MAX_AGE_DAYS (or unknown-date leads, which are all recent — the
 * extraction window itself only reaches back ~7 weeks). Caps make most of a
 * large batch "deferred"; the sweep drains those over the following days.
 */
export async function sendSurveyBatch(
  opts: { includeOlder?: boolean; propertyId?: string; sinceDate?: Date } = {},
): Promise<BatchResult> {
  const cutoff = new Date(Date.now() - BATCH_MAX_AGE_DAYS * 86_400_000);
  // The automation baseline (first-enable blast guard): only leads discovered
  // on/after this date are auto-sendable. Applies on top of the age window.
  const since = opts.sinceDate;
  const leads = await prisma.zillowLead.findMany({
    where: {
      status: "new",
      phone: { not: null },
      propertyId: opts.propertyId ? opts.propertyId : { not: null },
      ...(opts.includeOlder ? {} : { OR: [{ firstContactAt: { gte: cutoff } }, { firstContactAt: null }] }),
      ...(since
        ? {
            AND: [
              {
                OR: [
                  { firstContactAt: { gte: since } },
                  { firstContactAt: null, createdAt: { gte: since } },
                ],
              },
            ],
          }
        : {}),
    },
    orderBy: { firstContactAt: "desc" },
  });

  const result: BatchResult = { eligible: leads.length, sent: 0, deferred: 0, skipped: 0, failed: 0, outcomes: [] };
  for (const lead of leads) {
    const outcome = await sendSurveyToLead(lead.id);
    result.outcomes.push(outcome);
    if (outcome.result === "sent") result.sent++;
    else if (outcome.result === "deferred") result.deferred++;
    else if (outcome.result === "skipped") result.skipped++;
    else result.failed++;
  }
  return result;
}
