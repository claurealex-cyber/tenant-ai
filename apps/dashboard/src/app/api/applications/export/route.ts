import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toCSV } from "@tenant-ai/shared";

/**
 * GET /api/applications/export — download applications as CSV.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const applications = await prisma.application.findMany({
    where: {
      property: { userId: session.user.id },
    },
    include: {
      property: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 10000,
  });

  const rows = applications.map((a) => ({
    date: a.createdAt.toISOString(),
    name: a.fullName || "",
    email: a.email || "",
    phone: a.callerPhone || "",
    property: a.property.name,
    channel: a.channel || "",
    status: a.status,
  }));

  const columns = [
    { key: "date", label: "Date" },
    { key: "name", label: "Name" },
    { key: "email", label: "Email" },
    { key: "phone", label: "Phone" },
    { key: "property", label: "Property" },
    { key: "channel", label: "Channel" },
    { key: "status", label: "Status" },
  ];

  const csv = toCSV(rows, columns);
  const today = new Date().toISOString().slice(0, 10);

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="applications-${today}.csv"`,
    },
  });
}
