import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { STANDARD_APPLICATION_FIELDS } from "@tenant-ai/shared";

/**
 * GET /api/properties — list all properties for authenticated user.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const properties = await prisma.property.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      _count: {
        select: { applications: true, units: true },
      },
    },
  });

  return NextResponse.json({ properties });
}

/**
 * POST /api/properties — create a new property.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { name, address, unitCount, description, amenities } = body;

    if (!name || !address) {
      return NextResponse.json(
        { error: "Name and address are required" },
        { status: 400 }
      );
    }

    // Check subscription property limits
    const subscription = await prisma.subscription.findUnique({
      where: { userId: session.user.id },
      include: { tier: true },
    });

    if (subscription) {
      const maxProperties =
        subscription.overrideMaxProperties ?? subscription.tier.maxProperties;

      if (maxProperties !== null) {
        const currentCount = await prisma.property.count({
          where: { userId: session.user.id },
        });

        if (currentCount >= maxProperties) {
          return NextResponse.json(
            {
              error: `You've reached the limit of ${maxProperties} properties on your plan. Upgrade to add more.`,
            },
            { status: 403 }
          );
        }
      }
    }

    // Detect Cook County from address zip code
    let cookCounty = false;
    try {
      const { isAddressInCookCounty } = await import("@tenant-ai/shared");
      cookCounty = isAddressInCookCounty(address) ?? false;
    } catch {
      // Shared package import may fail in some test environments
    }

    const property = await prisma.property.create({
      data: {
        name,
        address,
        unitCount: unitCount || null,
        description: description || null,
        amenities: amenities || [],
        cookCounty,
        userId: session.user.id,
        isActive: false,
        questions: {
          createMany: {
            data: STANDARD_APPLICATION_FIELDS.map((q) => ({
              text: q.text,
              fieldKey: q.fieldKey,
              type: q.type,
              required: q.required,
              sortOrder: q.sortOrder,
              isStandard: true,
            })),
          },
        },
      },
      include: {
        questions: { orderBy: { sortOrder: "asc" } },
      },
    });

    return NextResponse.json({ property }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
