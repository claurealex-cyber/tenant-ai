import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toCSV } from "@tenant-ai/shared";

/**
 * GET /api/call-logs/export — download call logs as CSV.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const callLogs = await prisma.callLog.findMany({
    where: {
      property: { userId: session.user.id },
    },
    include: {
      property: { select: { name: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 10000,
  });

  const rows = callLogs.map((c) => ({
    date: c.startedAt.toISOString(),
    phone: c.callerPhone || "",
    property: c.property.name,
    channel: c.channel || "",
    duration: c.duration != null ? String(c.duration) : "",
    cost: c.estimatedCostCents != null ? (c.estimatedCostCents / 100).toFixed(2) : "",
  }));

  const columns = [
    { key: "date", label: "Date" },
    { key: "phone", label: "Phone" },
    { key: "property", label: "Property" },
    { key: "channel", label: "Channel" },
    { key: "duration", label: "Duration (s)" },
    { key: "cost", label: "Cost ($)" },
  ];

  const csv = toCSV(rows, columns);
  const today = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="call-logs-${today}.csv"`,
    },
  });
}
