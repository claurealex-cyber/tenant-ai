import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/portal/lease — current lease details.
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const lease = await prisma.lease.findFirst({
    where: {
      tenantId: session.tenant.id,
      status: "active",
    },
    include: {
      unit: {
        include: {
          property: { select: { name: true, address: true } },
        },
      },
    },
  });

  if (!lease) {
    return NextResponse.json({ lease: null });
  }

  return NextResponse.json({
    lease: {
      id: lease.id,
      unitNumber: lease.unit.unitNumber,
      propertyName: lease.unit.property.name,
      propertyAddress: lease.unit.property.address,
      monthlyRent: lease.monthlyRent,
      securityDeposit: lease.securityDeposit,
      startDate: lease.startDate,
      endDate: lease.endDate,
      leaseType: lease.leaseType,
      rentDueDay: lease.rentDueDay,
      lateFeeAmount: lease.lateFeeAmount,
      lateFeeGraceDays: lease.lateFeeGraceDays,
      documentUrl: lease.documentUrl,
    },
  });
}
