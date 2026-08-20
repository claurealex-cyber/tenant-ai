import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/subscriptions — list all subscriptions (admin only).
 */
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const status = request.nextUrl.searchParams.get("status");
  const tierId = request.nextUrl.searchParams.get("tierId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (tierId) where.tierId = tierId;

  const subscriptions = await prisma.subscription.findMany({
    where,
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          companyName: true,
        },
      },
      tier: {
        select: {
          name: true,
          displayName: true,
          basePriceCents: true,
        },
      },
      _count: { select: { invoices: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Calculate MRR
  const activeSubs = subscriptions.filter(
    (s) => s.status === "active" || s.status === "trialing"
  );
  const totalMrr = activeSubs.reduce(
    (sum, s) => sum + (s.overrideBasePriceCents ?? s.tier.basePriceCents),
    0
  );

  return NextResponse.json({
    subscriptions,
    summary: {
      total: subscriptions.length,
      active: activeSubs.length,
      totalMrrCents: totalMrr,
    },
  });
}
