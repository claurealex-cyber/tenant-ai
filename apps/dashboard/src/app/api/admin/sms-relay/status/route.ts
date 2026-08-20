import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

// GET: relay status snapshot. Ledger fields report null until the relay
// engine (OutboundRelayMessage) ships — the page renders those as "not deployed".
export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user || (session.user as any).role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    const [intakeProperties, outstandingInvites, optOutCount] = await Promise.all([
      prisma.property.count({ where: { smsIntakeEnabled: true } }),
      prisma.surveyInvite.count({
        where: { usedAt: null, expiresAt: { gt: now } },
      }),
      prisma.smsOptOut.count(),
    ]);

    // The relay send ledger lands with the relay engine milestone; report null
    // (not zero) so the UI can distinguish "no sends" from "engine not deployed".
    let ledger: { pending: number; failed: number; sent: number } | null = null;
    try {
      const anyPrisma = prisma as any;
      if (anyPrisma.outboundRelayMessage) {
        const [pending, failed, sent] = await Promise.all([
          anyPrisma.outboundRelayMessage.count({ where: { status: { in: ["pending", "deferred"] } } }),
          anyPrisma.outboundRelayMessage.count({ where: { status: "failed" } }),
          anyPrisma.outboundRelayMessage.count({ where: { status: "sent" } }),
        ]);
        ledger = { pending, failed, sent };
      }
    } catch {
      ledger = null;
    }

    return NextResponse.json({
      intakeProperties,
      outstandingInvites,
      optOutCount,
      ledger,
    });
  } catch (error) {
    console.error("SMS relay status GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
