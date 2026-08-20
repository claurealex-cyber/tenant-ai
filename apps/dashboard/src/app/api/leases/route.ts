import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { logAudit } from "@tenant-ai/shared";

const IL_MIN_GRACE_DAYS = 5;

/**
 * GET /api/leases — list leases for the authenticated user's properties.
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");

  const where: Record<string, unknown> = {
    unit: { property: { userId: session.user.id } },
  };

  if (status) {
    where.status = status;
  }

  const leases = await prisma.lease.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    include: {
      tenant: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      unit: {
        include: {
          property: { select: { id: true, name: true } },
        },
      },
    },
  });

  return NextResponse.json({ leases });
}

/**
 * POST /api/leases — create a new lease.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const {
      unitId,
      tenantId,
      monthlyRent,
      securityDeposit,
      startDate,
      endDate,
      leaseType,
      lateFeeAmount,
      lateFeeGraceDays,
      rentDueDay,
      depositHoldingBank,
      depositHoldingAddress,
    } = body;

    if (!unitId || !tenantId || !monthlyRent || !startDate) {
      return NextResponse.json(
        { error: "unitId, tenantId, monthlyRent, and startDate are required" },
        { status: 400 },
      );
    }

    // Verify the unit belongs to this user
    const unit = await prisma.unit.findUnique({
      where: { id: unitId },
      include: {
        property: { select: { userId: true, cookCounty: true } },
      },
    });

    if (!unit || unit.property.userId !== session.user.id) {
      return NextResponse.json({ error: "Unit not found" }, { status: 404 });
    }

    // Check unit isn't already occupied
    const activeLeaseOnUnit = await prisma.lease.findFirst({
      where: { unitId, status: "active" },
    });

    if (activeLeaseOnUnit) {
      return NextResponse.json(
        { error: "This unit already has an active lease" },
        { status: 400 },
      );
    }

    // Verify tenant belongs to this landlord
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant || tenant.userId !== session.user.id) {
      return NextResponse.json({ error: "Tenant not found" }, { status: 404 });
    }

    // Validate dates
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;

    if (end && end <= start) {
      return NextResponse.json(
        { error: "End date must be after start date" },
        { status: 400 },
      );
    }

    // Enforce IL minimum grace period
    const graceDays = Math.max(lateFeeGraceDays ?? IL_MIN_GRACE_DAYS, IL_MIN_GRACE_DAYS);

    // Cook County enforcement
    const isCookCounty = unit.property.cookCounty;

    if (isCookCounty && securityDeposit) {
      const maxDeposit = Math.round(monthlyRent * 1.5);
      if (securityDeposit > maxDeposit) {
        return NextResponse.json(
          {
            error: `Security deposit cannot exceed 1.5x monthly rent ($${(maxDeposit / 100).toFixed(2)}) for Cook County properties`,
          },
          { status: 400 },
        );
      }
    }

    if (isCookCounty && lateFeeAmount) {
      // Cook County cap: $10 + 5% of rent exceeding $1000
      const { getCookCountyLateFeeMax } = await import("@tenant-ai/shared");
      const maxLateFee = getCookCountyLateFeeMax(monthlyRent);
      if (lateFeeAmount > maxLateFee) {
        return NextResponse.json(
          {
            error: `Late fee cannot exceed $${(maxLateFee / 100).toFixed(2)} for Cook County properties`,
          },
          { status: 400 },
        );
      }
    }

    const lease = await prisma.lease.create({
      data: {
        unitId,
        tenantId,
        monthlyRent,
        securityDeposit: securityDeposit || null,
        startDate: start,
        endDate: end,
        leaseType: leaseType || (end ? "fixed" : "month_to_month"),
        lateFeeAmount: lateFeeAmount || null,
        lateFeeGraceDays: graceDays,
        rentDueDay: rentDueDay || 1,
        depositHoldingBank: depositHoldingBank || null,
        depositHoldingAddress: depositHoldingAddress || null,
        depositReceivedDate: securityDeposit ? new Date() : null,
      },
    });

    await logAudit(prisma, {
      userId: session.user.id,
      action: "create_lease",
      resourceType: "Lease",
      resourceId: lease.id,
      metadata: { unitId, tenantId, monthlyRent } as any,
    });

    // Update unit status to occupied
    await prisma.unit.update({
      where: { id: unitId },
      data: { status: "occupied" },
    });

    return NextResponse.json({ lease }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
