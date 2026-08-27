import { prisma } from "../lib/prisma.js";
import {
  generateSurveyToken,
  surveyInviteExpiry,
  buildSurveyUrl,
  resolveConfig,
  resolveSurveyModeConfig,
  resolveIntakeStyle,
  buildIntakeGreeting,
  isIntakeLinkRequest,
  fillSurveyFormUrl,
  type SurveyMode,
} from "@tenant-ai/shared";
import { handleIntakeQa } from "./intake-qa.js";
import type { SmsResult } from "./sms-handler.js";

/**
 * Resolve the public-facing base URL used to build survey links.
 *
 * The sms_relay.survey_base_url override (the tunnel domain, where Fastify
 * itself serves /survey/:token) is deliberately scoped: it wins only while the
 * relay is enabled or when the landlord has no live custom domain — a blanket
 * global-first override would hijack link generation for any future landlord
 * with a real custom domain, and the config outlives the relay.
 */
export async function resolvePublicBaseUrl(userId: string): Promise<string> {
  const wc = await prisma.websiteConfig.findUnique({
    where: { userId },
    select: { customDomain: true, subdomain: true },
  });
  const relayBase = (await resolveConfig("sms_relay", "survey_base_url"))?.trim();
  const relayEnabled = (await resolveConfig("sms_relay", "enabled")) === "true";

  if (wc?.customDomain && !relayEnabled) return `https://${wc.customDomain}`;
  if (relayBase) {
    const withScheme = /^https?:\/\//.test(relayBase) ? relayBase : `https://${relayBase}`;
    return withScheme.replace(/\/+$/, "");
  }
  const root = process.env.TENANT_SITE_ROOT_DOMAIN;
  if (wc?.customDomain) return `https://${wc.customDomain}`;
  if (wc?.subdomain && root) return `https://${wc.subdomain}.${root}`;
  return process.env.TENANT_SITE_URL || "http://localhost:3002";
}

/**
 * Return an existing unused, unexpired invite for this phone+property, or mint a
 * new one. Reusing keeps repeated texts from spamming new links and lets a
 * texter re-request the same link.
 */
export async function createOrReuseSurveyInvite(
  propertyId: string,
  phone: string,
  channel: string = "sms",
) {
  const now = new Date();
  // The DB allows exactly ONE outstanding invite per phone+property (partial
  // unique index SurveyInvite_phone_propertyId_outstanding_key — a race guard).
  // So the outstanding row is reused whatever its channel; when survey_mode has
  // flipped since it was minted, its channel is updated to what is being sent
  // NOW. The row therefore always reads "current outstanding invite, last sent
  // as <channel>"; per-send history lives in the OutboundRelayMessage ledger.
  const existing = await prisma.surveyInvite.findFirst({
    where: { propertyId, phone, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) {
    if (existing.channel === channel) return existing;
    return prisma.surveyInvite.update({ where: { id: existing.id }, data: { channel } });
  }
  return prisma.surveyInvite.create({
    data: {
      token: generateSurveyToken(),
      propertyId,
      phone,
      channel,
      expiresAt: surveyInviteExpiry(now),
    },
  });
}

/** SurveyInvite.channel value for rows that record a Google-Form send. */
export const GOOGLE_FORM_INVITE_CHANNEL = "google_form";

/**
 * The single outstanding (unused, unexpired) invite for this phone+property,
 * or null. The DB enforces at most one (partial unique index), so this is the
 * marker for "has this prospect been contacted yet" without a new column.
 */
export async function findOutstandingInvite(propertyId: string, phone: string) {
  return prisma.surveyInvite.findFirst({
    where: { propertyId, phone, usedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
}

export interface SurveyLink {
  url: string;
  kind: SurveyMode;
  invite: Awaited<ReturnType<typeof createOrReuseSurveyInvite>>;
}

/**
 * THE place that decides which survey link goes out — intake auto-replies,
 * the one-off send script and Zillow blasts all call this, so the
 * `sms_relay.survey_mode` toggle is honored everywhere or nowhere.
 *
 *   hosted      → mint/reuse a tokenized invite, link to <base>/survey/<token>
 *   google_form → the configured Google Form URL; a SurveyInvite row with
 *                 channel "google_form" is still recorded as the audit trail
 *                 (who was sent the form, when), but no Application will ever
 *                 be created from it — responses live in Google.
 *
 * A google_form request without a valid URL degrades to hosted (with a
 * warning) inside resolveSurveyModeConfig(); a broken link is never texted.
 */
export async function resolveSurveyLink(
  property: { id: string; userId: string; name?: string | null },
  phone: string,
): Promise<SurveyLink> {
  // Pass our resolveConfig explicitly: the decision must follow THIS process's
  // config source (and its test doubles), not a reference hidden inside shared.
  const cfg = await resolveSurveyModeConfig(resolveConfig);
  if (cfg.warning) {
    console.warn(`[survey-mode] ${cfg.warning}`);
  }

  if (cfg.mode === "google_form" && cfg.formUrl) {
    const invite = await createOrReuseSurveyInvite(property.id, phone, GOOGLE_FORM_INVITE_CHANNEL);
    const url = fillSurveyFormUrl(cfg.formUrl, {
      phone,
      property: property.name ?? undefined,
    });
    return { url, kind: "google_form", invite };
  }

  const invite = await createOrReuseSurveyInvite(property.id, phone);
  const baseUrl = await resolvePublicBaseUrl(property.userId);
  return { url: buildSurveyUrl(baseUrl, invite.token), kind: "hosted", invite };
}

/** Intake reply text: intro + link + mandatory opt-out line (A2P/TCPA). */
export function buildIntakeReply(
  property: { name: string; intakeAutoReply: string | null },
  url: string,
): string {
  const intro =
    property.intakeAutoReply?.trim() ||
    `Thanks for your interest in ${property.name}! Start your rental application here:`;
  return `${intro}\n${url}\n\nReply STOP to opt out.`;
}

/**
 * Handle an inbound SMS for a property with SMS-link intake enabled.
 *
 * First contact mints an invite and replies with the application link. A phone
 * that already completed an application within 30 days gets an acknowledgement
 * — never a fresh link ("thanks, just submitted!" must not trigger "apply
 * again"). Tenant free-text is persisted to SmsConversation for the dashboard
 * Messages tab, not forwarded to the owner.
 */
export async function handleSurveyIntake(
  property: { id: string; userId: string; name: string; intakeAutoReply: string | null },
  callerPhone: string,
  inboundMessage?: string,
): Promise<SmsResult> {
  // NOTE: the previous "completed application on file → acknowledge, don't
  // re-link" gate was removed by owner request — a prospect who texts should
  // always get the intro + application link, even if they applied before.

  // Style decision (Link only vs Link + Q&A). Read THIS process's config.
  const intake = await resolveIntakeStyle(resolveConfig);

  if (intake.style === "link_and_qa") {
    // First contact = no outstanding invite yet. Subsequent texts route to
    // link-resend (explicit request) or Q&A (a question).
    const outstanding = await findOutstandingInvite(property.id, callerPhone);
    if (outstanding && !isIntakeLinkRequest(inboundMessage)) {
      // A question while an invite is outstanding → Q&A (M3 answers). The apply
      // link the AI nudges MUST honor the survey toggle (Google Form vs hosted),
      // exactly like the greeting — one switch governs the link everywhere.
      const { url: link } = await resolveSurveyLink(property, callerPhone);
      const qa = await handleIntakeQa({
        property: { id: property.id, userId: property.userId, name: property.name },
        callerPhone,
        inboundMessage: (inboundMessage ?? "").trim(),
        link,
      });
      return qa;
    }
    // First contact, or an explicit "send the link" → greeting + link.
    const { url, invite } = await resolveSurveyLink(property, callerPhone);
    if (inboundMessage?.trim() && !invite.inboundMessage) {
      await prisma.surveyInvite
        .update({ where: { id: invite.id }, data: { inboundMessage: inboundMessage.trim().slice(0, 250) } })
        .catch(() => undefined);
    }
    return {
      replies: [buildIntakeGreeting({ greeting: intake.greeting, link: url })],
      shouldRespond: true,
      replyKind: "link",
    };
  }

  // ── Link only (default, unchanged) ──
  const { url, invite } = await resolveSurveyLink(property, callerPhone);
  const reply = buildIntakeReply(property, url);

  // Snapshot the FIRST inbound text onto the invite — SmsConversation is
  // purged 24h after last activity, and the opening inquiry ("is the 2br
  // still available?") is the message worth keeping. Later texts are usually
  // "thanks" / resend requests, so first-wins.
  if (inboundMessage?.trim() && !invite.inboundMessage) {
    await prisma.surveyInvite
      .update({
        where: { id: invite.id },
        data: { inboundMessage: inboundMessage.trim().slice(0, 250) },
      })
      .catch(() => undefined); // best-effort — never block the reply
  }

  return {
    replies: [reply],
    shouldRespond: true,
    replyKind: "link",
  };
}
