"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import SubscriptionCard from "@/components/billing/SubscriptionCard";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UsageByType {
  type: string;
  count: number;
  costCents: number;
  totalQuantity: number;
  totalDurationSeconds: number;
}

interface UsageData {
  billingMonth: string;
  usageByType: UsageByType[];
  totalAiCostCents: number;
  includedAiCents: number;
  estimatedOverageCents: number;
}

interface Invoice {
  id: string;
  billingMonth: string;
  basePriceCents: number;
  aiUsageCostCents: number;
  aiMarkupCents: number;
  totalCents: number;
  status: string;
  pdfUrl: string | null;
  paidAt: string | null;
  createdAt: string;
}

interface Tier {
  id: string;
  name: string;
  displayName: string;
  basePriceCents: number;
  includedAiCents: number;
  aiMarkupPercent: number;
  maxProperties: number;
  maxPhoneNumbers: number;
  websiteEnabled: boolean;
  customDomainEnabled: boolean;
  description: string | null;
  sortOrder: number;
}

interface SubscriptionDetail {
  id: string;
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  canceledAt: string | null;
  tier: {
    id: string;
    name: string;
    displayName: string;
    basePriceCents: number;
    includedAiCents: number;
    aiMarkupPercent: number;
    maxProperties: number;
    maxPhoneNumbers: number;
    websiteEnabled: boolean;
    customDomainEnabled: boolean;
  };
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatMonth(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function InvoiceStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    paid: "bg-green-100 text-green-700",
    failed: "bg-red-100 text-red-700",
    draft: "bg-gray-100 text-gray-700",
    finalized: "bg-blue-100 text-blue-700",
  };

  const labels: Record<string, string> = {
    paid: "Paid",
    failed: "Failed",
    draft: "Draft",
    finalized: "Finalized",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Usage Summary Section                                              */
/* ------------------------------------------------------------------ */

function UsageSummarySection() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadUsage() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/billing/usage");
        if (!res.ok) {
          setError("Failed to load usage data.");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setUsage(data);
      } catch {
        setError("Failed to load usage data.");
      } finally {
        setLoading(false);
      }
    }
    loadUsage();
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="mt-3 text-sm text-gray-500">Loading usage data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!usage) return null;

  const { totalAiCostCents, includedAiCents, estimatedOverageCents, usageByType } = usage;

  // Calculate progress percentage (capped at 100% for the bar, but label shows actual)
  const rawPercent =
    includedAiCents > 0
      ? (totalAiCostCents / includedAiCents) * 100
      : totalAiCostCents > 0
        ? 100
        : 0;

  const progressPercent = Math.min(100, rawPercent);

  const isOverIncluded = totalAiCostCents > includedAiCents;

  // Progress bar color: blue <80%, yellow 80-99%, red >=100%
  const progressBarColor =
    rawPercent >= 100
      ? "bg-red-500"
      : rawPercent >= 80
        ? "bg-yellow-500"
        : "bg-blue-600";

  // Extract usage breakdown by type
  function getUsageForType(type: string): UsageByType | undefined {
    return usageByType.find((u) => u.type === type);
  }

  const voiceUsage = getUsageForType("voice_call");
  const smsUsage = getUsageForType("sms");
  const webAppUsage = getUsageForType("web_app");
  const websiteVisitUsage = getUsageForType("website_visit");

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Usage Summary
      </h2>
      <p className="mb-1 text-xs text-gray-500">
        Billing period: {formatMonth(usage.billingMonth)}
      </p>

      {/* Progress Bar */}
      <div className="mb-4">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-sm font-medium text-gray-700">
            AI Usage: ${formatCents(totalAiCostCents)} / $
            {formatCents(includedAiCents)} included
          </span>
          <span className="text-sm text-gray-500">
            {includedAiCents > 0
              ? `${Math.round((totalAiCostCents / includedAiCents) * 100)}%`
              : "--"}
          </span>
        </div>
        <div className="h-3 w-full overflow-hidden rounded-full bg-gray-200">
          <div
            className={`h-full rounded-full transition-all ${progressBarColor}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Overage Warning */}
      {isOverIncluded && estimatedOverageCents > 0 && (
        <div className="mb-4 rounded-md bg-amber-50 border border-amber-200 p-3">
          <p className="text-sm text-amber-800">
            You have exceeded your included AI usage. Estimated overage charge:{" "}
            <span className="font-semibold">
              ${formatCents(estimatedOverageCents)}
            </span>
          </p>
        </div>
      )}

      {/* Breakdown Table */}
      <div className="overflow-hidden rounded-lg border border-gray-200">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Type
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Count
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Cost
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            <tr>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                Voice Calls
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                {voiceUsage?.count ?? 0}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
                ${formatCents(voiceUsage?.costCents ?? 0)}
              </td>
            </tr>
            <tr>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                SMS
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                {smsUsage?.count ?? 0}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
                ${formatCents(smsUsage?.costCents ?? 0)}
              </td>
            </tr>
            <tr>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                Web Apps
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                {webAppUsage?.count ?? 0}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-500">
                $0.00
              </td>
            </tr>
            <tr>
              <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                Website Visits
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                {websiteVisitUsage?.count ?? 0}
              </td>
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-500">
                $0.00
              </td>
            </tr>
          </tbody>
          <tfoot className="bg-gray-50">
            <tr>
              <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-gray-900">
                Total AI Cost
              </td>
              <td />
              <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-gray-900">
                ${formatCents(totalAiCostCents)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Invoice History Section                                            */
/* ------------------------------------------------------------------ */

function InvoiceHistorySection() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    async function loadInvoices() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/billing/invoices");
        if (!res.ok) {
          setError("Failed to load invoices.");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setInvoices(data.invoices || []);
      } catch {
        setError("Failed to load invoices.");
      } finally {
        setLoading(false);
      }
    }
    loadInvoices();
  }, []);

  if (loading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex items-center justify-center py-8">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
            <p className="mt-3 text-sm text-gray-500">Loading invoices...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Invoice History
      </h2>

      {invoices.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-sm text-gray-500">No invoices yet.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Period
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Base
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    AI Usage
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Markup
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    Total
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Status
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                    PDF
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {invoices.map((invoice) => (
                  <tr
                    key={invoice.id}
                    className="transition-colors hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                      {formatDate(invoice.createdAt)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-900">
                      {formatMonth(invoice.billingMonth)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                      ${formatCents(invoice.basePriceCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                      ${formatCents(invoice.aiUsageCostCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-gray-500">
                      ${formatCents(invoice.aiMarkupCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-medium text-gray-900">
                      ${formatCents(invoice.totalCents)}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <InvoiceStatusBadge status={invoice.status} />
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right text-sm">
                      {invoice.pdfUrl ? (
                        <a
                          href={invoice.pdfUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          Download
                        </a>
                      ) : (
                        <span className="text-gray-400">--</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Change Plan Modal                                                  */
/* ------------------------------------------------------------------ */

function ChangePlanModal({
  open,
  onClose,
  currentTierId,
  onPlanChanged,
}: {
  open: boolean;
  onClose: () => void;
  currentTierId: string | null;
  onPlanChanged: () => void;
}) {
  const [tiers, setTiers] = useState<Tier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmTier, setConfirmTier] = useState<Tier | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError("");
    setConfirmTier(null);
    setSubmitError("");

    fetch("/api/billing/tiers")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load plans.");
        return res.json();
      })
      .then((data) => {
        setTiers(data.tiers || []);
        setLoading(false);
      })
      .catch(() => {
        setError("Failed to load available plans.");
        setLoading(false);
      });
  }, [open]);

  async function handleChangePlan(tier: Tier) {
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch("/api/billing/subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tierId: tier.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setSubmitError(data.error || "Failed to change plan.");
        setSubmitting(false);
        return;
      }
      setSubmitting(false);
      setConfirmTier(null);
      onPlanChanged();
      onClose();
    } catch {
      setSubmitError("Failed to change plan. Please try again.");
      setSubmitting(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 transition-opacity"
        onClick={() => {
          if (!submitting) {
            setConfirmTier(null);
            onClose();
          }
        }}
      />

      {/* Confirmation Dialog */}
      {confirmTier ? (
        <div className="relative z-10 mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
          <h3 className="text-lg font-semibold text-gray-900">
            Confirm Plan Change
          </h3>
          <p className="mt-3 text-sm text-gray-600">
            Your plan will change to{" "}
            <span className="font-semibold">{confirmTier.displayName}</span> at $
            {formatCents(confirmTier.basePriceCents)}/mo. Prorated charges may
            apply.
          </p>
          {submitError && (
            <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {submitError}
            </div>
          )}
          <div className="mt-5 flex items-center justify-end gap-3">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              onClick={() => {
                setConfirmTier(null);
                setSubmitError("");
              }}
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              onClick={() => handleChangePlan(confirmTier)}
              disabled={submitting}
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Changing...
                </span>
              ) : (
                "Confirm Change"
              )}
            </button>
          </div>
        </div>
      ) : (
        /* Plan Selection Dialog */
        <div className="relative z-10 mx-4 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-gray-900">
              Change Plan
            </h3>
            <button
              type="button"
              className="rounded-md p-1 text-gray-400 hover:text-gray-600"
              onClick={onClose}
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="mt-3 text-sm text-gray-500">
                  Loading plans...
                </p>
              </div>
            </div>
          ) : error ? (
            <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {tiers.map((tier) => {
                const isCurrent = tier.id === currentTierId;
                const isUpgrade =
                  !isCurrent &&
                  currentTierId != null &&
                  tier.basePriceCents >
                    (tiers.find((t) => t.id === currentTierId)
                      ?.basePriceCents ?? 0);

                return (
                  <div
                    key={tier.id}
                    className={`rounded-lg border-2 p-4 ${
                      isCurrent
                        ? "border-blue-500 bg-blue-50"
                        : "border-gray-200 bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <h4 className="font-semibold text-gray-900">
                          {tier.displayName}
                        </h4>
                        <p className="mt-1 text-2xl font-bold text-gray-900">
                          ${formatCents(tier.basePriceCents)}
                          <span className="text-sm font-normal text-gray-500">
                            /mo
                          </span>
                        </p>
                      </div>
                      {isCurrent && (
                        <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                          Current Plan
                        </span>
                      )}
                    </div>

                    <ul className="mt-3 space-y-1.5 text-sm text-gray-600">
                      <li className="flex items-center gap-2">
                        <svg
                          className="h-4 w-4 flex-shrink-0 text-green-500"
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
                        ${formatCents(tier.includedAiCents)} AI included
                      </li>
                      <li className="flex items-center gap-2">
                        <svg
                          className="h-4 w-4 flex-shrink-0 text-green-500"
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
                        Up to {tier.maxProperties} properties
                      </li>
                      <li className="flex items-center gap-2">
                        <svg
                          className="h-4 w-4 flex-shrink-0 text-green-500"
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
                        Up to {tier.maxPhoneNumbers} phone numbers
                      </li>
                    </ul>

                    {tier.description && (
                      <p className="mt-2 text-xs text-gray-500">
                        {tier.description}
                      </p>
                    )}

                    <div className="mt-4">
                      {isCurrent ? (
                        <div className="w-full rounded-md bg-gray-100 px-4 py-2 text-center text-sm font-medium text-gray-500">
                          Current Plan
                        </div>
                      ) : (
                        <button
                          type="button"
                          className={`w-full rounded-md px-4 py-2 text-sm font-medium text-white ${
                            isUpgrade
                              ? "bg-blue-600 hover:bg-blue-700"
                              : "bg-gray-600 hover:bg-gray-700"
                          }`}
                          onClick={() => setConfirmTier(tier)}
                        >
                          {isUpgrade ? "Upgrade" : "Downgrade"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Cancel Subscription Section                                        */
/* ------------------------------------------------------------------ */

function CancelSubscriptionSection({
  subscription,
  onCanceled,
}: {
  subscription: SubscriptionDetail | null;
  onCanceled: () => void;
}) {
  const [showConfirm, setShowConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [canceledEndDate, setCanceledEndDate] = useState<string | null>(null);

  if (!subscription) return null;
  if (subscription.status === "canceled") {
    return (
      <div className="text-center">
        <p className="text-sm text-gray-500">
          Your subscription has been canceled
          {subscription.currentPeriodEnd && (
            <>
              {" "}and will end on{" "}
              <span className="font-medium text-gray-700">
                {formatDate(subscription.currentPeriodEnd)}
              </span>
            </>
          )}
          .
        </p>
      </div>
    );
  }

  async function handleCancel() {
    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/billing/subscription", {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to cancel subscription.");
        setSubmitting(false);
        return;
      }
      const data = await res.json();
      setCanceledEndDate(data.subscription?.currentPeriodEnd || null);
      setShowConfirm(false);
      setSubmitting(false);
      onCanceled();
    } catch {
      setError("Failed to cancel subscription. Please try again.");
      setSubmitting(false);
    }
  }

  if (canceledEndDate) {
    return (
      <div className="text-center">
        <div className="inline-flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-4 py-3">
          <svg
            className="h-5 w-5 text-amber-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
          <p className="text-sm text-amber-800">
            Your subscription will end on{" "}
            <span className="font-semibold">{formatDate(canceledEndDate)}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="text-center">
      {/* Confirmation Modal */}
      {showConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="fixed inset-0 bg-black/50 transition-opacity"
            onClick={() => {
              if (!submitting) setShowConfirm(false);
            }}
          />
          <div className="relative z-10 mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-gray-900">
              Cancel Subscription
            </h3>
            <p className="mt-3 text-sm text-gray-600">
              Are you sure? Canceling will suspend your account at the end of the
              current billing period.
            </p>
            {error && (
              <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {error}
              </div>
            )}
            <div className="mt-5 flex items-center justify-end gap-3">
              <button
                type="button"
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={() => setShowConfirm(false)}
                disabled={submitting}
              >
                Keep Subscription
              </button>
              <button
                type="button"
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                onClick={handleCancel}
                disabled={submitting}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Canceling...
                  </span>
                ) : (
                  "Yes, Cancel Subscription"
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        type="button"
        className="text-sm text-gray-500 underline hover:text-red-600"
        onClick={() => setShowConfirm(true)}
      >
        Cancel Subscription
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Payment Method Section                                             */
/* ------------------------------------------------------------------ */

function PaymentMethodSection({
  subscription,
}: {
  subscription: SubscriptionDetail | null;
}) {
  if (!subscription) return null;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Payment Method
      </h2>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-gray-100">
            <svg
              className="h-6 w-6 text-gray-500"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
              />
            </svg>
          </div>
          <div>
            <p className="text-sm font-medium text-gray-900">
              No payment method on file
            </p>
            <p className="text-xs text-gray-500">
              Managed through Stripe
            </p>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50"
          onClick={() => {
            alert(
              "To update your payment method, visit your Stripe billing portal."
            );
          }}
        >
          Update Payment Method
        </button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function BillingPage() {
  const [showChangePlan, setShowChangePlan] = useState(false);
  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(
    null
  );
  const [subLoading, setSubLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSubscription = useCallback(async () => {
    setSubLoading(true);
    try {
      const res = await fetch("/api/billing/subscription");
      if (res.ok) {
        const data = await res.json();
        setSubscription(data.subscription || null);
      }
    } catch {
      // Silently fail — SubscriptionCard handles its own loading
    } finally {
      setSubLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSubscription();
  }, [loadSubscription, refreshKey]);

  function handlePlanChanged() {
    setRefreshKey((k) => k + 1);
  }

  function handleCanceled() {
    setRefreshKey((k) => k + 1);
  }

  return (
    <DashboardShell>
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-bold text-gray-900">
        Billing & Subscription
      </h1>
      <SubscriptionCard key={refreshKey} />

      {/* Change Plan Button */}
      {!subLoading && subscription && subscription.status !== "canceled" && (
        <div className="mt-4">
          <button
            type="button"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            onClick={() => setShowChangePlan(true)}
          >
            Change Plan
          </button>
        </div>
      )}

      {/* Change Plan Modal */}
      <ChangePlanModal
        open={showChangePlan}
        onClose={() => setShowChangePlan(false)}
        currentTierId={subscription?.tier?.id ?? null}
        onPlanChanged={handlePlanChanged}
      />

      <div className="mt-8">
        <UsageSummarySection />
      </div>

      <div className="mt-8">
        <InvoiceHistorySection />
      </div>

      {/* Payment Method Section */}
      {!subLoading && subscription && (
        <div className="mt-8">
          <PaymentMethodSection subscription={subscription} />
        </div>
      )}

      {/* Cancel Subscription */}
      {!subLoading && subscription && (
        <div className="mt-8">
          <CancelSubscriptionSection
            subscription={subscription}
            onCanceled={handleCanceled}
          />
        </div>
      )}
    </div>
    </DashboardShell>
  );
}
