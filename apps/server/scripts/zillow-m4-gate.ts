/** M4 applied-flip gate: invite → survey POST → lead must flip to applied. No SMS. */
import { initConfigResolver } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";
import { prisma } from "../src/lib/prisma.js";
import { createOrReuseSurveyInvite } from "../src/handlers/survey-intake.js";

initConfigResolver(prismaConfigStore);
const PROPERTY = "cmsq6pm030007w1sdnpxbj8et";
const PHONE = "+17086667788"; // synthetic — never texted
const base = `http://localhost:${process.env.SERVER_PORT || "3005"}`;

const phase = process.argv[2];

if (phase === "setup") {
  const run = await prisma.zillowImportRun.create({ data: { status: "done" } });
  const invite = await createOrReuseSurveyInvite(PROPERTY, PHONE);
  const lead = await prisma.zillowLead.create({
    data: {
      name: "M4 Flip Gate", nameKey: "m4 flip gate", phone: PHONE,
      propertyText: "M4 gate", propertyId: PROPERTY, firstContactAt: new Date(),
      status: "invited", inviteId: invite.id, importRunId: run.id,
    },
  });
  console.log(JSON.stringify({ leadId: lead.id, token: invite.token, runId: run.id }));
} else if (phase === "verify") {
  const lead = await prisma.zillowLead.findUnique({ where: { id: process.argv[3] } });
  console.log(JSON.stringify({ status: lead?.status }));
} else if (phase === "cleanup") {
  const lead = await prisma.zillowLead.findUnique({ where: { id: process.argv[3] } });
  if (lead?.inviteId) {
    const invite = await prisma.surveyInvite.findUnique({ where: { id: lead.inviteId } });
    if (invite?.applicationId) {
      await prisma.surveyInvite.update({ where: { id: invite.id }, data: { applicationId: null } });
      await prisma.application.delete({ where: { id: invite.applicationId } }).catch(() => undefined);
    }
    await prisma.zillowLead.delete({ where: { id: lead.id } });
    await prisma.surveyInvite.delete({ where: { id: invite!.id } }).catch(() => undefined);
    await prisma.zillowImportRun.delete({ where: { id: lead.importRunId } }).catch(() => undefined);
  }
  console.log("cleaned");
}
process.exit(0);
