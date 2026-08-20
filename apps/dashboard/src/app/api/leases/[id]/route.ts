import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/leases/[id] — get lease detail.
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

  const lease = await prisma.lease.findUnique({
    where: { id },
    include: {
      tenant: {
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      },
      unit: {
        include: {
          property: { select: { id: true, name: true, userId: true } },
        },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      rentCharges: {
        orderBy: { dueDate: "desc" },
        take: 12,
      },
    },
  });

  if (!lease || lease.unit.property.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ lease });
}

/**
 * PUT /api/leases/[id] — update lease.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    const lease = await prisma.lease.findUnique({
      where: { id },
      include: {
        unit: {
          include: {
            property: { select: { userId: true } },
          },
        },
      },
    });

    if (!lease || lease.unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      endDate,
      leaseType,
      status,
      monthlyRent,
      lateFeeAmount,
      lateFeeGraceDays,
      rentDueDay,
      depositReceiptSent,
      moveOutDate,
      depositDeductions,
      depositReturnedDate,
    } = body;

    const data: Record<string, unknown> = {};

    if (endDate !== undefined) {
      data.endDate = endDate ? new Date(endDate) : null;
    }
    if (leaseType) data.leaseType = leaseType;
    if (monthlyRent) data.monthlyRent = monthlyRent;
    if (lateFeeAmount !== undefined) data.lateFeeAmount = lateFeeAmount;
    if (rentDueDay) data.rentDueDay = rentDueDay;
    if (depositReceiptSent !== undefined) data.depositReceiptSent = depositReceiptSent;
    if (moveOutDate) data.moveOutDate = new Date(moveOutDate);
    if (depositDeductions !== undefined) data.depositDeductions = depositDeductions;
    if (depositReturnedDate) data.depositReturnedDate = new Date(depositReturnedDate);

    if (lateFeeGraceDays !== undefined) {
      data.lateFeeGraceDays = Math.max(lateFeeGraceDays, 5);
    }

    if (status) {
      data.status = status;

      // If terminated, update unit to vacant
      if (status === "terminated" || status === "expired") {
        await prisma.unit.update({
          where: { id: lease.unitId },
          data: { status: "vacant" },
        });
      }
    }

    const updated = await prisma.lease.update({
      where: { id },
      data,
    });

    return NextResponse.json({ lease: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
