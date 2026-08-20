import { prisma } from "../lib/prisma.js";
import {
  generateSurveyToken,
  surveyInviteExpiry,
  buildSurveyUrl,
  resolveConfig,
} from "@tenant-ai/shared";
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
export async function createOrReuseSurveyInvite(propertyId: string, phone: string) {
  const now = new Date();
  const existing = await prisma.surveyInvite.findFirst({
    where: { propertyId, phone, usedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
  });
  if (existing) return existing;
  return prisma.surveyInvite.create({
    data: {
      token: generateSurveyToken(),
      propertyId,
      phone,
      channel: "sms",
      expiresAt: surveyInviteExpiry(now),
    },
  });
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
): Promise<SmsResult> {
  // Completed application on file? Acknowledge, don't re-link.
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000);
  const completed = await prisma.application.findFirst({
    where: {
      propertyId: property.id,
      callerPhone,
      channel: "sms_link",
      status: { in: ["completed", "reviewed"] },
      completedAt: { gt: thirtyDaysAgo },
    },
  });
  if (completed) {
    return {
      replies: [
        `We received your application for ${property.name} and will be in touch soon. Reply STOP to opt out.`,
      ],
      shouldRespond: true,
      replyKind: "confirmation",
    };
  }

  const invite = await createOrReuseSurveyInvite(property.id, callerPhone);

  const baseUrl = await resolvePublicBaseUrl(property.userId);
  const url = buildSurveyUrl(baseUrl, invite.token);

  const intro =
    property.intakeAutoReply?.trim() ||
    `Thanks for your interest in ${property.name}! Start your rental application here:`;

  // Always include opt-out language for A2P/TCPA compliance.
  const reply = `${intro}\n${url}\n\nReply STOP to opt out.`;

  return {
    replies: [reply],
    shouldRespond: true,
    replyKind: "link",
  };
}
