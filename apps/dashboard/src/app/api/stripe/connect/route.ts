import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  createConnectAccount,
  createAccountLink,
  isAccountOnboarded,
} from "@/lib/stripe-connect";

/**
 * POST /api/stripe/connect — create a Stripe Connect Express account and
 * return the onboarding link URL.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      email: true,
      companyName: true,
      stripeConnectAccountId: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const baseUrl =
    body.baseUrl || process.env.NEXTAUTH_URL || "http://localhost:3000";

  let accountId = user.stripeConnectAccountId;

  // Create Connect account if not yet created
  if (!accountId) {
    accountId = await createConnectAccount({
      email: user.email,
      companyName: user.companyName,
    });

    if (!accountId) {
      return NextResponse.json(
        { error: "Stripe not configured" },
        { status: 503 }
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { stripeConnectAccountId: accountId },
    });
  }

  // Generate onboarding link
  const onboardingUrl = await createAccountLink({
    accountId,
    refreshUrl: `${baseUrl}/settings?stripe=refresh`,
    returnUrl: `${baseUrl}/settings?stripe=complete`,
  });

  if (!onboardingUrl) {
    return NextResponse.json(
      { error: "Failed to create onboarding link" },
      { status: 500 }
    );
  }

  return NextResponse.json({ accountId, onboardingUrl });
}

/**
 * GET /api/stripe/connect — check Connect account onboarding status.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      stripeConnectAccountId: true,
      stripeOnboardingComplete: true,
    },
  });

  if (!user?.stripeConnectAccountId) {
    return NextResponse.json({
      connected: false,
      accountId: null,
      onboardingComplete: false,
    });
  }

  // Check live status from Stripe if not already marked complete
  let onboardingComplete = user.stripeOnboardingComplete;
  if (!onboardingComplete) {
    const live = await isAccountOnboarded(user.stripeConnectAccountId);
    if (live) {
      onboardingComplete = true;
      await prisma.user.update({
        where: { id: session.user.id },
        data: { stripeOnboardingComplete: true },
      });
    }
  }

  return NextResponse.json({
    connected: true,
    accountId: user.stripeConnectAccountId,
    onboardingComplete,
  });
}
