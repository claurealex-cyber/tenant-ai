/**
 * Live gate driver: exercises the real internal endpoints over HTTP, secret
 * kept in-process. Usage: tsx scripts/zillow-live-gate.ts <action> [arg]
 * Actions: import | runs | leads | csv-head | unauth | seed-gate-lead |
 *          send-one <leadId> | lead-state <leadId>
 */
import { initConfigResolver, resolveConfig } from "@tenant-ai/shared";
import { prismaConfigStore } from "../src/lib/config-store.js";

initConfigResolver(prismaConfigStore);
const secret = await resolveConfig("sms_relay", "internal_secret");
if (!secret) { console.error("no internal secret configured"); process.exit(1); }
const base = `http://localhost:${process.env.SERVER_PORT || "3005"}`;
const headers = { "x-relay-secret": secret, "Content-Type": "application/json" };

const action = process.argv[2] || "import";

if (action === "import") {
  const r = await fetch(`${base}/internal/zillow/import`, { method: "POST", headers, body: "{}" });
  console.log(r.status, JSON.stringify(await r.json()));
} else if (action === "runs") {
  const r = await fetch(`${base}/internal/zillow/runs`, { headers });
  const d = await r.json();
  console.log(r.status, JSON.stringify(d.runs?.slice(0, 3)));
} else if (action === "leads") {
  const r = await fetch(`${base}/internal/zillow/leads`, { headers });
  const d = await r.json();
  const byStatus: Record<string, number> = {};
  for (const l of d.leads ?? []) byStatus[l.status] = (byStatus[l.status] ?? 0) + 1;
  console.log(r.status, "total:", d.leads?.length, "byStatus:", JSON.stringify(byStatus));
} else if (action === "csv-head") {
  const r = await fetch(`${base}/internal/zillow/leads.csv`, { headers });
  const text = await r.text();
  console.log(r.status, "| lines:", text.split("\n").length, "| header:", text.split("\n")[0]);
} else if (action === "unauth") {
  const r = await fetch(`${base}/internal/zillow/leads`, { headers: { "x-relay-secret": "wrong" } });
  console.log("unauth status:", r.status);
} else if (action === "seed-gate-lead") {
  const { prisma } = await import("../src/lib/prisma.js");
  const run = await prisma.zillowImportRun.create({ data: { status: "done" } });
  const lead = await prisma.zillowLead.create({
    data: {
      name: "Live Gate Test",
      nameKey: "live gate test",
      phone: "+13129752365",
      propertyText: "M3 live gate — operator phone",
      propertyId: "cmsq6pm030007w1sdnpxbj8et",
      firstContactAt: new Date(),
      status: "new",
      importRunId: run.id,
    },
  });
  console.log(JSON.stringify({ leadId: lead.id, runId: run.id }));
} else if (action === "send-one") {
  const leadId = process.argv[3];
  const r = await fetch(`${base}/internal/zillow/leads/${leadId}/send`, { method: "POST", headers, body: "{}" });
  console.log(r.status, JSON.stringify(await r.json()));
} else if (action === "lead-state") {
  const { prisma } = await import("../src/lib/prisma.js");
  const lead = await prisma.zillowLead.findUnique({ where: { id: process.argv[3] } });
  const ledger = lead?.inviteId
    ? await prisma.outboundRelayMessage.findFirst({ where: { inviteId: lead.inviteId }, orderBy: { createdAt: "desc" } })
    : null;
  const invite = lead?.inviteId ? await prisma.surveyInvite.findUnique({ where: { id: lead.inviteId } }) : null;
  console.log(JSON.stringify({
    status: lead?.status,
    sendError: lead?.sendError,
    ledger: ledger && { status: ledger.status, to: ledger.to, body: ledger.body.slice(0, 200) },
    token: invite?.token,
  }));
}
process.exit(0);
