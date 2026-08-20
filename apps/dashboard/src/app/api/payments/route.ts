import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/payments — list payments for the authenticated landlord.
 *
 * Query params:
 *   leaseId    — filter by lease
 *   tenantId   — filter by tenant
 *   status     — filter by status (pending|completed|failed|refunded)
 *   method     — filter by method (ach|card|cash|check)
 *   page/limit — pagination
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const leaseId = searchParams.get("leaseId");
  const tenantId = searchParams.get("tenantId");
  const status = searchParams.get("status");
  const method = searchParams.get("method");
  const page = parseInt(searchParams.get("page") || "1");
  const limit = parseInt(searchParams.get("limit") || "25");

  const where: any = {
    lease: {
      unit: {
        property: { userId: session.user.id },
      },
    },
  };

  if (leaseId) where.leaseId = leaseId;
  if (tenantId) where.tenantId = tenantId;
  if (status) where.status = status;
  if (method) where.method = method;

  const [payments, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        tenant: { select: { firstName: true, lastName: true } },
        lease: {
          select: {
            unit: {
              select: {
                unitNumber: true,
                property: { select: { name: true } },
              },
            },
          },
        },
      },
    }),
    prisma.payment.count({ where }),
  ]);

  const paymentsWithReceipt = payments.map((p) => ({
    ...p,
    receiptUrl:
      p.status === "completed" ? `/api/payments/${p.id}/receipt` : null,
  }));

  return NextResponse.json({
    payments: paymentsWithReceipt,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  });
}
