import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { resolveTenantContext } from "@/lib/tenant-context";
import { headers } from "next/headers";

/**
 * POST /api/auth/signup — create a new tenant account.
 *
 * Body: { firstName, lastName, email, phone, password, token? }
 *
 * If `token` is provided, validates a TenantInvite and uses the invite's
 * userId (landlord). Otherwise resolves the landlord from the request hostname.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { firstName, lastName, email, phone, password, token } = body;

    // ── Validate required fields ──────────────────────────────
    if (!firstName?.trim() || !lastName?.trim() || !email?.trim() || !password) {
      return NextResponse.json(
        { error: "firstName, lastName, email, and password are required." },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters." },
        { status: 400 }
      );
    }

    const trimmedEmail = email.trim().toLowerCase();

    let landlordUserId: string;

    // ── Resolve landlord context ──────────────────────────────
    if (token) {
      // Invite flow: validate the TenantInvite token
      const invite = await prisma.tenantInvite.findUnique({
        where: { token },
      });

      if (!invite) {
        return NextResponse.json(
          { error: "Invalid invite token." },
          { status: 400 }
        );
      }

      if (invite.acceptedAt) {
        return NextResponse.json(
          { error: "This invite has already been accepted." },
          { status: 400 }
        );
      }

      if (invite.expiresAt < new Date()) {
        return NextResponse.json(
          { error: "This invite has expired. Please contact your landlord for a new one." },
          { status: 400 }
        );
      }

      landlordUserId = invite.userId;

      // Mark invite as accepted
      await prisma.tenantInvite.update({
        where: { token },
        data: { acceptedAt: new Date() },
      });
    } else {
      // No token: resolve landlord from hostname
      const headersList = await headers();
      const hostname =
        headersList.get("x-forwarded-host") ||
        headersList.get("host") ||
        "localhost";

      const ctx = await resolveTenantContext(hostname);

      if (!ctx) {
        return NextResponse.json(
          { error: "Unable to determine property context. Please use an invite link or access from a valid domain." },
          { status: 400 }
        );
      }

      landlordUserId = ctx.userId;
    }

    // ── Check email uniqueness per landlord ───────────────────
    const existing = await prisma.tenant.findUnique({
      where: {
        email_userId: {
          email: trimmedEmail,
          userId: landlordUserId,
        },
      },
    });

    if (existing) {
      return NextResponse.json(
        { error: "An account with this email already exists." },
        { status: 409 }
      );
    }

    // ── Hash password and create tenant ───────────────────────
    const passwordHash = await bcrypt.hash(password, 12);

    const tenant = await prisma.tenant.create({
      data: {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: trimmedEmail,
        phone: phone?.trim() || null,
        passwordHash,
        userId: landlordUserId,
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    return NextResponse.json({ tenant }, { status: 201 });
  } catch (error) {
    console.error("[signup] Error:", error);
    return NextResponse.json(
      { error: "An unexpected error occurred. Please try again." },
      { status: 500 }
    );
  }
}
