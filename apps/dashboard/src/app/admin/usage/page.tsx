"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface UsageByType {
  type: string;
  costCents: number;
  quantity: number;
}

interface TopUser {
  userId: string;
  name: string;
  companyName: string | null;
  tierName: string;
  includedAiCents: number;
  aiCostCents: number;
}

interface UsageData {
  billingMonth: string;
  totalAiCostCents: number;
  totalQuantity: number;
  totalRevenueCents: number;
  totalBaseCents: number;
  totalMarkupCents: number;
  margin: number;
  usageByType: UsageByType[];
  topUsers: TopUser[];
}

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdminUsagePage() {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  });

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const params = new URLSearchParams();
        if (month) params.set("month", month);

        const res = await fetch(`/api/admin/usage?${params.toString()}`);
        if (!res.ok) {
          setError("Failed to load usage data");
          setLoading(false);
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load usage data");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [month]);

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Platform Usage</h1>
            <p className="mt-1 text-sm text-gray-500">
              AI costs, revenue, and usage breakdown.
            </p>
          </div>
          <div>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading usage data...</p>
            </div>
          </div>
        ) : !data ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">No data available</h3>
            <p className="mt-1 text-sm text-gray-500">Try selecting a different month.</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Total AI Cost</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  ${formatCents(data.totalAiCostCents)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Total Revenue</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {data.totalRevenueCents === 0 && data.totalQuantity === 0
                    ? "No data"
                    : `$${formatCents(data.totalRevenueCents)}`}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Margin</p>
                <p
                  className={`mt-1 text-2xl font-bold ${
                    data.margin >= 0 ? "text-green-600" : "text-red-600"
                  }`}
                >
                  ${formatCents(data.margin)}
                </p>
              </div>
              <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
                <p className="text-sm font-medium text-gray-500">Total Interactions</p>
                <p className="mt-1 text-2xl font-bold text-gray-900">
                  {data.totalQuantity.toLocaleString()}
                </p>
              </div>
            </div>

            {/* Revenue Breakdown */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Revenue Breakdown
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-sm font-medium text-gray-500">Base Revenue</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    ${formatCents(data.totalBaseCents)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">AI Markup Revenue</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    ${formatCents(data.totalMarkupCents)}
                  </p>
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-500">AI Cost</p>
                  <p className="mt-1 text-lg font-semibold text-gray-900">
                    ${formatCents(data.totalAiCostCents)}
                  </p>
                </div>
              </div>
            </div>

            {/* Usage by Type */}
            {data.usageByType.length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  Usage by Type
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
                      {data.usageByType.map((u) => (
                        <tr key={u.type} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                            {u.type}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {u.quantity.toLocaleString()}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                            ${formatCents(u.costCents)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Top 20 Users */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Top 20 Users by AI Usage
              </h2>
              {data.topUsers.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
                  <p className="text-sm text-gray-500">No usage data for this month.</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Landlord
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Plan
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          AI Usage
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Included
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Overage
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {data.topUsers.map((user) => {
                        const overage = Math.max(
                          0,
                          user.aiCostCents - user.includedAiCents
                        );
                        return (
                          <tr key={user.userId} className="hover:bg-gray-50">
                            <td className="whitespace-nowrap px-6 py-4">
                              <div>
                                <p className="text-sm font-medium text-gray-900">
                                  {user.name}
                                </p>
                                {user.companyName && (
                                  <p className="text-xs text-gray-500">
                                    {user.companyName}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                              {user.tierName}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                              ${formatCents(user.aiCostCents)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                              ${formatCents(user.includedAiCents)}
                            </td>
                            <td className="whitespace-nowrap px-6 py-4">
                              {overage > 0 ? (
                                <span className="text-sm font-medium text-red-600">
                                  ${formatCents(overage)}
                                </span>
                              ) : (
                                <span className="text-sm text-gray-400">--</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
