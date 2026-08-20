"use client";

import { useState, useEffect, useCallback, Fragment } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MaintenanceRequest {
  id: string;
  propertyId: string;
  tenantId: string | null;
  unitId: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status: string;
  imageUrls: string[];
  notes: string | null;
  resolvedAt: string | null;
  createdAt: string;
  updatedAt: string;
  unitNumber: string | null;
  property: { id: string; name: string };
  tenant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    phone: string | null;
  } | null;
}

interface Property {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const STATUS_FILTERS = [
  { label: "All", value: "" },
  { label: "Open", value: "open" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
  { label: "Closed", value: "closed" },
];

const PRIORITY_OPTIONS = [
  { label: "All Priorities", value: "" },
  { label: "Low", value: "low" },
  { label: "Medium", value: "medium" },
  { label: "High", value: "high" },
  { label: "Urgent", value: "urgent" },
];

const STATUS_OPTIONS = [
  { label: "Open", value: "open" },
  { label: "In Progress", value: "in_progress" },
  { label: "Completed", value: "completed" },
  { label: "Closed", value: "closed" },
];

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ------------------------------------------------------------------ */
/*  Badge components                                                   */
/* ------------------------------------------------------------------ */

function PriorityBadge({ priority }: { priority: string }) {
  const styles: Record<string, string> = {
    low: "bg-gray-100 text-gray-700",
    medium: "bg-yellow-100 text-yellow-700",
    high: "bg-orange-100 text-orange-700",
    urgent: "bg-red-100 text-red-700",
  };

  const labels: Record<string, string> = {
    low: "Low",
    medium: "Medium",
    high: "High",
    urgent: "Urgent",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        styles[priority] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[priority] || priority}
    </span>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    open: "bg-yellow-100 text-yellow-700",
    in_progress: "bg-blue-100 text-blue-700",
    completed: "bg-green-100 text-green-700",
    closed: "bg-gray-100 text-gray-700",
  };

  const labels: Record<string, string> = {
    open: "Open",
    in_progress: "In Progress",
    completed: "Completed",
    closed: "Closed",
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

function CategoryBadge({ category }: { category: string }) {
  const labels: Record<string, string> = {
    plumbing: "Plumbing",
    electrical: "Electrical",
    appliance: "Appliance",
    hvac: "HVAC",
    pest: "Pest Control",
    general: "General",
    other: "Other",
  };

  return (
    <span className="inline-flex rounded-full bg-indigo-100 px-2 py-1 text-xs font-medium text-indigo-700">
      {labels[category] || category}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Success Toast                                                      */
/* ------------------------------------------------------------------ */

function SuccessToast({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [onDismiss]);

  return (
    <div className="fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-lg bg-green-600 px-5 py-3 text-sm font-medium text-white shadow-lg">
      <svg className="h-5 w-5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      {message}
      <button onClick={onDismiss} className="ml-2 hover:opacity-80">
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Expanded Detail Panel                                              */
/* ------------------------------------------------------------------ */

function DetailPanel({
  request,
  onUpdate,
}: {
  request: MaintenanceRequest;
  onUpdate: () => void;
}) {
  const [notes, setNotes] = useState(request.notes || "");
  const [status, setStatus] = useState(request.status);
  const [priority, setPriority] = useState(request.priority);
  const [savingNotes, setSavingNotes] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);
  const [updatingPriority, setUpdatingPriority] = useState(false);
  const [error, setError] = useState("");

  async function handleSaveNotes() {
    setSavingNotes(true);
    setError("");
    try {
      const res = await fetch(`/api/maintenance/${request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save notes.");
      } else {
        onUpdate();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSavingNotes(false);
    }
  }

  async function handleUpdateStatus() {
    setUpdatingStatus(true);
    setError("");
    try {
      const res = await fetch(`/api/maintenance/${request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update status.");
      } else {
        onUpdate();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUpdatingStatus(false);
    }
  }

  async function handleUpdatePriority() {
    setUpdatingPriority(true);
    setError("");
    try {
      const res = await fetch(`/api/maintenance/${request.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to update priority.");
      } else {
        onUpdate();
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setUpdatingPriority(false);
    }
  }

  return (
    <tr>
      <td colSpan={8} className="p-0">
        <div className="border-t bg-gray-50 p-6">
          {error && (
            <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {/* Two-column grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
            {/* Left column */}
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium text-gray-500">Description</h4>
                <p className="mt-1 whitespace-pre-wrap text-sm text-gray-900">
                  {request.description}
                </p>
              </div>
              <div>
                <h4 className="text-sm font-medium text-gray-500">Category</h4>
                <div className="mt-1">
                  <CategoryBadge category={request.category} />
                </div>
              </div>
              <div className="flex gap-6">
                <div>
                  <h4 className="text-sm font-medium text-gray-500">Created</h4>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDateTime(request.createdAt)}
                  </p>
                </div>
                <div>
                  <h4 className="text-sm font-medium text-gray-500">Updated</h4>
                  <p className="mt-1 text-sm text-gray-900">
                    {formatDateTime(request.updatedAt)}
                  </p>
                </div>
                {request.resolvedAt && (
                  <div>
                    <h4 className="text-sm font-medium text-gray-500">Resolved</h4>
                    <p className="mt-1 text-sm text-gray-900">
                      {formatDateTime(request.resolvedAt)}
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Right column */}
            <div className="space-y-4">
              {request.tenant && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">Tenant</h4>
                  <p className="mt-1 text-sm font-medium text-gray-900">
                    {request.tenant.firstName} {request.tenant.lastName}
                  </p>
                  <p className="text-sm text-gray-500">{request.tenant.email}</p>
                  {request.tenant.phone && (
                    <p className="text-sm text-gray-500">{request.tenant.phone}</p>
                  )}
                </div>
              )}
              {request.unitNumber && (
                <div>
                  <h4 className="text-sm font-medium text-gray-500">Unit</h4>
                  <p className="mt-1 text-sm text-gray-900">{request.unitNumber}</p>
                </div>
              )}
              <div>
                <h4 className="text-sm font-medium text-gray-500">Property</h4>
                <Link
                  href={`/properties/${request.propertyId}`}
                  className="mt-1 text-sm font-medium text-blue-600 hover:text-blue-800 hover:underline"
                >
                  {request.property.name}
                </Link>
              </div>
            </div>
          </div>

          {/* Images row */}
          {request.imageUrls && request.imageUrls.length > 0 && (
            <div className="mt-6">
              <h4 className="mb-2 text-sm font-medium text-gray-500">Images</h4>
              <div className="flex flex-wrap gap-3">
                {request.imageUrls.map((url, idx) => (
                  <a
                    key={idx}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block overflow-hidden rounded-lg border border-gray-200"
                  >
                    <img
                      src={url}
                      alt={`Maintenance image ${idx + 1}`}
                      className="h-24 w-auto object-cover"
                    />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Landlord Notes */}
          <div className="mt-6">
            <h4 className="mb-2 text-sm font-medium text-gray-500">
              Landlord Notes
            </h4>
            <div className="flex gap-3">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="Add notes about this request..."
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <button
                onClick={handleSaveNotes}
                disabled={savingNotes}
                className="self-end rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savingNotes ? "Saving..." : "Save"}
              </button>
            </div>
          </div>

          {/* Status + Priority updates */}
          <div className="mt-6 flex flex-wrap gap-6">
            {/* Status Update */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-gray-500">
                Update Status
              </h4>
              <div className="flex gap-2">
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {STATUS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleUpdateStatus}
                  disabled={updatingStatus || status === request.status}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingStatus ? "Updating..." : "Update"}
                </button>
              </div>
            </div>

            {/* Priority Change */}
            <div>
              <h4 className="mb-2 text-sm font-medium text-gray-500">
                Update Priority
              </h4>
              <div className="flex gap-2">
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value)}
                  className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  {PRIORITY_OPTIONS.filter((o) => o.value !== "").map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleUpdatePriority}
                  disabled={updatingPriority || priority === request.priority}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingPriority ? "Updating..." : "Update"}
                </button>
              </div>
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function MaintenancePage() {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Filter state
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyFilter, setPropertyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // Toast state
  const [toast, setToast] = useState("");

  /* ---- Load properties for the filter dropdown ---- */

  useEffect(() => {
    async function loadProperties() {
      try {
        const res = await fetch("/api/properties");
        if (res.ok) {
          const data = await res.json();
          setProperties(
            (data.properties || []).map((p: any) => ({
              id: p.id,
              name: p.name,
            }))
          );
        }
      } catch {
        // Silently ignore -- filter just won't be populated
      }
    }
    loadProperties();
  }, []);

  /* ---- Load maintenance requests ---- */

  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();
      if (propertyFilter) params.set("propertyId", propertyFilter);
      if (statusFilter) params.set("status", statusFilter);
      if (priorityFilter) params.set("priority", priorityFilter);

      const res = await fetch(`/api/maintenance?${params.toString()}`);
      if (!res.ok) {
        setError("Failed to load maintenance requests.");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setRequests(data.requests || []);
    } catch {
      setError("Failed to load maintenance requests.");
    } finally {
      setLoading(false);
    }
  }, [propertyFilter, statusFilter, priorityFilter]);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  /* ---- Filter handlers ---- */

  function handlePropertyFilter(value: string) {
    setPropertyFilter(value);
  }

  function handleStatusFilter(value: string) {
    setStatusFilter(value);
  }

  function handlePriorityFilter(value: string) {
    setPriorityFilter(value);
  }

  /* ---- Row expand toggle ---- */

  function toggleExpand(id: string) {
    setExpandedId((prev) => (prev === id ? null : id));
  }

  /* ---- Update handler (from detail panel) ---- */

  function handleUpdate() {
    setToast("Updated successfully!");
    loadRequests();
  }

  /* ---- Render ---- */

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">
            Maintenance Requests
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Track and manage maintenance requests from your tenants.
          </p>
        </div>

        {/* Filter Bar */}
        <div className="mb-6 flex flex-wrap items-end gap-4">
          {/* Property dropdown */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Property
            </label>
            <select
              value={propertyFilter}
              onChange={(e) => handlePropertyFilter(e.target.value)}
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

          {/* Status filter buttons */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Status
            </label>
            <div className="flex flex-wrap gap-2">
              {STATUS_FILTERS.map((filter) => (
                <button
                  key={filter.value}
                  onClick={() => handleStatusFilter(filter.value)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    statusFilter === filter.value
                      ? "bg-blue-600 text-white"
                      : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {/* Priority dropdown */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Priority
            </label>
            <select
              value={priorityFilter}
              onChange={(e) => handlePriorityFilter(e.target.value)}
              className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">
                Loading maintenance requests...
              </p>
            </div>
          </div>
        ) : requests.length === 0 ? (
          /* Empty state */
          <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <svg
              className="mx-auto h-12 w-12 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.049.58.025 1.193-.14 1.743"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">
              No maintenance requests
            </h3>
            <p className="mt-1 text-sm text-gray-500">
              {statusFilter || priorityFilter || propertyFilter
                ? "Try adjusting your filters."
                : "Maintenance requests from tenants will appear here."}
            </p>
          </div>
        ) : (
          /* Table */
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Title
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Property
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Tenant
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Unit
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Priority
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Created
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {requests.map((req) => (
                    <Fragment key={req.id}>
                      <tr
                        className={`cursor-pointer transition-colors hover:bg-gray-50 ${
                          expandedId === req.id ? "bg-gray-50" : ""
                        }`}
                        onClick={() => toggleExpand(req.id)}
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                          {req.title}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {req.property.name}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {req.tenant
                            ? `${req.tenant.firstName} ${req.tenant.lastName}`
                            : "--"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {req.unitNumber || "--"}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <PriorityBadge priority={req.priority} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4">
                          <StatusBadge status={req.status} />
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {formatDate(req.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleExpand(req.id);
                            }}
                            className="text-blue-600 hover:text-blue-800 hover:underline"
                          >
                            {expandedId === req.id ? "Collapse" : "Details"}
                          </button>
                        </td>
                      </tr>
                      {expandedId === req.id && (
                        <DetailPanel
                          key={`detail-${req.id}`}
                          request={req}
                          onUpdate={handleUpdate}
                        />
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Success Toast */}
      {toast && (
        <SuccessToast message={toast} onDismiss={() => setToast("")} />
      )}
    </DashboardShell>
  );
}
