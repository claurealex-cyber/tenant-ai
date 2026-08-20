"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";
import Pagination, { usePagination } from "@/components/Pagination";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Payment {
  id: string;
  amount: number;
  type: string;
  method: string;
  status: string;
  description: string | null;
  receiptUrl: string | null;
  paidAt: string | null;
  createdAt: string;
  tenant: { firstName: string; lastName: string };
  lease: {
    unit: {
      unitNumber: string;
      property: { name: string };
    };
  };
}

interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

interface OverdueTenant {
  tenantId: string;
  tenantName: string;
  tenantEmail: string;
  propertyName: string;
  unitNumber: string;
  leaseId: string;
  amountOwed: number;
  oldestDueDate: string;
  chargeCount: number;
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
  { label: "Pending", value: "pending" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" },
];

const METHOD_FILTERS = [
  { label: "All", value: "" },
  { label: "ACH", value: "ach" },
  { label: "Card", value: "card" },
  { label: "Cash", value: "cash" },
  { label: "Check", value: "check" },
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

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function daysOverdue(dueDateStr: string): number {
  const due = new Date(dueDateStr);
  const now = new Date();
  const diffMs = now.getTime() - due.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

/* ------------------------------------------------------------------ */
/*  Badge components                                                   */
/* ------------------------------------------------------------------ */

function PaymentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    processing: "bg-blue-100 text-blue-700",
    failed: "bg-red-100 text-red-700",
    refunded: "bg-gray-100 text-gray-700",
  };

  const labels: Record<string, string> = {
    completed: "Completed",
    pending: "Pending",
    processing: "Processing",
    failed: "Failed",
    refunded: "Refunded",
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

function TypeBadge({ type }: { type: string }) {
  const styles: Record<string, string> = {
    rent: "bg-blue-100 text-blue-700",
    late_fee: "bg-orange-100 text-orange-700",
    deposit: "bg-purple-100 text-purple-700",
  };

  const labels: Record<string, string> = {
    rent: "Rent",
    late_fee: "Late Fee",
    deposit: "Deposit",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        styles[type] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[type] || type}
    </span>
  );
}

function MethodBadge({ method }: { method: string }) {
  const styles: Record<string, string> = {
    ach: "bg-indigo-100 text-indigo-700",
    card: "bg-sky-100 text-sky-700",
    cash: "bg-emerald-100 text-emerald-700",
    check: "bg-amber-100 text-amber-700",
  };

  const labels: Record<string, string> = {
    ach: "ACH",
    card: "Card",
    cash: "Cash",
    check: "Check",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        styles[method] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[method] || method}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Offline Payment Modal                                              */
/* ------------------------------------------------------------------ */

function RecordPaymentModal({
  overdueTenants,
  initialTenantId,
  onClose,
  onSuccess,
}: {
  overdueTenants: OverdueTenant[];
  initialTenantId?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [selectedTenant, setSelectedTenant] = useState(initialTenantId || "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<"cash" | "check">("cash");
  const [forMonth, setForMonth] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const tenant = overdueTenants.find((t) => t.tenantId === selectedTenant);
    if (!tenant) {
      setError("Please select a tenant.");
      return;
    }

    const amountCents = Math.round(parseFloat(amount) * 100);
    if (isNaN(amountCents) || amountCents <= 0) {
      setError("Please enter a valid amount.");
      return;
    }

    setSubmitting(true);

    try {
      const res = await fetch("/api/payments/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leaseId: tenant.leaseId,
          tenantId: tenant.tenantId,
          amount: amountCents,
          method,
          forMonth: forMonth || undefined,
          description: description || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to record payment.");
        setSubmitting(false);
        return;
      }

      onSuccess();
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            Record Offline Payment
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-gray-400 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tenant Select */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Tenant
            </label>
            <select
              value={selectedTenant}
              onChange={(e) => setSelectedTenant(e.target.value)}
              required
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="">Select a tenant...</option>
              {overdueTenants.map((t) => (
                <option key={t.tenantId} value={t.tenantId}>
                  {t.tenantName} - {t.propertyName} #{t.unitNumber} (owes $
                  {formatCents(t.amountOwed)})
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Amount ($)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
              placeholder="0.00"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Payment Method
            </label>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value as "cash" | "check")}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="cash">Cash</option>
              <option value="check">Check</option>
            </select>
          </div>

          {/* For Month */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              For Month
            </label>
            <input
              type="month"
              value={forMonth}
              onChange={(e) => setForMonth(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description{" "}
              <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Money order #1234"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Recording..." : "Record Payment"}
            </button>
          </div>
        </form>
      </div>
    </div>
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
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function PaymentsPage() {
  // Payment history state
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loadingPayments, setLoadingPayments] = useState(true);
  const [paymentsError, setPaymentsError] = useState("");
  const [page, setPage] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const { totalPages, getSkip } = usePagination(totalCount, 25);
  const [statusFilter, setStatusFilter] = useState("");
  const [methodFilter, setMethodFilter] = useState("");

  // Property filter state
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyFilter, setPropertyFilter] = useState("");

  // Overdue state
  const [overdueTenants, setOverdueTenants] = useState<OverdueTenant[]>([]);
  const [loadingOverdue, setLoadingOverdue] = useState(true);
  const [overdueError, setOverdueError] = useState("");

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInitialTenant, setModalInitialTenant] = useState<string | undefined>();

  // Refund state
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundReason, setRefundReason] = useState("");
  const [refundLoading, setRefundLoading] = useState(false);
  const [refundError, setRefundError] = useState("");

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
        // Silently ignore — filter just won't be populated
      }
    }
    loadProperties();
  }, []);

  /* ---- Load payments ---- */

  const loadPayments = useCallback(async () => {
    setLoadingPayments(true);
    setPaymentsError("");

    try {
      const params = new URLSearchParams();
      params.set("skip", String(getSkip(page)));
      params.set("limit", "25");
      if (statusFilter) params.set("status", statusFilter);
      if (methodFilter) params.set("method", methodFilter);

      const res = await fetch(`/api/payments?${params.toString()}`);
      if (!res.ok) {
        setPaymentsError("Failed to load payments.");
        setLoadingPayments(false);
        return;
      }

      const data = await res.json();
      let fetched: Payment[] = data.payments || [];

      // Client-side property filter (API doesn't support propertyId param)
      if (propertyFilter) {
        fetched = fetched.filter(
          (p) => p.lease?.unit?.property?.name === propertyFilter
        );
      }

      setPayments(fetched);
      setTotalCount(data.pagination?.total ?? data.total ?? 0);
    } catch {
      setPaymentsError("Failed to load payments.");
    } finally {
      setLoadingPayments(false);
    }
  }, [page, statusFilter, methodFilter, propertyFilter, getSkip]);

  useEffect(() => {
    loadPayments();
  }, [loadPayments]);

  /* ---- Load overdue tenants ---- */

  const loadOverdue = useCallback(async () => {
    setLoadingOverdue(true);
    setOverdueError("");

    try {
      const res = await fetch("/api/payments/overdue");
      if (!res.ok) {
        setOverdueError("Failed to load overdue data.");
        setLoadingOverdue(false);
        return;
      }

      const data = await res.json();
      setOverdueTenants(data.overdueTenants || []);
    } catch {
      setOverdueError("Failed to load overdue data.");
    } finally {
      setLoadingOverdue(false);
    }
  }, []);

  useEffect(() => {
    loadOverdue();
  }, [loadOverdue]);

  /* ---- Filter handlers ---- */

  function handleStatusFilter(value: string) {
    setStatusFilter(value);
    setPage(1);
  }

  function handleMethodFilter(value: string) {
    setMethodFilter(value);
    setPage(1);
  }

  function handlePropertyFilter(value: string) {
    setPropertyFilter(value);
    setPage(1);
  }

  /* ---- Modal success handler ---- */

  function handlePaymentRecorded() {
    setModalOpen(false);
    setModalInitialTenant(undefined);
    setToast("Payment recorded successfully!");
    loadPayments();
    loadOverdue();
  }

  /* ---- Record Payment shortcut from overdue row ---- */

  function openModalForTenant(tenantId: string) {
    setModalInitialTenant(tenantId);
    setModalOpen(true);
  }

  /* ---- Refund handler ---- */

  async function handleRefund() {
    if (!refundingId) return;
    setRefundLoading(true);
    setRefundError("");

    try {
      const res = await fetch(`/api/payments/${refundingId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: refundReason || undefined }),
      });

      if (!res.ok) {
        const data = await res.json();
        setRefundError(data.error || "Failed to process refund.");
        setRefundLoading(false);
        return;
      }

      setRefundingId(null);
      setRefundReason("");
      setToast("Payment refunded successfully!");
      loadPayments();
      loadOverdue();
    } catch {
      setRefundError("Network error. Please try again.");
    } finally {
      setRefundLoading(false);
    }
  }

  /* ---- Render ---- */

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Payments</h1>
            <p className="mt-1 text-sm text-gray-500">
              View payment history and manage overdue accounts.
            </p>
          </div>
        </div>

        {/* ============================================================ */}
        {/*  Section 1: Payment History                                   */}
        {/* ============================================================ */}

        <div className="mb-10">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Payment History
            </h2>
            <a
              href="/api/payments/export"
              className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
              </svg>
              Export CSV
            </a>
          </div>

          {/* Filters row */}
          <div className="mb-4 flex flex-wrap items-end gap-4">
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
                  <option key={p.id} value={p.name}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Status chips */}
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

            {/* Method chips */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Method
              </label>
              <div className="flex flex-wrap gap-2">
                {METHOD_FILTERS.map((filter) => (
                  <button
                    key={filter.value}
                    onClick={() => handleMethodFilter(filter.value)}
                    className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                      methodFilter === filter.value
                        ? "bg-blue-600 text-white"
                        : "bg-white text-gray-700 border border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Error */}
          {paymentsError && (
            <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
              {paymentsError}
            </div>
          )}

          {/* Loading */}
          {loadingPayments ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="mt-3 text-sm text-gray-500">
                  Loading payments...
                </p>
              </div>
            </div>
          ) : payments.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
              <h3 className="text-lg font-medium text-gray-900">
                No payments recorded yet
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                {statusFilter || methodFilter || propertyFilter
                  ? "Try adjusting your filters."
                  : "Payments will appear here once tenants make them."}
              </p>
            </div>
          ) : (
            <>
              {/* Table */}
              <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
                <div className="overflow-x-auto">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Date
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Tenant Name
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Property / Unit
                        </th>
                        <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                          Amount
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Type
                        </th>
                        <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Method
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
                      {payments.map((payment) => (
                        <tr
                          key={payment.id}
                          className="transition-colors hover:bg-gray-50"
                        >
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {formatDate(payment.paidAt || payment.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                            {payment.tenant.firstName} {payment.tenant.lastName}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                            {payment.lease.unit.property.name} #{payment.lease.unit.unitNumber}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium text-gray-900">
                            ${formatCents(payment.amount)}
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <TypeBadge type={payment.type} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <MethodBadge method={payment.method} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4">
                            <PaymentStatusBadge status={payment.status} />
                          </td>
                          <td className="whitespace-nowrap px-6 py-4 text-sm">
                            <div className="flex items-center gap-3">
                              {payment.receiptUrl ? (
                                <a
                                  href={payment.receiptUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  Receipt
                                </a>
                              ) : payment.status === "completed" ? (
                                <Link
                                  href={`/api/payments/${payment.id}/receipt`}
                                  className="text-blue-600 hover:text-blue-800 hover:underline"
                                >
                                  Receipt
                                </Link>
                              ) : null}
                              {payment.status === "completed" && (
                                <button
                                  onClick={() => {
                                    setRefundingId(payment.id);
                                    setRefundReason("");
                                    setRefundError("");
                                  }}
                                  className="text-red-600 hover:text-red-800 hover:underline"
                                >
                                  Refund
                                </button>
                              )}
                              {payment.status !== "completed" && !payment.receiptUrl && (
                                <span className="text-gray-400">--</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Pagination */}
              <div className="mt-6">
                <Pagination currentPage={page} totalPages={totalPages} onPageChange={setPage} />
              </div>
            </>
          )}
        </div>

        {/* ============================================================ */}
        {/*  Section 2: Overdue Tenants                                   */}
        {/* ============================================================ */}

        <div>
          {/* Section header with action button */}
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Overdue Tenants
            </h2>
            <button
              onClick={() => {
                setModalInitialTenant(undefined);
                setModalOpen(true);
              }}
              disabled={overdueTenants.length === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg
                className="h-4 w-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 6v12m6-6H6"
                />
              </svg>
              Record Offline Payment
            </button>
          </div>

          {/* Error */}
          {overdueError && (
            <div className="mb-4 rounded-md bg-red-50 p-4 text-sm text-red-700">
              {overdueError}
            </div>
          )}

          {/* Loading */}
          {loadingOverdue ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                <p className="mt-3 text-sm text-gray-500">
                  Loading overdue data...
                </p>
              </div>
            </div>
          ) : overdueTenants.length === 0 ? (
            <div className="rounded-lg border-2 border-dashed border-gray-300 bg-white p-12 text-center">
              <h3 className="text-lg font-medium text-gray-900">
                No overdue rent
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                All tenants are up to date on their payments.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Tenant Name
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                        Property / Unit
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Amount Owed
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Days Overdue
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {overdueTenants.map((tenant) => (
                      <tr
                        key={tenant.tenantId}
                        className="transition-colors hover:bg-gray-50"
                      >
                        <td className="whitespace-nowrap px-6 py-4 text-sm font-medium text-gray-900">
                          {tenant.tenantName}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                          {tenant.propertyName} #{tenant.unitNumber}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-sm font-medium text-red-600">
                          ${formatCents(tenant.amountOwed)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-sm text-gray-500">
                          {daysOverdue(tenant.oldestDueDate)}
                        </td>
                        <td className="whitespace-nowrap px-6 py-4 text-right text-sm">
                          <div className="flex items-center justify-end gap-3">
                            <button
                              onClick={() =>
                                openModalForTenant(tenant.tenantId)
                              }
                              className="rounded-md bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100"
                            >
                              Record Payment
                            </button>
                            <Link
                              href={`/notices/new?tenantId=${tenant.tenantId}&leaseId=${tenant.leaseId}`}
                              className="text-xs font-medium text-gray-600 hover:text-gray-900 hover:underline"
                            >
                              Send Notice
                            </Link>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modalOpen && (
        <RecordPaymentModal
          overdueTenants={overdueTenants}
          initialTenantId={modalInitialTenant}
          onClose={() => {
            setModalOpen(false);
            setModalInitialTenant(undefined);
          }}
          onSuccess={handlePaymentRecorded}
        />
      )}

      {/* Refund Confirmation Modal */}
      {refundingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => setRefundingId(null)}
          />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              Confirm Refund
            </h2>
            <p className="text-sm text-gray-500 mb-4">
              This will reverse the payment and update any associated rent charges. This action cannot be undone.
            </p>
            {refundError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {refundError}
              </div>
            )}
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Reason <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={refundReason}
                onChange={(e) => setRefundReason(e.target.value)}
                rows={2}
                placeholder="e.g. Duplicate payment, tenant overpaid"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setRefundingId(null)}
                className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={handleRefund}
                disabled={refundLoading}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {refundLoading ? "Processing..." : "Confirm Refund"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Success Toast */}
      {toast && (
        <SuccessToast message={toast} onDismiss={() => setToast("")} />
      )}
    </DashboardShell>
  );
}
