import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/call-logs/[id] — get call log detail with transcript.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const callLog = await prisma.callLog.findUnique({
    where: { id },
    include: {
      property: { select: { id: true, name: true, userId: true } },
      application: {
        select: { id: true, fullName: true, status: true },
      },
    },
  });

  if (!callLog || callLog.property.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ callLog });
}
