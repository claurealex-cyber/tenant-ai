import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/dashboard/upcoming-tours — next 5 confirmed tour bookings.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const bookings = await prisma.tourBooking.findMany({
    where: {
      property: { userId: session.user.id },
      status: "confirmed",
      date: { gte: new Date() },
    },
    orderBy: { date: "asc" },
    take: 5,
    include: {
      property: { select: { id: true, name: true } },
    },
  });

  return NextResponse.json({ bookings });
}
