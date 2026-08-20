import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/tenants/[id] — get tenant detail.
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

  const tenant = await prisma.tenant.findUnique({
    where: { id },
    include: {
      leases: {
        include: {
          unit: {
            include: {
              property: { select: { id: true, name: true, address: true } },
            },
          },
        },
        orderBy: { createdAt: "desc" },
      },
      payments: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
      notices: {
        orderBy: { createdAt: "desc" },
        take: 5,
      },
    },
  });

  if (!tenant || tenant.userId !== session.user.id) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Compute overdueBalance for each active lease
  for (const lease of tenant.leases) {
    if (lease.status === "active") {
      const charges = await prisma.rentCharge.findMany({
        where: {
          leaseId: lease.id,
          status: { in: ["unpaid", "partial"] },
          dueDate: { lt: new Date() },
        },
        select: { amount: true, paidAmount: true },
      });
      (lease as any).overdueBalance = charges.reduce(
        (sum, c) => sum + (c.amount - c.paidAmount), 0
      );
    }
  }

  return NextResponse.json({ tenant });
}

/**
 * PUT /api/tenants/[id] — update tenant info.
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

    const tenant = await prisma.tenant.findUnique({
      where: { id },
    });

    if (!tenant || tenant.userId !== session.user.id) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const body = await request.json();
    const { firstName, lastName, email, phone } = body;

    const data: Record<string, unknown> = {};
    if (firstName) data.firstName = firstName;
    if (lastName) data.lastName = lastName;
    if (phone !== undefined) data.phone = phone || null;

    if (email && email !== tenant.email) {
      // Check uniqueness
      const existing = await prisma.tenant.findUnique({
        where: {
          email_userId: {
            email,
            userId: session.user.id,
          },
        },
      });
      if (existing) {
        return NextResponse.json(
          { error: "A tenant with this email already exists" },
          { status: 409 },
        );
      }
      data.email = email;
    }

    const updated = await prisma.tenant.update({
      where: { id },
      data,
    });

    return NextResponse.json({ tenant: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
