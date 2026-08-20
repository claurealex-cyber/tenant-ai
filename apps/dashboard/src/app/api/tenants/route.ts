import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import bcrypt from "bcrypt";
import crypto from "crypto";

/**
 * GET /api/tenants — list tenants for the authenticated landlord.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tenants = await prisma.tenant.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      leases: {
        where: { status: "active" },
        include: {
          unit: {
            include: {
              property: { select: { id: true, name: true } },
            },
          },
        },
        take: 1,
      },
    },
  });

  return NextResponse.json({ tenants });
}

/**
 * POST /api/tenants — create a new tenant account.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { firstName, lastName, email, phone, applicationId } = body;

    if (!firstName || !lastName || !email) {
      return NextResponse.json(
        { error: "First name, last name, and email are required" },
        { status: 400 },
      );
    }

    // Check if tenant already exists for this landlord
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

    // Generate temporary password
    const tempPassword = crypto.randomBytes(16).toString("hex");
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const tenant = await prisma.tenant.create({
      data: {
        firstName,
        lastName,
        email,
        phone: phone || null,
        passwordHash,
        userId: session.user.id,
      },
    });

    // If converting from an application, update the application status
    if (applicationId) {
      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: { property: { select: { userId: true } } },
      });

      if (application && application.property.userId === session.user.id) {
        await prisma.application.update({
          where: { id: applicationId },
          data: { status: "reviewed" },
        });
      }
    }

    return NextResponse.json({ tenant, tempPassword }, { status: 201 });
  } catch (err) {
    console.error("API error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
