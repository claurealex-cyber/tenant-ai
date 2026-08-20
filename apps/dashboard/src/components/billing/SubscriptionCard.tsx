"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

interface Subscription {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  tier: {
    displayName: string;
    basePriceCents: number;
  };
}

export default function SubscriptionCard() {
  const [subscription, setSubscription] = useState<Subscription | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/billing/subscription")
      .then((res) => res.json())
      .then((data) => {
        setSubscription(data.subscription);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-500">Loading subscription...</p>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="font-semibold text-gray-900">No active subscription</h3>
        <p className="mt-1 text-sm text-gray-500">
          Choose a plan to get started.
        </p>
        <Link
          href="/billing/choose-plan"
          className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Choose Plan
        </Link>
      </div>
    );
  }

  const statusColors: Record<string, string> = {
    trialing: "bg-yellow-100 text-yellow-800",
    active: "bg-green-100 text-green-800",
    past_due: "bg-red-100 text-red-800",
    canceled: "bg-gray-100 text-gray-800",
    suspended: "bg-red-100 text-red-800",
  };

  const trialDaysLeft = subscription.trialEndsAt
    ? Math.max(
        0,
        Math.ceil(
          (new Date(subscription.trialEndsAt).getTime() - Date.now()) /
            (1000 * 60 * 60 * 24)
        )
      )
    : null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">
            {subscription.tier.displayName} &mdash; $
            {(subscription.tier.basePriceCents / 100).toFixed(0)}/mo
          </h3>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${statusColors[subscription.status] || "bg-gray-100 text-gray-800"}`}
            >
              {subscription.status === "trialing"
                ? `Trial${trialDaysLeft !== null ? ` — ${trialDaysLeft} days left` : ""}`
                : subscription.status.replace("_", " ")}
            </span>
          </div>
        </div>

        <Link
          href="/billing/choose-plan"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
        >
          Change Plan
        </Link>
      </div>
    </div>
  );
}
