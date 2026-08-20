import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { tenantAuthOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";

/**
 * GET /api/portal/settings — tenant profile.
 */
export async function GET() {
  const session = await getServerSession(tenantAuthOptions);
  if (!session?.tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: session.tenant.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      phone: true,
      bankName: true,
      bankAccountLast4: true,
    },
  });

  return NextResponse.json({ tenant });
}

/**
 * PUT /api/portal/settings — update tenant profile.
 *
 * Body: { firstName?, lastName?, phone? }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(tenantAuthOptions);
    if (!session?.tenant) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();

    // Handle password change
    if (body.currentPassword && body.newPassword) {
      if (body.newPassword.length < 8) {
        return NextResponse.json(
          { error: "New password must be at least 8 characters" },
          { status: 400 }
        );
      }

      const tenant = await prisma.tenant.findUnique({
        where: { id: session.tenant.id },
        select: { passwordHash: true },
      });

      if (!tenant?.passwordHash) {
        return NextResponse.json(
          { error: "Password not set for this account" },
          { status: 400 }
        );
      }

      const valid = await bcrypt.compare(body.currentPassword, tenant.passwordHash);
      if (!valid) {
        return NextResponse.json(
          { error: "Current password is incorrect" },
          { status: 400 }
        );
      }

      const passwordHash = await bcrypt.hash(body.newPassword, 12);
      await prisma.tenant.update({
        where: { id: session.tenant.id },
        data: { passwordHash },
      });

      // If only password fields were sent, return success
      if (!body.firstName && !body.lastName && body.phone === undefined) {
        return NextResponse.json({ message: "Password updated successfully" });
      }
    }

    // Handle profile updates
    const updates: Record<string, unknown> = {};

    if (body.firstName?.trim()) updates.firstName = body.firstName.trim();
    if (body.lastName?.trim()) updates.lastName = body.lastName.trim();
    if (body.phone !== undefined) updates.phone = body.phone?.trim() || null;

    if (Object.keys(updates).length === 0 && !body.currentPassword) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    if (Object.keys(updates).length > 0) {
      const updated = await prisma.tenant.update({
        where: { id: session.tenant.id },
        data: updates,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          phone: true,
          bankName: true,
          bankAccountLast4: true,
        },
      });

      return NextResponse.json({ tenant: updated });
    }

    // Password was changed, return current tenant data
    const current = await prisma.tenant.findUnique({
      where: { id: session.tenant.id },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        bankName: true,
        bankAccountLast4: true,
      },
    });

    return NextResponse.json({ tenant: current, message: "Password updated successfully" });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
