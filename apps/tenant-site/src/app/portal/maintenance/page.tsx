"use client";

import { useEffect, useState } from "react";

/* ── Types ──────────────────────────────────────────────── */

interface MaintenanceRequest {
  id: string;
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
}

/* ── Helpers ─────────────────────────────────────────────── */

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/* ── Badge components ────────────────────────────────────── */

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
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const styles: Record<string, string> = {
    plumbing: "bg-cyan-100 text-cyan-700",
    electrical: "bg-amber-100 text-amber-700",
    appliance: "bg-purple-100 text-purple-700",
    hvac: "bg-orange-100 text-orange-700",
    pest: "bg-red-100 text-red-700",
    general: "bg-indigo-100 text-indigo-700",
    other: "bg-gray-100 text-gray-700",
  };

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
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
        styles[category] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[category] || category}
    </span>
  );
}

/* ── Category options ────────────────────────────────────── */

const CATEGORY_OPTIONS = [
  { label: "General", value: "general" },
  { label: "Plumbing", value: "plumbing" },
  { label: "Electrical", value: "electrical" },
  { label: "Appliance", value: "appliance" },
  { label: "HVAC", value: "hvac" },
  { label: "Pest Control", value: "pest" },
  { label: "Other", value: "other" },
];

/* ── Main Page ───────────────────────────────────────────── */

export default function MaintenancePage() {
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // New request form state
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("general");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState("");
  const [successBanner, setSuccessBanner] = useState("");

  useEffect(() => {
    loadRequests();
  }, []);

  async function loadRequests() {
    try {
      const res = await fetch("/api/portal/maintenance");
      if (res.ok) {
        const data = await res.json();
        setRequests(data.requests ?? []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSuccessBanner("");

    if (!title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!description.trim()) {
      setFormError("Description is required.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/portal/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          category,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setFormError(data.error || "Failed to submit request.");
        return;
      }

      const data = await res.json();
      setRequests((prev) => [data.request, ...prev]);
      setTitle("");
      setCategory("general");
      setDescription("");
      setShowForm(false);
      setSuccessBanner("Your request has been submitted.");
      setTimeout(() => setSuccessBanner(""), 5000);
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-4 border-blue-600 border-t-transparent" />
      </div>
    );
  }

  /* ── New Request Form View ──────────────────────────────── */

  if (showForm) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => {
            setShowForm(false);
            setFormError("");
          }}
          className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-800"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          Back to Requests
        </button>

        <div>
          <h1 className="text-2xl font-bold text-gray-900">New Maintenance Request</h1>
          <p className="mt-1 text-sm text-gray-500">
            Describe the issue and we will get it resolved as soon as possible.
          </p>
        </div>

        <div className="card p-6">
          <form onSubmit={handleSubmit} className="space-y-5">
            {formError && (
              <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                {formError}
              </div>
            )}

            {/* Title */}
            <div>
              <label htmlFor="req-title" className="block text-sm font-medium text-gray-700">
                Title <span className="text-red-500">*</span>
              </label>
              <input
                id="req-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Leaking kitchen faucet"
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Category */}
            <div>
              <label htmlFor="req-category" className="block text-sm font-medium text-gray-700">
                Category
              </label>
              <select
                id="req-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label htmlFor="req-description" className="block text-sm font-medium text-gray-700">
                Description <span className="text-red-500">*</span>
              </label>
              <textarea
                id="req-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                placeholder="Please describe the issue in detail..."
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>

            {/* Submit */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={submitting}
                className="rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "Submit Request"}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  /* ── List View ──────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Success banner */}
      {successBanner && (
        <div className="flex items-center gap-3 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
          <svg className="h-5 w-5 flex-shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-green-700">{successBanner}</p>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Maintenance Requests</h1>
          <p className="mt-1 text-sm text-gray-500">
            {requests.length > 0
              ? `You have ${requests.length} request${requests.length > 1 ? "s" : ""}.`
              : "Submit a request when something needs fixing."}
          </p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          New Request
        </button>
      </div>

      {/* Request list */}
      {requests.length === 0 ? (
        <div className="card p-12 text-center">
          <svg className="mx-auto h-12 w-12 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.42 15.17L17.25 21A2.652 2.652 0 0021 17.25l-5.877-5.877M11.42 15.17l2.496-3.03c.317-.384.74-.626 1.208-.766M11.42 15.17l-4.655 5.653a2.548 2.548 0 11-3.586-3.586l6.837-5.63m5.108-.233c.55-.164 1.163-.188 1.743-.14a4.5 4.5 0 004.486-6.336l-3.276 3.277a3.004 3.004 0 01-2.25-2.25l3.276-3.276a4.5 4.5 0 00-6.336 4.486c.049.58.025 1.193-.14 1.743"
            />
          </svg>
          <p className="mt-4 text-sm font-medium text-gray-900">No maintenance requests</p>
          <p className="mt-1 text-sm text-gray-500">
            Submit your first request when something in your unit needs attention.
          </p>
          <button
            onClick={() => setShowForm(true)}
            className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
            Submit your first request
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {requests.map((req) => {
            const isExpanded = expandedId === req.id;
            const preview =
              req.description.length > 120
                ? req.description.slice(0, 120) + "..."
                : req.description;

            return (
              <button
                key={req.id}
                onClick={() => setExpandedId(isExpanded ? null : req.id)}
                className={`card w-full text-left transition-colors ${
                  isExpanded ? "ring-1 ring-blue-200" : "hover:bg-gray-50"
                }`}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {req.title}
                        </p>
                        <CategoryBadge category={req.category} />
                        <StatusBadge status={req.status} />
                      </div>

                      {!isExpanded && (
                        <p className="mt-1.5 text-sm text-gray-500 truncate">
                          {preview}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-gray-400 whitespace-nowrap">
                        {formatDate(req.createdAt)}
                      </span>
                      <svg
                        className={`h-4 w-4 text-gray-400 transition-transform ${
                          isExpanded ? "rotate-180" : ""
                        }`}
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                        />
                      </svg>
                    </div>
                  </div>

                  {/* Expanded detail */}
                  {isExpanded && (
                    <div className="mt-4 border-t border-gray-100 pt-4 space-y-4">
                      <div>
                        <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                          Description
                        </h4>
                        <p className="mt-1 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                          {req.description}
                        </p>
                      </div>

                      {req.notes && (
                        <div>
                          <h4 className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                            Landlord Notes
                          </h4>
                          <p className="mt-1 text-sm leading-relaxed text-gray-700 whitespace-pre-wrap">
                            {req.notes}
                          </p>
                        </div>
                      )}

                      <div className="flex flex-wrap gap-6 text-sm text-gray-500">
                        <div>
                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                            Created
                          </span>
                          <p className="mt-0.5">{formatDateTime(req.createdAt)}</p>
                        </div>
                        <div>
                          <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                            Updated
                          </span>
                          <p className="mt-0.5">{formatDateTime(req.updatedAt)}</p>
                        </div>
                        {req.resolvedAt && (
                          <div>
                            <span className="text-xs font-medium text-gray-400 uppercase tracking-wider">
                              Resolved
                            </span>
                            <p className="mt-0.5">{formatDateTime(req.resolvedAt)}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
