import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/properties/[id]/tours/bookings — list tour bookings with optional status filter.
 */
export async function GET(
  request: NextRequest,
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

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const validStatuses = ["confirmed", "completed", "canceled", "no_show"];

  const where: Record<string, unknown> = { propertyId: id };
  if (status && validStatuses.includes(status)) {
    where.status = status;
  }

  const bookings = await prisma.tourBooking.findMany({
    where,
    orderBy: { date: "desc" },
  });

  return NextResponse.json({ bookings });
}
