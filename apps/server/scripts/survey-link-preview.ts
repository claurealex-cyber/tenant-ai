/**
 * Preview exactly what an intake text would send RIGHT NOW (real config, real
 * DB, no mocks) without texting anyone. Creates a throwaway invite for a
 * reserved preview phone and deletes it afterwards.
 *
 * Usage: tsx scripts/survey-link-preview.ts            (first active property)
 *        tsx scripts/survey-link-preview.ts "Ghem LLC 1"
 */
import { initConfigResolver, resolveConfig, resolveSurveyModeConfig, resolveIntakeStyle, buildIntakeGreeting } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";
import { prisma } from "../src/lib/prisma.js";
import { resolveSurveyLink, buildIntakeReply } from "../src/handlers/survey-intake.js";

const PREVIEW_PHONE = "+10000000000"; // never a real subscriber
initConfigResolver(prismaConfigStore);

const name = process.argv[2];
const property = await prisma.property.findFirst({
  where: { isActive: true, twilioPhone: { not: null }, ...(name ? { name } : {}) },
  select: { id: true, userId: true, name: true, intakeAutoReply: true },
});
if (!property) {
  console.error(name ? `No active property named "${name}"` : "No active property with a number");
  process.exit(1);
}

const cfg = await resolveSurveyModeConfig(resolveConfig);
console.log(`property:   ${property.name}`);
console.log(`requested:  ${cfg.requestedMode}   effective: ${cfg.mode}${cfg.warning ? `\n⚠ ${cfg.warning}` : ""}`);
try {
  const link = await resolveSurveyLink(property, PREVIEW_PHONE);
  console.log(`kind:       ${link.kind}   invite.channel: ${link.invite.channel}`);
  const intake = await resolveIntakeStyle(resolveConfig);
  console.log(`intake:     ${intake.style}`);
  console.log("--- reply text (current style) ---");
  if (intake.style === "link_and_qa") {
    console.log(buildIntakeGreeting({ greeting: intake.greeting, link: link.url }));
  } else {
    console.log(buildIntakeReply(property, link.url));
  }
  console.log("------------------");
} finally {
  await prisma.surveyInvite.deleteMany({ where: { phone: PREVIEW_PHONE, propertyId: property.id } });
  await prisma.$disconnect();
}
