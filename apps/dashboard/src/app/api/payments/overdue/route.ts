import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/payments/overdue — list tenants with overdue rent charges.
 *
 * Returns tenants with unpaid/partial RentCharges past their due date,
 * sorted by amount owed (highest first).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();

  // Get all overdue rent charges for this landlord's properties
  const overdueCharges = await prisma.rentCharge.findMany({
    where: {
      status: { in: ["unpaid", "partial"] },
      dueDate: { lt: now },
      lease: {
        status: "active",
        unit: {
          property: { userId: session.user.id },
        },
      },
    },
    include: {
      lease: {
        select: {
          id: true,
          tenantId: true,
          tenant: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          unit: {
            select: {
              unitNumber: true,
              property: {
                select: { id: true, name: true },
              },
            },
          },
        },
      },
    },
  });

  // Group by tenant and calculate totals
  const tenantMap = new Map<
    string,
    {
      tenantId: string;
      tenantName: string;
      tenantEmail: string;
      propertyName: string;
      unitNumber: string;
      leaseId: string;
      amountOwed: number;
      oldestDueDate: Date;
      chargeCount: number;
    }
  >();

  for (const charge of overdueCharges) {
    const key = charge.lease.tenantId;
    const owed = charge.amount - charge.paidAmount;

    if (!tenantMap.has(key)) {
      tenantMap.set(key, {
        tenantId: charge.lease.tenantId,
        tenantName: `${charge.lease.tenant.firstName} ${charge.lease.tenant.lastName}`,
        tenantEmail: charge.lease.tenant.email,
        propertyName: charge.lease.unit.property.name,
        unitNumber: charge.lease.unit.unitNumber,
        leaseId: charge.lease.id,
        amountOwed: 0,
        oldestDueDate: charge.dueDate,
        chargeCount: 0,
      });
    }

    const entry = tenantMap.get(key)!;
    entry.amountOwed += owed;
    entry.chargeCount += 1;
    if (charge.dueDate < entry.oldestDueDate) {
      entry.oldestDueDate = charge.dueDate;
    }
  }

  // Sort by amount owed (highest first)
  const overdueTenants = Array.from(tenantMap.values()).sort(
    (a, b) => b.amountOwed - a.amountOwed
  );

  return NextResponse.json({ overdueTenants });
}
