"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";
import Pagination, { usePagination } from "@/components/Pagination";

interface SurveyEntry {
  id: string;
  propertyId: string;
  status: string;
  channel: string;
  callerPhone: string | null;
  fullName: string | null;
  email: string | null;
  monthlyIncome: string | null;
  customResponses: Record<string, unknown> | null;
  completedAt: string | null;
  createdAt: string;
  reviewedAt: string | null;
  forwardedAt?: string | null;
  property: { id: string; name: string };
}

interface SurveyInvite {
  id: string;
  phone: string;
  propertyId: string;
  channel: string;
  createdAt: string;
  expiresAt: string;
  property: { id: string; name: string };
}

interface PropertyOption {
  id: string;
  name: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatIncome(income: string | null): string {
  if (!income) return "—";
  const num = parseFloat(income.replace(/[^0-9.]/g, ""));
  if (isNaN(num)) return income;
  return `$${num.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function statusBadge(status: string) {
  const styles: Record<string, string> = {
    completed: "bg-blue-100 text-blue-700",
    reviewed: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    in_progress: "bg-yellow-100 text-yellow-700",
  };
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

export default function SurveyResponsesPage() {
  const [entries, setEntries] = useState<SurveyEntry[]>([]);
  const [invites, setInvites] = useState<SurveyInvite[]>([]);
  const [properties, setProperties] = useState<PropertyOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { totalPages, getSkip } = usePagination(totalCount, 50);
  const [propertyFilter, setPropertyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [search, setSearch] = useState("");
  const [optingOut, setOptingOut] = useState<string | null>(null);
  const [optedOut, setOptedOut] = useState<Set<string>>(new Set());

  const buildFilterParams = useCallback(() => {
    const params = new URLSearchParams();
    if (propertyFilter) params.set("propertyId", propertyFilter);
    if (statusFilter) params.set("status", statusFilter);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (search.trim()) params.set("q", search.trim());
    return params;
  }, [propertyFilter, statusFilter, dateFrom, dateTo, search]);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = buildFilterParams();
      params.set("skip", String(getSkip(page)));
      params.set("limit", "50");

      const res = await fetch(`/api/admin/surveys?${params.toString()}`);
      if (!res.ok) {
        setError(res.status === 403 ? "Access denied" : "Failed to load survey responses");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setEntries(data.entries || []);
      setTotalCount(data.pagination?.total ?? 0);
    } catch {
      setError("Failed to load survey responses");
    } finally {
      setLoading(false);
    }
  }, [page, buildFilterParams, getSkip]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  useEffect(() => {
    fetch("/api/admin/surveys?view=invites")
      .then((res) => (res.ok ? res.json() : { invites: [] }))
      .then((data) => setInvites(data.invites || []))
      .catch(() => setInvites([]));

    fetch("/api/admin/sms-relay/property")
      .then((res) => (res.ok ? res.json() : { properties: [] }))
      .then((data) =>
        setProperties(
          (data.properties || []).map((p: { id: string; name: string }) => ({
            id: p.id,
            name: p.name,
          }))
        )
      )
      .catch(() => setProperties([]));
  }, []);

  const handleOptOut = async (entry: SurveyEntry) => {
    if (!entry.callerPhone) return;
    if (
      !window.confirm(
        `Opt out ${entry.callerPhone} from SMS for ${entry.property.name}?`
      )
    ) {
      return;
    }

    setOptingOut(entry.id);
    setError("");
    try {
      const res = await fetch("/api/admin/sms-relay/optout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          phone: entry.callerPhone,
          propertyId: entry.propertyId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to record opt-out");
      } else {
        setOptedOut((prev) => new Set(prev).add(entry.id));
      }
    } catch {
      setError("Failed to record opt-out");
    } finally {
      setOptingOut(null);
    }
  };

  const csvHref = `/api/admin/surveys?format=csv&${buildFilterParams().toString()}`;

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Survey Responses</h1>
            <p className="mt-1 text-sm text-gray-500">
              Applications submitted through the SMS survey link.
            </p>
          </div>
          <a
            href={csvHref}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Export CSV
          </a>
        </div>

        {/* Filters */}
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Property
            </label>
            <select
              value={propertyFilter}
              onChange={(e) => {
                setPropertyFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Properties</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">All Statuses</option>
              <option value="completed">Completed</option>
              <option value="reviewed">Reviewed</option>
              <option value="rejected">Rejected</option>
              <option value="in_progress">In Progress</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Submitted From
            </label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => {
                setDateFrom(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Submitted To
            </label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => {
                setDateTo(e.target.value);
                setPage(1);
              }}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="min-w-[200px] flex-1">
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Search Name / Phone
            </label>
            <input
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Name or phone..."
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading survey responses...</p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">No survey responses</h3>
            <p className="mt-1 text-sm text-gray-500">
              Responses will appear here as tenants complete the SMS survey.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Submitted
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Bedrooms
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Income
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Forwarded
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {entries.map((entry) => {
                    const bedrooms =
                      entry.customResponses &&
                      entry.customResponses["bedrooms_needed"] != null
                        ? String(entry.customResponses["bedrooms_needed"])
                        : "—";
                    return (
                      <tr key={entry.id} className="transition-colors hover:bg-gray-50">
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {formatDate(entry.completedAt)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">
                          <Link
                            href={`/applications/${entry.id}`}
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {entry.fullName || "Unknown"}
                          </Link>
                          <p className="text-xs text-gray-400">{entry.property.name}</p>
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                          {entry.callerPhone || "—"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {bedrooms}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                          {formatIncome(entry.monthlyIncome)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">
                          {entry.forwardedAt ? (
                            <span className="inline-flex rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-700">
                              Forwarded
                            </span>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          {statusBadge(entry.status)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">
                          {optedOut.has(entry.id) ? (
                            <span className="text-xs text-gray-400">Opted out</span>
                          ) : (
                            <button
                              onClick={() => handleOptOut(entry)}
                              disabled={!entry.callerPhone || optingOut === entry.id}
                              className="text-xs text-red-600 hover:text-red-800 hover:underline disabled:cursor-not-allowed disabled:text-gray-300"
                            >
                              {optingOut === entry.id ? "Opting out..." : "Opt out"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-6">
              <Pagination
                currentPage={page}
                totalPages={totalPages}
                onPageChange={setPage}
              />
            </div>
          </>
        )}

        {/* Outstanding invites */}
        <div className="mt-10">
          <h2 className="text-lg font-semibold text-gray-900">Outstanding Invites</h2>
          <p className="mt-1 text-sm text-gray-500">
            Survey links sent but not yet completed (unexpired).
          </p>
          {invites.length === 0 ? (
            <div className="mt-4 rounded-lg border-2 border-dashed border-gray-300 bg-white p-8 text-center">
              <p className="text-sm text-gray-500">No outstanding invites.</p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Phone
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Property
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Sent
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Expires
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {invites.map((invite) => (
                    <tr key={invite.id} className="transition-colors hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {invite.phone}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {invite.property.name}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(invite.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(invite.expiresAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </DashboardShell>
  );
}
