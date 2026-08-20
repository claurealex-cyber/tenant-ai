"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

interface PricingTier {
  id: string;
  name: string;
  displayName: string;
  basePriceCents: number;
  includedAiCents: number;
  aiMarkupPercent: number;
  maxProperties: number | null;
  maxPhoneNumbers: number | null;
  websiteEnabled: boolean;
  customDomainEnabled: boolean;
  description: string | null;
}

export default function PlanSelector() {
  const router = useRouter();
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/billing/tiers")
      .then((res) => res.json())
      .then((data) => {
        setTiers(data.tiers || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load pricing tiers");
        setLoading(false);
      });
  }, []);

  async function selectPlan(tierId: string) {
    setSelecting(tierId);
    setError("");

    try {
      const res = await fetch("/api/billing/subscription", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to create subscription");
        setSelecting(null);
        return;
      }

      router.push("/onboarding");
    } catch {
      setError("Something went wrong");
      setSelecting(null);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <p className="text-gray-500">Loading plans...</p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div className="mb-6 rounded-md bg-red-50 p-3 text-center text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-3">
        {tiers.map((tier) => (
          <div
            key={tier.id}
            className={`rounded-lg border-2 bg-white p-6 shadow-sm ${
              tier.name === "growth"
                ? "border-blue-500"
                : "border-gray-200"
            }`}
          >
            {tier.name === "growth" && (
              <div className="mb-3 inline-block rounded-full bg-blue-100 px-3 py-1 text-xs font-medium text-blue-700">
                Most Popular
              </div>
            )}

            <h3 className="text-lg font-semibold text-gray-900">
              {tier.displayName}
            </h3>

            <div className="mt-2">
              <span className="text-3xl font-bold text-gray-900">
                ${(tier.basePriceCents / 100).toFixed(0)}
              </span>
              <span className="text-gray-500">/mo</span>
            </div>

            <p className="mt-2 text-sm text-gray-500">{tier.description}</p>

            <ul className="mt-5 space-y-3 text-sm">
              <Feature
                text={`$${(tier.includedAiCents / 100).toFixed(0)} AI usage included`}
              />
              <Feature
                text={`${tier.aiMarkupPercent}% markup on overage`}
              />
              <Feature
                text={
                  tier.maxProperties
                    ? `Up to ${tier.maxProperties} properties`
                    : "Unlimited properties"
                }
              />
              <Feature
                text={
                  tier.maxPhoneNumbers
                    ? `Up to ${tier.maxPhoneNumbers} phone numbers`
                    : "Unlimited phone numbers"
                }
              />
              <Feature
                text={tier.websiteEnabled ? "Tenant website" : "No website"}
                included={tier.websiteEnabled}
              />
              <Feature
                text={
                  tier.customDomainEnabled
                    ? "Custom domain"
                    : "No custom domain"
                }
                included={tier.customDomainEnabled}
              />
            </ul>

            <button
              onClick={() => selectPlan(tier.id)}
              disabled={selecting !== null}
              className={`mt-6 w-full rounded-md px-4 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                tier.name === "growth"
                  ? "bg-blue-600 text-white hover:bg-blue-700 focus:ring-blue-500"
                  : "bg-gray-100 text-gray-900 hover:bg-gray-200 focus:ring-gray-500"
              }`}
            >
              {selecting === tier.id
                ? "Starting trial..."
                : "Start 14-Day Free Trial"}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Feature({
  text,
  included = true,
}: {
  text: string;
  included?: boolean;
}) {
  return (
    <li className="flex items-start gap-2">
      {included ? (
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-green-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4.5 12.75l6 6 9-13.5"
          />
        </svg>
      ) : (
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-gray-300"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      )}
      <span className={included ? "text-gray-700" : "text-gray-400"}>
        {text}
      </span>
    </li>
  );
}
