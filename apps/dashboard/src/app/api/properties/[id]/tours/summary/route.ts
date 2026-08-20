import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/tours/summary — tour summary for property detail tab.
 * Returns active slot count and upcoming bookings (max 5).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const property = await prisma.property.findFirst({
    where: { id, userId: session.user.id },
  });

  if (!property) {
    return NextResponse.json({ error: "Property not found" }, { status: 404 });
  }

  const [activeSlotCount, upcomingBookings] = await Promise.all([
    prisma.tourSlot.count({
      where: { propertyId: id, isActive: true },
    }),
    prisma.tourBooking.findMany({
      where: {
        propertyId: id,
        date: { gte: new Date() },
        status: { in: ["confirmed", "completed"] },
      },
      orderBy: { date: "asc" },
      take: 5,
    }),
  ]);

  return NextResponse.json({
    activeSlotCount,
    upcomingBookings,
  });
}
