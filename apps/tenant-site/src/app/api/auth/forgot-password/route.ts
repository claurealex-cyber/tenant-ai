import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { sendEmail, buildPasswordResetEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const { email } = await request.json();

    if (!email) {
      return NextResponse.json(
        { error: "Email is required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.toLowerCase().trim();

    // Always return success to prevent email enumeration
    const successMessage =
      "If an account exists with that email, a reset link has been sent.";

    // Find any tenant with this email (could be under any landlord)
    const tenant = await prisma.tenant.findFirst({
      where: { email: normalizedEmail },
    });

    if (!tenant) {
      return NextResponse.json({ message: successMessage });
    }

    // Generate reset token (64 hex chars = 32 bytes)
    const resetToken = randomBytes(32).toString("hex");
    const resetTokenExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await prisma.tenant.update({
      where: { id: tenant.id },
      data: { resetToken, resetTokenExpiry },
    });

    // Send password reset email
    const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3002";
    const resetUrl = `${baseUrl}/reset-password?token=${resetToken}`;
    await sendEmail({
      to: normalizedEmail,
      subject: "Password Reset Request",
      html: buildPasswordResetEmail(resetUrl),
    });

    return NextResponse.json({ message: successMessage });
  } catch (error: any) {
    console.error("Forgot password error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}
