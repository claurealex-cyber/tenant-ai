import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/dashboard/open-maintenance — latest 5 open/in-progress maintenance requests.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const requests = await prisma.maintenanceRequest.findMany({
    where: {
      property: { userId: session.user.id },
      status: { in: ["open", "in_progress"] },
    },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: {
      property: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ requests });
}
