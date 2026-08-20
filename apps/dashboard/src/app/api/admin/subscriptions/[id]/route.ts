import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/subscriptions/[id] — subscription detail (admin only).
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const subscription = await prisma.subscription.findUnique({
    where: { id },
    include: {
      user: {
        select: {
          id: true,
          name: true,
          email: true,
          companyName: true,
          _count: { select: { properties: true } },
        },
      },
      tier: true,
      invoices: {
        orderBy: { billingMonth: "desc" },
        take: 12,
      },
    },
  });

  if (!subscription) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  // Current month usage
  const now = new Date();
  const billingMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const usage = await prisma.usageRecord.groupBy({
    by: ["type"],
    where: {
      userId: subscription.userId,
      billingMonth,
    },
    _sum: { costCents: true, quantity: true },
  });

  return NextResponse.json({
    subscription,
    usage,
  });
}

/**
 * PUT /api/admin/subscriptions/[id] — update overrides (admin only).
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = await request.json();

    const existing = await prisma.subscription.findUnique({
      where: { id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
    }

    const updates: Record<string, unknown> = {};

    // Admin overrides
    if (body.overrideBasePriceCents !== undefined)
      updates.overrideBasePriceCents = body.overrideBasePriceCents;
    if (body.overrideAiMarkupPercent !== undefined)
      updates.overrideAiMarkupPercent = body.overrideAiMarkupPercent;
    if (body.overrideMaxProperties !== undefined)
      updates.overrideMaxProperties = body.overrideMaxProperties;
    if (body.overrideMaxPhoneNumbers !== undefined)
      updates.overrideMaxPhoneNumbers = body.overrideMaxPhoneNumbers;
    if (body.adminNotes !== undefined)
      updates.adminNotes = body.adminNotes;

    // Status changes (suspend/reactivate)
    if (body.status) {
      const valid = ["active", "suspended", "past_due", "canceled"];
      if (valid.includes(body.status)) {
        updates.status = body.status;
        if (body.status === "canceled") {
          updates.canceledAt = new Date();
        }
      }
    }

    const updated = await prisma.subscription.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({ subscription: updated });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
