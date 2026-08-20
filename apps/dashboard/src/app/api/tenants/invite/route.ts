import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import crypto from "crypto";

/**
 * POST /api/tenants/invite — send an invite to a tenant.
 * Creates a TenantInvite with a unique token (expires 72h).
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { email, propertyId, unitId } = body;

    if (!email || !propertyId) {
      return NextResponse.json(
        { error: "Email and propertyId are required" },
        { status: 400 },
      );
    }

    // Verify the property belongs to this user
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });

    if (!property || property.userId !== session.user.id) {
      return NextResponse.json({ error: "Property not found" }, { status: 404 });
    }

    // Generate unique invite token
    const token = crypto.randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 hours

    const invite = await prisma.tenantInvite.create({
      data: {
        token,
        email,
        userId: session.user.id,
        propertyId,
        unitId: unitId || null,
        expiresAt,
      },
    });

    return NextResponse.json({ invite }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
