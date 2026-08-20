"use client";

import { use, useState, useEffect } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface SubscriptionDetail {
  id: string;
  status: string;
  overrideBasePriceCents: number | null;
  overrideAiMarkupPercent: number | null;
  overrideMaxProperties: number | null;
  overrideMaxPhoneNumbers: number | null;
  adminNotes: string | null;
  createdAt: string;
  canceledAt: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  user: {
    id: string;
    name: string | null;
    email: string;
    companyName: string | null;
    _count: { properties: number };
  };
  tier: {
    id: string;
    name: string;
    displayName: string;
    basePriceCents: number;
    includedAiCents: number;
    aiMarkupPercent: number;
    maxProperties: number | null;
    maxPhoneNumbers: number | null;
  };
  invoices: Array<{
    id: string;
    billingMonth: string;
    status: string;
    totalCents: number;
    basePriceCents: number;
    aiMarkupCents: number;
  }>;
}

interface UsageItem {
  type: string;
  _sum: { costCents: number | null; quantity: number | null };
}

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

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    trialing: "bg-blue-100 text-blue-700",
    suspended: "bg-red-100 text-red-700",
    past_due: "bg-yellow-100 text-yellow-700",
    canceled: "bg-gray-100 text-gray-700",
  };

  const labels: Record<string, string> = {
    active: "Active",
    trialing: "Trialing",
    suspended: "Suspended",
    past_due: "Past Due",
    canceled: "Canceled",
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

export default function AdminSubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);

  const [subscription, setSubscription] = useState<SubscriptionDetail | null>(null);
  const [usage, setUsage] = useState<UsageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Override form fields
  const [overrideBasePriceCents, setOverrideBasePriceCents] = useState("");
  const [overrideAiMarkupPercent, setOverrideAiMarkupPercent] = useState("");
  const [overrideMaxProperties, setOverrideMaxProperties] = useState("");
  const [overrideMaxPhoneNumbers, setOverrideMaxPhoneNumbers] = useState("");
  const [adminNotes, setAdminNotes] = useState("");

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/admin/subscriptions/${id}`);
        if (!res.ok) {
          setError("Failed to load subscription");
          setLoading(false);
          return;
        }
        const data = await res.json();
        setSubscription(data.subscription);
        setUsage(data.usage || []);

        // Populate form fields
        const sub = data.subscription;
        setOverrideBasePriceCents(
          sub.overrideBasePriceCents !== null ? String(sub.overrideBasePriceCents) : ""
        );
        setOverrideAiMarkupPercent(
          sub.overrideAiMarkupPercent !== null ? String(sub.overrideAiMarkupPercent) : ""
        );
        setOverrideMaxProperties(
          sub.overrideMaxProperties !== null ? String(sub.overrideMaxProperties) : ""
        );
        setOverrideMaxPhoneNumbers(
          sub.overrideMaxPhoneNumbers !== null ? String(sub.overrideMaxPhoneNumbers) : ""
        );
        setAdminNotes(sub.adminNotes || "");
      } catch {
        setError("Failed to load subscription");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  async function handleSaveOverrides() {
    setSaving(true);
    setSaveMessage("");
    try {
      const body: Record<string, unknown> = {};
      body.overrideBasePriceCents = overrideBasePriceCents
        ? Number(overrideBasePriceCents)
        : null;
      body.overrideAiMarkupPercent = overrideAiMarkupPercent
        ? Number(overrideAiMarkupPercent)
        : null;
      body.overrideMaxProperties = overrideMaxProperties
        ? Number(overrideMaxProperties)
        : null;
      body.overrideMaxPhoneNumbers = overrideMaxPhoneNumbers
        ? Number(overrideMaxPhoneNumbers)
        : null;
      body.adminNotes = adminNotes || null;

      const res = await fetch(`/api/admin/subscriptions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        setSaveMessage(errData.error || "Failed to save overrides.");
      } else {
        setSaveMessage("Overrides saved successfully.");
        const data = await res.json();
        setSubscription((prev) =>
          prev ? { ...prev, ...data.subscription } : prev
        );
      }
    } catch {
      setSaveMessage("Failed to save overrides.");
    } finally {
      setSaving(false);
    }
  }

  async function handleStatusChange(newStatus: string) {
    const confirmMsg =
      newStatus === "suspended"
        ? "Are you sure you want to suspend this account?"
        : newStatus === "active"
          ? "Are you sure you want to reactivate this account?"
          : `Are you sure you want to set status to "${newStatus}"?`;

    if (!confirm(confirmMsg)) return;

    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch(`/api/admin/subscriptions/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (!res.ok) {
        setSaveMessage("Failed to change status.");
      } else {
        setSaveMessage(`Status changed to "${newStatus}".`);
        const data = await res.json();
        setSubscription((prev) =>
          prev ? { ...prev, ...data.subscription } : prev
        );
      }
    } catch {
      setSaveMessage("Failed to change status.");
    } finally {
      setSaving(false);
    }
  }

  const totalUsageCents = usage.reduce(
    (sum, u) => sum + (u._sum.costCents ?? 0),
    0
  );

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/admin/subscriptions" className="hover:text-blue-600">
            Subscriptions
          </Link>
          <span>/</span>
          <span className="text-gray-900">
            {subscription ? subscription.user.name || subscription.user.email : "..."}
          </span>
        </nav>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading subscription...</p>
            </div>
          </div>
        ) : !subscription ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">Subscription not found</h3>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Subscription Info */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Subscription Details
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div>
                  <p className="text-sm font-medium text-gray-500">Landlord</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {subscription.user.name || "Unnamed"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Email</p>
                  <p className="mt-1 text-sm text-gray-900">{subscription.user.email}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Company</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {subscription.user.companyName || "--"}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Plan</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {subscription.tier.displayName}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Status</p>
                  <div className="mt-1">
                    <StatusBadge status={subscription.status} />
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Properties</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {subscription.user._count.properties}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Created</p>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDate(subscription.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Base Price</p>
                  <p className="mt-1 text-sm text-gray-900">
                    ${formatCents(subscription.tier.basePriceCents)}/mo
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">Current Month AI Cost</p>
                  <p className="mt-1 text-sm text-gray-900">
                    ${formatCents(totalUsageCents)}
                  </p>
                </div>
              </div>
            </div>

            {/* Current Month Usage */}
            {usage.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  Current Month Usage
                </h2>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Type
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Quantity
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Cost
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {usage.map((u) => (
                        <tr key={u.type} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                            {u.type}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {u._sum.quantity ?? 0}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                            ${formatCents(u._sum.costCents ?? 0)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Overrides Form */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Admin Overrides
              </h2>
              <p className="mb-4 text-sm text-gray-500">
                Leave fields empty to use the tier defaults.
              </p>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Override Base Price (cents)
                  </label>
                  <input
                    type="number"
                    value={overrideBasePriceCents}
                    onChange={(e) => setOverrideBasePriceCents(e.target.value)}
                    placeholder={String(subscription.tier.basePriceCents)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Override AI Markup %
                  </label>
                  <input
                    type="number"
                    value={overrideAiMarkupPercent}
                    onChange={(e) => setOverrideAiMarkupPercent(e.target.value)}
                    placeholder={String(subscription.tier.aiMarkupPercent)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Override Max Properties
                  </label>
                  <input
                    type="number"
                    value={overrideMaxProperties}
                    onChange={(e) => setOverrideMaxProperties(e.target.value)}
                    placeholder={
                      subscription.tier.maxProperties !== null
                        ? String(subscription.tier.maxProperties)
                        : "Unlimited"
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Override Max Phone Numbers
                  </label>
                  <input
                    type="number"
                    value={overrideMaxPhoneNumbers}
                    onChange={(e) => setOverrideMaxPhoneNumbers(e.target.value)}
                    placeholder={
                      subscription.tier.maxPhoneNumbers !== null
                        ? String(subscription.tier.maxPhoneNumbers)
                        : "Unlimited"
                    }
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-medium text-gray-700">
                    Admin Notes
                  </label>
                  <textarea
                    value={adminNotes}
                    onChange={(e) => setAdminNotes(e.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Internal notes about this subscription..."
                  />
                </div>
              </div>

              {saveMessage && (
                <div
                  className={`mt-4 rounded-md p-3 text-sm ${
                    saveMessage.includes("success")
                      ? "bg-green-50 text-green-700"
                      : "bg-red-50 text-red-700"
                  }`}
                >
                  {saveMessage}
                </div>
              )}

              <div className="mt-4">
                <button
                  onClick={handleSaveOverrides}
                  disabled={saving}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save Overrides"}
                </button>
              </div>
            </div>

            {/* Account Actions */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Account Actions
              </h2>
              <div className="flex flex-wrap gap-3">
                {subscription.status !== "suspended" && (
                  <button
                    onClick={() => handleStatusChange("suspended")}
                    disabled={saving}
                    className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                  >
                    Suspend Account
                  </button>
                )}
                {subscription.status === "suspended" && (
                  <button
                    onClick={() => handleStatusChange("active")}
                    disabled={saving}
                    className="rounded-lg border border-green-300 bg-white px-4 py-2 text-sm font-medium text-green-700 hover:bg-green-50 disabled:opacity-50"
                  >
                    Reactivate Account
                  </button>
                )}
                {subscription.status !== "canceled" && (
                  <button
                    onClick={() => handleStatusChange("canceled")}
                    disabled={saving}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel Subscription
                  </button>
                )}
              </div>
            </div>

            {/* Invoice History */}
            {subscription.invoices.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  Invoice History
                </h2>
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Billing Month
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Status
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Base
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          AI Markup
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Total
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {subscription.invoices.map((inv) => (
                        <tr key={inv.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                            {formatDate(inv.billingMonth)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <span
                              className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                                inv.status === "paid"
                                  ? "bg-green-100 text-green-700"
                                  : inv.status === "finalized"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-gray-100 text-gray-700"
                              }`}
                            >
                              {inv.status}
                            </span>
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            ${formatCents(inv.basePriceCents)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            ${formatCents(inv.aiMarkupCents)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                            ${formatCents(inv.totalCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
