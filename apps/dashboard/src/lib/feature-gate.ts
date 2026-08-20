/**
 * Feature gating — enforce tier limits and subscription status restrictions.
 */

import { prisma } from "./prisma";

export interface FeatureCheckResult {
  allowed: boolean;
  reason?: string;
}

/**
 * Check if a user can create a new property.
 */
export async function canCreateProperty(
  userId: string
): Promise<FeatureCheckResult> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    include: { tier: true },
  });

  if (!sub) {
    return { allowed: false, reason: "No active subscription" };
  }

  if (sub.status === "suspended" || sub.status === "canceled") {
    return { allowed: false, reason: "Subscription suspended" };
  }

  const maxProperties =
    sub.overrideMaxProperties ?? sub.tier.maxProperties;

  if (maxProperties === null) {
    return { allowed: true }; // unlimited
  }

  const count = await prisma.property.count({ where: { userId } });

  if (count >= maxProperties) {
    return {
      allowed: false,
      reason: `Property limit reached (${maxProperties}). Upgrade your plan.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a user can provision a new phone number.
 */
export async function canProvisionPhone(
  userId: string
): Promise<FeatureCheckResult> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    include: { tier: true },
  });

  if (!sub) {
    return { allowed: false, reason: "No active subscription" };
  }

  if (sub.status === "suspended" || sub.status === "canceled") {
    return { allowed: false, reason: "Subscription suspended" };
  }

  const maxPhones =
    sub.overrideMaxPhoneNumbers ?? sub.tier.maxPhoneNumbers;

  if (maxPhones === null) {
    return { allowed: true };
  }

  const count = await prisma.property.count({
    where: { userId, twilioPhone: { not: null } },
  });

  if (count >= maxPhones) {
    return {
      allowed: false,
      reason: `Phone number limit reached (${maxPhones}). Upgrade your plan.`,
    };
  }

  return { allowed: true };
}

/**
 * Check if a user can use a custom domain.
 */
export async function canUseCustomDomain(
  userId: string
): Promise<FeatureCheckResult> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
    include: { tier: true },
  });

  if (!sub) {
    return { allowed: false, reason: "No active subscription" };
  }

  if (!sub.tier.customDomainEnabled) {
    return {
      allowed: false,
      reason: "Custom domains require a higher tier plan",
    };
  }

  return { allowed: true };
}

/**
 * Check if a subscription allows write operations (create/update).
 * Read-only access is always allowed.
 */
export async function canWriteData(
  userId: string
): Promise<FeatureCheckResult> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!sub) {
    return { allowed: false, reason: "No active subscription" };
  }

  if (sub.status === "suspended" || sub.status === "canceled") {
    return {
      allowed: false,
      reason: "Your account is suspended. Update your payment method to restore access.",
    };
  }

  return { allowed: true };
}

/**
 * Get the subscription status for display (banners, warnings).
 */
export async function getSubscriptionStatus(userId: string): Promise<{
  status: string;
  trialDaysRemaining?: number;
  isPastDue: boolean;
  isSuspended: boolean;
} | null> {
  const sub = await prisma.subscription.findUnique({
    where: { userId },
  });

  if (!sub) return null;

  let trialDaysRemaining: number | undefined;
  if (sub.status === "trialing" && sub.trialEndsAt) {
    const diff = sub.trialEndsAt.getTime() - Date.now();
    trialDaysRemaining = Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  return {
    status: sub.status,
    trialDaysRemaining,
    isPastDue: sub.status === "past_due",
    isSuspended: sub.status === "suspended" || sub.status === "canceled",
  };
}
