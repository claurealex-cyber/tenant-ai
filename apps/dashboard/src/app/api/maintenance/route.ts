import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/maintenance — list maintenance requests for the authenticated landlord.
 *
 * Query params: propertyId, status, priority, category
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const params = request.nextUrl.searchParams;
  const propertyId = params.get("propertyId");
  const status = params.get("status");
  const priority = params.get("priority");
  const category = params.get("category");

  const where: Record<string, unknown> = {
    property: { userId: session.user.id },
  };

  if (propertyId) where.propertyId = propertyId;
  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (category) where.category = category;

  const requests = await prisma.maintenanceRequest.findMany({
    where,
    include: {
      property: { select: { id: true, name: true } },
      tenant: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Resolve unit numbers from the unitId field
  const unitIds = requests
    .map((r) => r.unitId)
    .filter((id): id is string => id !== null);
  const units =
    unitIds.length > 0
      ? await prisma.unit.findMany({
          where: { id: { in: unitIds } },
          select: { id: true, unitNumber: true },
        })
      : [];
  const unitMap = new Map(units.map((u) => [u.id, u.unitNumber]));

  const enriched = requests.map((r) => ({
    ...r,
    unitNumber: r.unitId ? unitMap.get(r.unitId) ?? null : null,
  }));

  return NextResponse.json({ requests: enriched });
}
