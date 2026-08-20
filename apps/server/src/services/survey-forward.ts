import { prisma } from "../lib/prisma.js";
import { resolveConfig } from "@tenant-ai/shared";
import { relaySendWithGuards, sanitizeForSms } from "./relay-guards.js";

/**
 * Text the owner a summary of a completed survey application, via the relay.
 *
 * Minimal by default — SMS to a personal number transits carrier infra and
 * both parties' Messages history, so income/employer/email are included only
 * under the explicit forward_detail=full opt-in, and DOB never.
 */
export async function forwardSurveySummary(applicationId: string): Promise<void> {
  const forwardTo = await resolveConfig("sms_relay", "forward_to");
  if (!forwardTo || !/^\+1\d{10}$/.test(forwardTo)) return;

  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    include: { property: { select: { name: true } } },
  });
  if (!app) return;
  // Double-send guard: a repeated complete_application tool call (or a
  // concurrent completion path) must not text the owner twice.
  if (app.forwardedAt) return;

  const detail = (await resolveConfig("sms_relay", "forward_detail", "minimal")) || "minimal";
  const custom = (app.customResponses as Record<string, unknown> | null) ?? {};

  const firstName = sanitizeForSms(String(app.fullName ?? "unknown").split(/\s+/)[0] ?? "unknown", 30);
  const bedrooms = sanitizeForSms(String(custom["bedrooms_needed"] ?? "?"), 10);
  const contactPhone = typeof custom["contact_phone"] === "string" ? custom["contact_phone"] : null;

  const parts = [
    `New application (${sanitizeForSms(app.property.name, 40)}): ${firstName}, ${bedrooms}br.`,
    `Texted from: ${app.callerPhone ?? "unknown"}`,
  ];
  if (contactPhone && contactPhone !== app.callerPhone) {
    parts.push(`Self-reported contact (unverified): ${sanitizeForSms(contactPhone, 20)}`);
  }
  if (detail === "full") {
    if (app.monthlyIncome) parts.push(`Income: $${sanitizeForSms(app.monthlyIncome, 12)}/mo`);
    if (app.employer) parts.push(`Employer: ${sanitizeForSms(app.employer, 40)}`);
    if (app.email) parts.push(`Email: ${sanitizeForSms(app.email, 50)}`);
  }

  // Owner view page link (token-gated read-only page on the public URL)
  const ownerToken = await resolveConfig("sms_relay", "owner_view_token");
  const base = (await resolveConfig("sms_relay", "survey_base_url"))?.trim();
  if (ownerToken && base) {
    const withScheme = /^https?:\/\//.test(base) ? base : `https://${base}`;
    parts.push(`View all: ${withScheme.replace(/\/+$/, "")}/owner/${ownerToken}`);
  }

  const summary = parts.join(" ").slice(0, 600);

  const outcome = await relaySendWithGuards(forwardTo, summary, {
    kind: "forward",
    applicationId,
  });

  if (outcome.status === "sent") {
    await prisma.application.update({
      where: { id: applicationId },
      data: { forwardedAt: new Date() },
    });
  }
  // deferred/failed rows stay in the ledger; the sweep retries them and the
  // status panel surfaces them — forwardedAt stays null until a real send.
}

