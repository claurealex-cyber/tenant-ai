"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";
import Pagination, { usePagination } from "@/components/Pagination";

interface Notice {
  id: string;
  type: "five_day" | "ten_day" | "thirty_day";
  serviceConfirmed: boolean;
  effectiveDate: string | null;
  expirationDate: string | null;
  createdAt: string;
  tenant: {
    id: string;
    firstName: string;
    lastName: string;
  };
  lease: {
    id: string;
    property: {
      id: string;
      name: string;
    };
    unitNumber: string | null;
  };
}

const TYPE_FILTERS = [
  { label: "All", value: "" },
  { label: "5-Day", value: "five_day" },
  { label: "10-Day", value: "ten_day" },
  { label: "30-Day", value: "thirty_day" },
];

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    five_day: "bg-red-100 text-red-700",
    ten_day: "bg-yellow-100 text-yellow-700",
    thirty_day: "bg-blue-100 text-blue-700",
  };

  const labels: Record<string, string> = {
    five_day: "5-Day",
    ten_day: "10-Day",
    thirty_day: "30-Day",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        styles[type] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[type] || type}
    </span>
  );
}

function ServiceBadge({ served }: { served: boolean }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${
        served ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-700"
      }`}
    >
      {served ? "Served" : "Unserved"}
    </span>
  );
}

const SERVICE_FILTERS = [
  { label: "All", value: "" },
  { label: "Served", value: "served" },
  { label: "Unserved", value: "unserved" },
];

export default function NoticesPage() {
  const router = useRouter();
  const [notices, setNotices] = useState<Notice[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [serviceFilter, setServiceFilter] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { totalPages, getSkip } = usePagination(totalCount, 25);

  const loadNotices = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String(getSkip(page)));
      params.set("limit", "25");
      if (typeFilter) {
        params.set("type", typeFilter);
      }

      const res = await fetch(`/api/notices?${params.toString()}`);
      if (!res.ok) {
        setError("Failed to load notices");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setNotices(data.notices || []);
      setTotalCount(data.pagination?.total ?? data.total ?? (data.notices || []).length);
    } catch {
      setError("Failed to load notices");
    } finally {
      setLoading(false);
    }
  }, [typeFilter, page, getSkip]);

  const filteredNotices = useMemo(() => {
    if (!serviceFilter) return notices;
    if (serviceFilter === "served") return notices.filter((n) => n.serviceConfirmed);
    if (serviceFilter === "unserved") return notices.filter((n) => !n.serviceConfirmed);
    return notices;
  }, [notices, serviceFilter]);

  useEffect(() => {
    loadNotices();
  }, [loadNotices]);

  function handleTypeFilter(value: string) {
    setTypeFilter(value);
    setPage(1);
  }

  function handleServiceFilter(value: string) {
    setServiceFilter(value);
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Legal Notices</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage and track legal notices for your properties.
            </p>
          </div>
          <Link
            href="/notices/new"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Create Notice
          </Link>
        </div>

        {/* Type Filter Chips */}
        <div className="mb-4 flex flex-wrap gap-2">
          {TYPE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => handleTypeFilter(filter.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                typeFilter === filter.value
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {/* Service Filter Chips */}
        <div className="mb-6 flex flex-wrap gap-2">
          {SERVICE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              onClick={() => handleServiceFilter(filter.value)}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                serviceFilter === filter.value
                  ? "bg-green-600 text-white"
                  : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
              }`}
            >
              {filter.label}
            </button>
          ))}
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
              <p className="mt-3 text-sm text-gray-500">Loading notices...</p>
            </div>
          </div>
        ) : notices.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <h3 className="text-lg font-medium text-gray-900">
              No notices have been created
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {typeFilter
                ? "Try a different type filter."
                : "Create your first legal notice to get started."}
            </p>
            <Link
              href="/notices/new"
              className="mt-4 inline-flex rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create Notice
            </Link>
          </div>
        ) : (
          <>
            {/* Table */}
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Date Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Tenant Name
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Property / Unit
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Type
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Service Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Effective Date
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Expiration Date
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredNotices.map((notice) => (
                    <tr
                      key={notice.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      onClick={() =>
                        router.push(`/notices/${notice.id}`)
                      }
                    >
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(notice.createdAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <Link
                          href={`/notices/${notice.id}`}
                          className="text-sm font-medium text-gray-900 hover:text-blue-600"
                        >
                          {notice.tenant.firstName} {notice.tenant.lastName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {notice.lease.property.name}
                        {notice.lease.unitNumber
                          ? ` - Unit ${notice.lease.unitNumber}`
                          : ""}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <TypeBadge type={notice.type} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <ServiceBadge served={notice.serviceConfirmed} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {notice.effectiveDate
                          ? formatDate(notice.effectiveDate)
                          : "--"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {notice.expirationDate
                          ? formatDate(notice.expirationDate)
                          : "--"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="mt-6">
              <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          </>
        )}
      </div>
    </DashboardShell>
  );
}
