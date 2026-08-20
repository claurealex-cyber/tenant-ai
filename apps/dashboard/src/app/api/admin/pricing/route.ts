import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * GET /api/admin/pricing — list all pricing tiers (admin only).
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const tiers = await prisma.pricingTier.findMany({
    orderBy: { sortOrder: "asc" },
    include: {
      _count: { select: { subscriptions: true } },
    },
  });

  return NextResponse.json({ tiers });
}

/**
 * POST /api/admin/pricing — create a new pricing tier (admin only).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { name, displayName, basePriceCents, includedAiCents, aiMarkupPercent } =
      body;

    if (!name || !displayName || basePriceCents === undefined || includedAiCents === undefined) {
      return NextResponse.json(
        { error: "name, displayName, basePriceCents, and includedAiCents are required" },
        { status: 400 }
      );
    }

    const tier = await prisma.pricingTier.create({
      data: {
        name,
        displayName,
        basePriceCents,
        includedAiCents,
        aiMarkupPercent: aiMarkupPercent ?? 50,
        maxProperties: body.maxProperties ?? null,
        maxPhoneNumbers: body.maxPhoneNumbers ?? null,
        websiteEnabled: body.websiteEnabled ?? true,
        customDomainEnabled: body.customDomainEnabled ?? false,
        description: body.description ?? null,
        sortOrder: body.sortOrder ?? 0,
      },
    });

    return NextResponse.json({ tier }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * PUT /api/admin/pricing — update a pricing tier (admin only).
 *
 * Body: { id, ...fields }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { id } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Whitelist allowed fields to prevent field injection
    const allowedFields = [
      "name", "displayName", "basePriceCents", "includedAiCents",
      "aiMarkupPercent", "maxProperties", "maxPhoneNumbers",
      "websiteEnabled", "customDomainEnabled", "description",
      "sortOrder", "isActive",
    ] as const;

    const updates: Record<string, unknown> = {};
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updates[field] = body[field];
      }
    }

    const tier = await prisma.pricingTier.update({
      where: { id },
      data: updates,
    });

    return NextResponse.json({ tier });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
