"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";
import Pagination, { usePagination } from "@/components/Pagination";

interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  user: { name: string | null; email: string } | null;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function AuditLogPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { totalPages, getSkip } = usePagination(totalCount, 50);
  const [resourceTypeFilter, setResourceTypeFilter] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadEntries = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String(getSkip(page)));
      params.set("limit", "50");
      if (resourceTypeFilter) params.set("resourceType", resourceTypeFilter);

      const res = await fetch(`/api/admin/audit?${params.toString()}`);
      if (!res.ok) {
        setError(res.status === 403 ? "Access denied" : "Failed to load audit log");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setEntries(data.entries || []);
      setTotalCount(data.pagination?.total ?? 0);
    } catch {
      setError("Failed to load audit log");
    } finally {
      setLoading(false);
    }
  }, [page, resourceTypeFilter, getSkip]);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">Audit Log</h1>
          <p className="mt-1 text-sm text-gray-500">
            System-wide activity log of critical operations.
          </p>
        </div>

        {/* Filter */}
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium text-gray-500">
            Resource Type
          </label>
          <select
            value={resourceTypeFilter}
            onChange={(e) => {
              setResourceTypeFilter(e.target.value);
              setPage(1);
            }}
            className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            <option value="">All Types</option>
            <option value="Payment">Payment</option>
            <option value="Notice">Notice</option>
            <option value="Lease">Lease</option>
            <option value="Application">Application</option>
          </select>
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
              <p className="mt-3 text-sm text-gray-500">Loading audit log...</p>
            </div>
          </div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">No audit entries</h3>
            <p className="mt-1 text-sm text-gray-500">
              Audit entries will appear here as critical operations are performed.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      User
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Action
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Resource
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Details
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {entries.map((entry) => (
                    <tr
                      key={entry.id}
                      className="transition-colors hover:bg-gray-50"
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(entry.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {entry.user?.name || entry.user?.email || entry.userId}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
                          {formatAction(entry.action)}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        <span className="font-medium">{entry.resourceType}</span>
                        <span className="ml-1 text-gray-400 text-xs">
                          {entry.resourceId.slice(0, 12)}...
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm">
                        {entry.metadata ? (
                          <button
                            onClick={() =>
                              setExpandedId(
                                expandedId === entry.id ? null : entry.id
                              )
                            }
                            className="text-blue-600 hover:text-blue-800 hover:underline text-xs"
                          >
                            {expandedId === entry.id ? "Hide" : "View"}
                          </button>
                        ) : (
                          <span className="text-gray-400">--</span>
                        )}
                        {expandedId === entry.id && entry.metadata && (
                          <pre className="mt-2 max-w-xs overflow-x-auto rounded bg-gray-50 p-2 text-xs text-gray-600">
                            {JSON.stringify(entry.metadata, null, 2)}
                          </pre>
                        )}
                      </td>
                    </tr>
                  ))}
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
      </div>
    </DashboardShell>
  );
}
