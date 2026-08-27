/**
 * One-off: send the survey link to a phone exactly the way an inbound
 * intake text would — invite mint/reuse, base-URL resolution, relay
 * rewrite, and the guarded ledgered send.
 *
 * Usage: tsx scripts/send-survey-once.ts +1XXXXXXXXXX
 */
import { initConfigResolver, resolveConfig } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";
import { prisma } from "../src/lib/prisma.js";
import { resolveSurveyLink, buildIntakeReply } from "../src/handlers/survey-intake.js";
import { rewriteForRelay } from "../src/routes/telnyx-sms.js";
import { relaySendWithGuards } from "../src/services/relay-guards.js";
import { sendTelnyxSms } from "../src/services/telnyx-client.js";

const to = process.argv[2];
if (!/^\+1\d{10}$/.test(to ?? "")) {
  console.error("Usage: tsx scripts/send-survey-once.ts +1XXXXXXXXXX");
  process.exit(1);
}

initConfigResolver(prismaConfigStore);

const property = await prisma.property.findFirst({
  where: { name: "Ghem LLC 1", isActive: true },
});
if (!property || !property.twilioPhone) {
  console.error("Ghem LLC 1 property not found or has no number");
  process.exit(1);
}

// Same link decision as intake auto-replies and Zillow blasts (survey_mode toggle).
const { url, kind, invite } = await resolveSurveyLink(property, to);
const reply = buildIntakeReply(property, url);

const relayEnabled = (await resolveConfig("sms_relay", "enabled")) === "true";
console.log({ to, url, kind, relayEnabled });

if (relayEnabled) {
  const outcome = await relaySendWithGuards(
    to,
    rewriteForRelay(reply, property.name, property.twilioPhone),
    { kind: "intake", inviteId: invite.id },
  );
  console.log("relay outcome:", outcome);
} else {
  await sendTelnyxSms(property.twilioPhone, to, reply);
  console.log("sent via Telnyx API");
}

await prisma.$disconnect();
