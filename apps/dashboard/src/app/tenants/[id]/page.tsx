"use client";

import { useState, useEffect, use } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface TenantDetail {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  updatedAt: string;
  leases: {
    id: string;
    status: string;
    monthlyRent: number;
    securityDeposit: number | null;
    startDate: string;
    endDate: string | null;
    leaseType: string;
    lateFeeAmount: number | null;
    lateFeeGraceDays: number;
    rentDueDay: number;
    depositHoldingBank: string | null;
    depositHoldingAddress: string | null;
    moveOutDate: string | null;
    depositReturnedDate: string | null;
    depositDeductions: { description: string; amount: number }[] | null;
    createdAt: string;
    unit: {
      id: string;
      unitNumber: string;
      property: {
        id: string;
        name: string;
      };
    };
  }[];
  payments: {
    id: string;
    amount: number;
    status: string;
    type: string;
    createdAt: string;
  }[];
  notices: {
    id: string;
    type: string;
    subject: string;
    status: string;
    createdAt: string;
  }[];
}

interface Property {
  id: string;
  name: string;
  cookCounty: boolean;
}

interface Unit {
  id: string;
  unitNumber: string;
  status: string;
  monthlyRent: number;
}

function formatMoney(cents: number): string {
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

function LeaseStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    active: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    expired: "bg-gray-100 text-gray-700",
    terminated: "bg-red-100 text-red-700",
  };

  const labels: Record<string, string> = {
    active: "Active",
    pending: "Pending",
    expired: "Expired",
    terminated: "Terminated",
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

function PaymentStatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    paid: "bg-green-100 text-green-700",
    pending: "bg-yellow-100 text-yellow-700",
    failed: "bg-red-100 text-red-700",
    refunded: "bg-gray-100 text-gray-700",
  };

  return (
    <span
      className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  );
}

function InfoField({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || "--"}</dd>
    </div>
  );
}

export default function TenantDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [tenant, setTenant] = useState<TenantDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Edit tenant info
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState("");

  // Create lease
  const [showLeaseForm, setShowLeaseForm] = useState(false);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);
  const [leaseForm, setLeaseForm] = useState({
    unitId: "",
    monthlyRent: "",
    securityDeposit: "",
    startDate: "",
    endDate: "",
    lateFeeAmount: "",
    lateFeeGraceDays: "5",
    rentDueDay: "1",
    depositHoldingBank: "",
    depositHoldingAddress: "",
  });
  const [leaseSubmitting, setLeaseSubmitting] = useState(false);
  const [leaseError, setLeaseError] = useState("");
  const [selectedPropertyCookCounty, setSelectedPropertyCookCounty] =
    useState(false);
  const [depositCapError, setDepositCapError] = useState("");

  // Send message modal
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [messageForm, setMessageForm] = useState({
    subject: "",
    body: "",
  });
  const [messageSubmitting, setMessageSubmitting] = useState(false);
  const [messageError, setMessageError] = useState("");
  const [messageSuccess, setMessageSuccess] = useState("");

  // Lease lifecycle
  const [showRenewForm, setShowRenewForm] = useState(false);
  const [renewEndDate, setRenewEndDate] = useState("");
  const [renewSubmitting, setRenewSubmitting] = useState(false);
  const [renewError, setRenewError] = useState("");
  const [convertSubmitting, setConvertSubmitting] = useState(false);
  const [convertError, setConvertError] = useState("");
  const [showTerminateConfirm, setShowTerminateConfirm] = useState(false);
  const [terminateSubmitting, setTerminateSubmitting] = useState(false);
  const [terminateError, setTerminateError] = useState("");
  const [leaseActionSuccess, setLeaseActionSuccess] = useState("");

  // Security deposit return
  const [depositDeductions, setDepositDeductions] = useState<
    { description: string; amount: string }[]
  >([{ description: "", amount: "" }]);
  const [depositReturnSubmitting, setDepositReturnSubmitting] = useState(false);
  const [depositReturnError, setDepositReturnError] = useState("");

  useEffect(() => {
    async function loadTenant() {
      try {
        const res = await fetch(`/api/tenants/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Tenant not found");
          } else {
            setError("Failed to load tenant");
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        setTenant(data.tenant);
        setEditForm({
          firstName: data.tenant.firstName,
          lastName: data.tenant.lastName,
          email: data.tenant.email,
          phone: data.tenant.phone || "",
        });
      } catch {
        setError("Failed to load tenant");
      } finally {
        setLoading(false);
      }
    }

    loadTenant();
  }, [id]);

  // Load properties when lease form opens
  useEffect(() => {
    if (showLeaseForm && properties.length === 0) {
      fetch("/api/properties")
        .then((res) => res.json())
        .then((data) =>
          setProperties(
            (data.properties || []).map((p: { id: string; name: string; cookCounty?: boolean }) => ({
              id: p.id,
              name: p.name,
              cookCounty: p.cookCounty ?? false,
            }))
          )
        )
        .catch(() => {});
    }
  }, [showLeaseForm, properties.length]);

  // Load units when property is selected and track Cook County status
  useEffect(() => {
    if (selectedPropertyId) {
      setUnits([]);
      setLeaseForm((prev) => ({ ...prev, unitId: "" }));
      setDepositCapError("");
      const selected = properties.find((p) => p.id === selectedPropertyId);
      setSelectedPropertyCookCounty(selected?.cookCounty ?? false);
      fetch(`/api/properties/${selectedPropertyId}/units`)
        .then((res) => res.json())
        .then((data) => setUnits(data.units || []))
        .catch(() => {});
    } else {
      setSelectedPropertyCookCounty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPropertyId]);

  async function handleEditTenant(e: React.FormEvent) {
    e.preventDefault();
    setEditSubmitting(true);
    setEditError("");

    try {
      const res = await fetch(`/api/tenants/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: editForm.firstName.trim(),
          lastName: editForm.lastName.trim(),
          email: editForm.email.trim(),
          phone: editForm.phone.trim() || null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setEditError(data.error || "Failed to update tenant");
        setEditSubmitting(false);
        return;
      }

      const data = await res.json();
      setTenant((prev) =>
        prev
          ? {
              ...prev,
              firstName: data.tenant.firstName,
              lastName: data.tenant.lastName,
              email: data.tenant.email,
              phone: data.tenant.phone,
            }
          : null
      );
      setEditing(false);
    } catch {
      setEditError("Failed to update tenant");
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleCreateLease(e: React.FormEvent) {
    e.preventDefault();
    setLeaseSubmitting(true);
    setLeaseError("");
    setDepositCapError("");

    // Cook County: deposit cannot exceed 1.5x monthly rent
    if (selectedPropertyCookCounty && leaseForm.securityDeposit && leaseForm.monthlyRent) {
      const monthlyRentCents = Math.round(parseFloat(leaseForm.monthlyRent) * 100);
      const depositCents = Math.round(parseFloat(leaseForm.securityDeposit) * 100);
      const depositCap = Math.round(monthlyRentCents * 1.5);
      if (depositCents > depositCap) {
        const capDollars = (depositCap / 100).toFixed(2);
        setDepositCapError(
          `Cook County: Security deposit cannot exceed $${capDollars} (1.5x monthly rent)`
        );
        setLeaseSubmitting(false);
        return;
      }
    }

    try {
      const res = await fetch("/api/leases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unitId: leaseForm.unitId,
          tenantId: id,
          monthlyRent: Math.round(parseFloat(leaseForm.monthlyRent) * 100),
          securityDeposit: leaseForm.securityDeposit
            ? Math.round(parseFloat(leaseForm.securityDeposit) * 100)
            : undefined,
          startDate: leaseForm.startDate,
          endDate: leaseForm.endDate || undefined,
          lateFeeAmount: leaseForm.lateFeeAmount
            ? Math.round(parseFloat(leaseForm.lateFeeAmount) * 100)
            : undefined,
          lateFeeGraceDays: parseInt(leaseForm.lateFeeGraceDays, 10),
          rentDueDay: parseInt(leaseForm.rentDueDay, 10),
          depositHoldingBank: leaseForm.depositHoldingBank.trim() || undefined,
          depositHoldingAddress:
            leaseForm.depositHoldingAddress.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setLeaseError(data.error || "Failed to create lease");
        setLeaseSubmitting(false);
        return;
      }

      // Reload tenant data to get updated leases
      const tenantRes = await fetch(`/api/tenants/${id}`);
      if (tenantRes.ok) {
        const tenantData = await tenantRes.json();
        setTenant(tenantData.tenant);
      }
      setShowLeaseForm(false);
      setLeaseForm({
        unitId: "",
        monthlyRent: "",
        securityDeposit: "",
        startDate: "",
        endDate: "",
        lateFeeAmount: "",
        lateFeeGraceDays: "5",
        rentDueDay: "1",
        depositHoldingBank: "",
        depositHoldingAddress: "",
      });
      setSelectedPropertyId("");
      setSelectedPropertyCookCounty(false);
      setDepositCapError("");
    } catch {
      setLeaseError("Failed to create lease");
    } finally {
      setLeaseSubmitting(false);
    }
  }

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    setMessageSubmitting(true);
    setMessageError("");
    setMessageSuccess("");

    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: id,
          subject: messageForm.subject.trim(),
          body: messageForm.body.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setMessageError(data.error || "Failed to send message");
        setMessageSubmitting(false);
        return;
      }

      setMessageSuccess("Message sent successfully!");
      setTimeout(() => {
        setShowMessageModal(false);
        setMessageForm({ subject: "", body: "" });
        setMessageSuccess("");
      }, 2000);
    } catch {
      setMessageError("Failed to send message");
    } finally {
      setMessageSubmitting(false);
    }
  }

  async function reloadTenant() {
    const res = await fetch(`/api/tenants/${id}`);
    if (res.ok) {
      const data = await res.json();
      setTenant(data.tenant);
    }
  }

  async function handleRenewLease(e: React.FormEvent) {
    e.preventDefault();
    if (!activeLease) return;
    setRenewSubmitting(true);
    setRenewError("");
    setLeaseActionSuccess("");

    try {
      const res = await fetch(`/api/leases/${activeLease.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endDate: renewEndDate }),
      });

      if (!res.ok) {
        const data = await res.json();
        setRenewError(data.error || "Failed to renew lease");
        setRenewSubmitting(false);
        return;
      }

      await reloadTenant();
      setShowRenewForm(false);
      setRenewEndDate("");
      setLeaseActionSuccess("Lease renewed successfully!");
      setTimeout(() => setLeaseActionSuccess(""), 3000);
    } catch {
      setRenewError("Failed to renew lease");
    } finally {
      setRenewSubmitting(false);
    }
  }

  async function handleConvertToMonthToMonth() {
    if (!activeLease) return;
    setConvertSubmitting(true);
    setConvertError("");
    setLeaseActionSuccess("");

    try {
      const res = await fetch(`/api/leases/${activeLease.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leaseType: "month_to_month", endDate: null }),
      });

      if (!res.ok) {
        const data = await res.json();
        setConvertError(data.error || "Failed to convert lease");
        setConvertSubmitting(false);
        return;
      }

      await reloadTenant();
      setLeaseActionSuccess("Lease converted to month-to-month!");
      setTimeout(() => setLeaseActionSuccess(""), 3000);
    } catch {
      setConvertError("Failed to convert lease");
    } finally {
      setConvertSubmitting(false);
    }
  }

  async function handleTerminateLease() {
    if (!activeLease) return;
    setTerminateSubmitting(true);
    setTerminateError("");
    setLeaseActionSuccess("");

    try {
      const res = await fetch(`/api/leases/${activeLease.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "terminated" }),
      });

      if (!res.ok) {
        const data = await res.json();
        setTerminateError(data.error || "Failed to terminate lease");
        setTerminateSubmitting(false);
        return;
      }

      await reloadTenant();
      setShowTerminateConfirm(false);
      setLeaseActionSuccess("Lease terminated.");
      setTimeout(() => setLeaseActionSuccess(""), 3000);
    } catch {
      setTerminateError("Failed to terminate lease");
    } finally {
      setTerminateSubmitting(false);
    }
  }

  async function handleRecordDepositReturn() {
    const depositLease = activeLease?.moveOutDate
      ? activeLease
      : tenant?.leases?.find((l) => l.status === "terminated");
    if (!depositLease) return;
    setDepositReturnSubmitting(true);
    setDepositReturnError("");

    const parsedDeductions = depositDeductions
      .filter((d) => d.description.trim() && d.amount)
      .map((d) => ({
        description: d.description.trim(),
        amount: Math.round(parseFloat(d.amount) * 100),
      }));

    try {
      const res = await fetch(`/api/leases/${depositLease.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          depositDeductions: parsedDeductions,
          depositReturnedDate: new Date().toISOString().split("T")[0],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setDepositReturnError(data.error || "Failed to record deposit return");
        setDepositReturnSubmitting(false);
        return;
      }

      await reloadTenant();
      setDepositDeductions([{ description: "", amount: "" }]);
      setLeaseActionSuccess("Security deposit return recorded!");
      setTimeout(() => setLeaseActionSuccess(""), 3000);
    } catch {
      setDepositReturnError("Failed to record deposit return");
    } finally {
      setDepositReturnSubmitting(false);
    }
  }

  const activeLease = tenant?.leases?.find((l) => l.status === "active");
  const terminatedLease = tenant?.leases?.find((l) => l.status === "terminated");

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/tenants" className="hover:text-blue-600">
            Tenants
          </Link>
          <span>/</span>
          <span className="text-gray-900">
            {tenant
              ? `${tenant.firstName} ${tenant.lastName}`
              : "Tenant Detail"}
          </span>
        </nav>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
            <Link
              href="/tenants"
              className="ml-2 font-medium text-red-800 underline hover:text-red-900"
            >
              Back to tenants
            </Link>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading tenant...</p>
            </div>
          </div>
        ) : tenant ? (
          <div className="space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {tenant.firstName} {tenant.lastName}
                </h1>
                <p className="mt-1 text-sm text-gray-500">
                  Added {formatDate(tenant.createdAt)}
                </p>
              </div>
              <button
                onClick={() => setShowMessageModal(true)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Send Message
              </button>
            </div>

            {/* Tenant Info Card */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Tenant Information
                </h2>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="text-sm font-medium text-blue-600 hover:text-blue-700"
                  >
                    Edit
                  </button>
                )}
              </div>

              {editing ? (
                <form onSubmit={handleEditTenant} className="space-y-4">
                  {editError && (
                    <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
                      {editError}
                    </div>
                  )}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        First Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editForm.firstName}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            firstName: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Last Name
                      </label>
                      <input
                        type="text"
                        required
                        value={editForm.lastName}
                        onChange={(e) =>
                          setEditForm((f) => ({
                            ...f,
                            lastName: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Email
                      </label>
                      <input
                        type="email"
                        required
                        value={editForm.email}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, email: e.target.value }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Phone
                      </label>
                      <input
                        type="tel"
                        value={editForm.phone}
                        onChange={(e) =>
                          setEditForm((f) => ({ ...f, phone: e.target.value }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setEditError("");
                        setEditForm({
                          firstName: tenant.firstName,
                          lastName: tenant.lastName,
                          email: tenant.email,
                          phone: tenant.phone || "",
                        });
                      }}
                      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={editSubmitting}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {editSubmitting ? "Saving..." : "Save Changes"}
                    </button>
                  </div>
                </form>
              ) : (
                <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <InfoField
                    label="First Name"
                    value={tenant.firstName}
                  />
                  <InfoField
                    label="Last Name"
                    value={tenant.lastName}
                  />
                  <InfoField label="Email" value={tenant.email} />
                  <InfoField label="Phone" value={tenant.phone} />
                </dl>
              )}
            </div>

            {/* Active Lease Section */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">
                  Active Lease
                </h2>
                {activeLease && (
                  <LeaseStatusBadge status={activeLease.status} />
                )}
              </div>

              {activeLease ? (
                <div>
                  <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <InfoField
                      label="Property"
                      value={activeLease.unit.property.name}
                    />
                    <InfoField
                      label="Unit"
                      value={activeLease.unit.unitNumber}
                    />
                    <InfoField
                      label="Monthly Rent"
                      value={`$${formatMoney(activeLease.monthlyRent)}`}
                    />
                    <InfoField
                      label="Security Deposit"
                      value={
                        activeLease.securityDeposit
                          ? `$${formatMoney(activeLease.securityDeposit)}`
                          : null
                      }
                    />
                    <InfoField
                      label="Start Date"
                      value={formatDate(activeLease.startDate)}
                    />
                    <InfoField
                      label="End Date"
                      value={
                        activeLease.endDate
                          ? formatDate(activeLease.endDate)
                          : "Month-to-month"
                      }
                    />
                    <InfoField
                      label="Lease Type"
                      value={
                        activeLease.leaseType === "fixed"
                          ? "Fixed Term"
                          : "Month-to-Month"
                      }
                    />
                    <InfoField
                      label="Rent Due Day"
                      value={`Day ${activeLease.rentDueDay} of each month`}
                    />
                    <InfoField
                      label="Late Fee"
                      value={
                        activeLease.lateFeeAmount
                          ? `$${formatMoney(activeLease.lateFeeAmount)} (after ${activeLease.lateFeeGraceDays} days)`
                          : "None"
                      }
                    />
                    <InfoField
                      label="Deposit Bank"
                      value={activeLease.depositHoldingBank}
                    />
                    <InfoField
                      label="Deposit Address"
                      value={activeLease.depositHoldingAddress}
                    />
                  </dl>

                  {/* Lease Action Success Message */}
                  {leaseActionSuccess && (
                    <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                      {leaseActionSuccess}
                    </div>
                  )}

                  {/* Lease Lifecycle Action Buttons */}
                  <div className="mt-6 border-t border-gray-200 pt-4">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700">
                      Lease Actions
                    </h3>

                    {/* Error messages */}
                    {renewError && (
                      <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {renewError}
                      </div>
                    )}
                    {convertError && (
                      <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {convertError}
                      </div>
                    )}
                    {terminateError && (
                      <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {terminateError}
                      </div>
                    )}

                    <div className="flex flex-wrap gap-3">
                      <button
                        onClick={() => {
                          setShowRenewForm(!showRenewForm);
                          setRenewError("");
                        }}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                      >
                        Renew Lease
                      </button>
                      <button
                        onClick={handleConvertToMonthToMonth}
                        disabled={convertSubmitting || activeLease.leaseType === "month_to_month"}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {convertSubmitting
                          ? "Converting..."
                          : "Convert to Month-to-Month"}
                      </button>
                      <button
                        onClick={() => {
                          setShowTerminateConfirm(true);
                          setTerminateError("");
                        }}
                        className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
                      >
                        Terminate Lease
                      </button>
                    </div>

                    {/* Renew Lease Inline Form */}
                    {showRenewForm && (
                      <form
                        onSubmit={handleRenewLease}
                        className="mt-4 flex items-end gap-3 rounded-md border border-gray-200 bg-gray-50 p-4"
                      >
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700">
                            New End Date
                          </label>
                          <input
                            type="date"
                            required
                            value={renewEndDate}
                            onChange={(e) => setRenewEndDate(e.target.value)}
                            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        </div>
                        <button
                          type="submit"
                          disabled={renewSubmitting}
                          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        >
                          {renewSubmitting ? "Renewing..." : "Confirm Renewal"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setShowRenewForm(false);
                            setRenewEndDate("");
                            setRenewError("");
                          }}
                          className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                        >
                          Cancel
                        </button>
                      </form>
                    )}

                    {/* Terminate Confirmation Dialog */}
                    {showTerminateConfirm && (
                      <div className="mt-4 rounded-md border border-red-200 bg-red-50 p-4">
                        <p className="mb-3 text-sm font-medium text-red-800">
                          Are you sure you want to terminate this lease? This
                          action cannot be undone.
                        </p>
                        <div className="flex gap-3">
                          <button
                            onClick={handleTerminateLease}
                            disabled={terminateSubmitting}
                            className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
                          >
                            {terminateSubmitting
                              ? "Terminating..."
                              : "Yes, Terminate Lease"}
                          </button>
                          <button
                            onClick={() => {
                              setShowTerminateConfirm(false);
                              setTerminateError("");
                            }}
                            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                <div>
                  <p className="mb-4 text-sm text-gray-500">
                    This tenant does not have an active lease.
                  </p>
                  {!showLeaseForm && (
                    <button
                      onClick={() => setShowLeaseForm(true)}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                    >
                      Create Lease
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Security Deposit Return Section */}
            {(() => {
              const depositLease = activeLease?.moveOutDate
                ? activeLease
                : terminatedLease;
              if (
                !depositLease ||
                !depositLease.securityDeposit ||
                depositLease.depositReturnedDate
              )
                return null;

              const totalDeductionsCents = depositDeductions
                .filter((d) => d.description.trim() && d.amount)
                .reduce(
                  (sum, d) =>
                    sum + Math.round(parseFloat(d.amount || "0") * 100),
                  0
                );
              const returnAmountCents =
                depositLease.securityDeposit - totalDeductionsCents;

              // Deadline calculations
              const moveOut = depositLease.moveOutDate
                ? new Date(depositLease.moveOutDate)
                : null;
              const now = new Date();
              const statementDeadlineDays = moveOut
                ? Math.ceil(
                    (moveOut.getTime() +
                      30 * 24 * 60 * 60 * 1000 -
                      now.getTime()) /
                      (24 * 60 * 60 * 1000)
                  )
                : null;
              const returnDeadlineDays = moveOut
                ? Math.ceil(
                    (moveOut.getTime() +
                      45 * 24 * 60 * 60 * 1000 -
                      now.getTime()) /
                      (24 * 60 * 60 * 1000)
                  )
                : null;

              return (
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold text-gray-900">
                    Security Deposit Return
                  </h2>

                  {/* Deadline Warnings */}
                  {moveOut && (
                    <div className="mb-4 space-y-2">
                      {statementDeadlineDays !== null && (
                        <div
                          className={`rounded-md p-3 text-sm font-medium ${
                            statementDeadlineDays <= 5
                              ? "bg-red-50 text-red-700"
                              : statementDeadlineDays <= 15
                                ? "bg-yellow-50 text-yellow-700"
                                : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {statementDeadlineDays > 0
                            ? `${statementDeadlineDays} days remaining to send itemized statement`
                            : "Itemized statement deadline has passed!"}
                        </div>
                      )}
                      {returnDeadlineDays !== null && (
                        <div
                          className={`rounded-md p-3 text-sm font-medium ${
                            returnDeadlineDays <= 5
                              ? "bg-red-50 text-red-700"
                              : returnDeadlineDays <= 15
                                ? "bg-yellow-50 text-yellow-700"
                                : "bg-blue-50 text-blue-700"
                          }`}
                        >
                          {returnDeadlineDays > 0
                            ? `${returnDeadlineDays} days remaining to return deposit`
                            : "Deposit return deadline has passed!"}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Deposit Info */}
                  <dl className="mb-4 grid gap-4 sm:grid-cols-3">
                    <InfoField
                      label="Deposit Amount"
                      value={`$${formatMoney(depositLease.securityDeposit)}`}
                    />
                    <InfoField
                      label="Holding Bank"
                      value={depositLease.depositHoldingBank}
                    />
                    <InfoField
                      label="Bank Address"
                      value={depositLease.depositHoldingAddress}
                    />
                  </dl>

                  {/* Existing deductions from server */}
                  {depositLease.depositDeductions &&
                    depositLease.depositDeductions.length > 0 && (
                      <div className="mb-4">
                        <h3 className="mb-2 text-sm font-semibold text-gray-700">
                          Recorded Deductions
                        </h3>
                        <div className="space-y-1">
                          {depositLease.depositDeductions.map((d, i) => (
                            <div
                              key={i}
                              className="flex justify-between rounded-md bg-gray-50 px-3 py-2 text-sm"
                            >
                              <span className="text-gray-700">
                                {d.description}
                              </span>
                              <span className="font-medium text-gray-900">
                                ${formatMoney(d.amount)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                  {/* Itemize Deductions Form */}
                  <div className="border-t border-gray-200 pt-4">
                    <h3 className="mb-3 text-sm font-semibold text-gray-700">
                      Itemize Deductions
                    </h3>

                    {depositReturnError && (
                      <div className="mb-3 rounded-md bg-red-50 p-3 text-sm text-red-700">
                        {depositReturnError}
                      </div>
                    )}

                    <div className="space-y-2">
                      {depositDeductions.map((deduction, index) => (
                        <div key={index} className="flex items-center gap-3">
                          <input
                            type="text"
                            placeholder="Description (e.g., Carpet cleaning)"
                            value={deduction.description}
                            onChange={(e) => {
                              const updated = [...depositDeductions];
                              updated[index] = {
                                ...updated[index],
                                description: e.target.value,
                              };
                              setDepositDeductions(updated);
                            }}
                            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                          <div className="relative w-32">
                            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">
                              $
                            </span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              placeholder="0.00"
                              value={deduction.amount}
                              onChange={(e) => {
                                const updated = [...depositDeductions];
                                updated[index] = {
                                  ...updated[index],
                                  amount: e.target.value,
                                };
                                setDepositDeductions(updated);
                              }}
                              className="w-full rounded-md border border-gray-300 py-2 pl-7 pr-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                            />
                          </div>
                          {depositDeductions.length > 1 && (
                            <button
                              type="button"
                              onClick={() => {
                                setDepositDeductions(
                                  depositDeductions.filter(
                                    (_, i) => i !== index
                                  )
                                );
                              }}
                              className="text-red-500 hover:text-red-700"
                              title="Remove row"
                            >
                              <svg
                                className="h-5 w-5"
                                fill="none"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                strokeWidth={2}
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() =>
                        setDepositDeductions([
                          ...depositDeductions,
                          { description: "", amount: "" },
                        ])
                      }
                      className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700"
                    >
                      + Add Deduction Row
                    </button>

                    {/* Calculate Return Display */}
                    <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-4">
                      <h4 className="mb-2 text-sm font-semibold text-gray-700">
                        Calculate Return
                      </h4>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Original Deposit
                          </span>
                          <span className="font-medium text-gray-900">
                            ${formatMoney(depositLease.securityDeposit)}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-gray-600">
                            Total Deductions
                          </span>
                          <span className="font-medium text-red-600">
                            -${formatMoney(totalDeductionsCents)}
                          </span>
                        </div>
                        <div className="flex justify-between border-t border-gray-300 pt-1">
                          <span className="font-semibold text-gray-700">
                            Return Amount
                          </span>
                          <span
                            className={`font-bold ${
                              returnAmountCents >= 0
                                ? "text-green-700"
                                : "text-red-700"
                            }`}
                          >
                            ${formatMoney(Math.max(0, returnAmountCents))}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Record Return Button */}
                    <div className="mt-4 flex justify-end">
                      <button
                        onClick={handleRecordDepositReturn}
                        disabled={depositReturnSubmitting}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {depositReturnSubmitting
                          ? "Recording..."
                          : "Record Return"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* Create Lease Form (expandable) */}
            {showLeaseForm && !activeLease && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Create New Lease
                  </h2>
                  <button
                    onClick={() => {
                      setShowLeaseForm(false);
                      setLeaseError("");
                    }}
                    className="text-sm font-medium text-gray-500 hover:text-gray-700"
                  >
                    Cancel
                  </button>
                </div>

                {leaseError && (
                  <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                    {leaseError}
                  </div>
                )}

                <form onSubmit={handleCreateLease} className="space-y-4">
                  {/* Property and Unit selection */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Property <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={selectedPropertyId}
                        onChange={(e) =>
                          setSelectedPropertyId(e.target.value)
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      >
                        <option value="">Select a property</option>
                        {properties.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Unit <span className="text-red-500">*</span>
                      </label>
                      <select
                        required
                        value={leaseForm.unitId}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            unitId: e.target.value,
                          }))
                        }
                        disabled={!selectedPropertyId}
                        className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-gray-100 disabled:text-gray-400"
                      >
                        <option value="">
                          {selectedPropertyId
                            ? "Select a unit"
                            : "Select a property first"}
                        </option>
                        {units.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.unitNumber}{" "}
                            {u.status === "occupied" ? "(occupied)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Cook County info banner */}
                  {selectedPropertyCookCounty && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                      <strong>Cook County property</strong> — Security deposit
                      capped at 1.5x monthly rent, late fee capped at $10 + 5%
                      of rent over $1,000
                    </div>
                  )}

                  {/* Rent and Deposit */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Monthly Rent ($){" "}
                        <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={leaseForm.monthlyRent}
                        onChange={(e) => {
                          setLeaseForm((f) => ({
                            ...f,
                            monthlyRent: e.target.value,
                          }));
                          setDepositCapError("");
                        }}
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="1200.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Security Deposit ($)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={leaseForm.securityDeposit}
                        onChange={(e) => {
                          setLeaseForm((f) => ({
                            ...f,
                            securityDeposit: e.target.value,
                          }));
                          setDepositCapError("");
                        }}
                        className={`mt-1 block w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-1 ${
                          depositCapError
                            ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                            : "border-gray-300 focus:border-blue-500 focus:ring-blue-500"
                        }`}
                        placeholder="1200.00"
                      />
                      {depositCapError && (
                        <p className="mt-1 text-xs text-red-600">
                          {depositCapError}
                        </p>
                      )}
                      {selectedPropertyCookCounty &&
                        leaseForm.monthlyRent &&
                        !depositCapError && (
                          <p className="mt-1 text-xs text-amber-600">
                            Cook County max: $
                            {(
                              (Math.round(
                                parseFloat(leaseForm.monthlyRent) * 100
                              ) *
                                1.5) /
                              100
                            ).toFixed(2)}
                          </p>
                        )}
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Start Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="date"
                        required
                        value={leaseForm.startDate}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            startDate: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        End Date (optional)
                      </label>
                      <input
                        type="date"
                        value={leaseForm.endDate}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            endDate: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Leave blank for month-to-month
                      </p>
                    </div>
                  </div>

                  {/* Late fee and grace days */}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Late Fee Amount ($)
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={leaseForm.lateFeeAmount}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            lateFeeAmount: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="50.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Grace Period (days)
                      </label>
                      <input
                        type="number"
                        min="5"
                        value={leaseForm.lateFeeGraceDays}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            lateFeeGraceDays: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        Minimum 5 days (IL law)
                      </p>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Rent Due Day
                      </label>
                      <input
                        type="number"
                        min="1"
                        max="28"
                        value={leaseForm.rentDueDay}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            rentDueDay: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      />
                    </div>
                  </div>

                  {/* Deposit holding info */}
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Deposit Holding Bank
                      </label>
                      <input
                        type="text"
                        value={leaseForm.depositHoldingBank}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            depositHoldingBank: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Bank name"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Deposit Holding Address
                      </label>
                      <input
                        type="text"
                        value={leaseForm.depositHoldingAddress}
                        onChange={(e) =>
                          setLeaseForm((f) => ({
                            ...f,
                            depositHoldingAddress: e.target.value,
                          }))
                        }
                        className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="Bank address"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setShowLeaseForm(false);
                        setLeaseError("");
                      }}
                      className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={leaseSubmitting}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {leaseSubmitting ? "Creating..." : "Create Lease"}
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* Previous Leases */}
            {tenant.leases.filter((l) => l.status !== "active").length > 0 && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">
                  Previous Leases
                </h2>
                <div className="space-y-3">
                  {tenant.leases
                    .filter((l) => l.status !== "active")
                    .map((lease) => (
                      <div
                        key={lease.id}
                        className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-3"
                      >
                        <div>
                          <p className="text-sm font-medium text-gray-900">
                            {lease.unit.property.name} - Unit{" "}
                            {lease.unit.unitNumber}
                          </p>
                          <p className="text-xs text-gray-500">
                            {formatDate(lease.startDate)}
                            {lease.endDate
                              ? ` - ${formatDate(lease.endDate)}`
                              : ""}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-sm text-gray-700">
                            ${formatMoney(lease.monthlyRent)}/mo
                          </span>
                          <LeaseStatusBadge status={lease.status} />
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Recent Payments */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Recent Payments
              </h2>
              {tenant.payments.length === 0 ? (
                <p className="text-sm text-gray-500">No payments recorded.</p>
              ) : (
                <div className="overflow-hidden rounded-lg border border-gray-200">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Type
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                          Status
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {tenant.payments.map((payment) => (
                        <tr key={payment.id} className="hover:bg-gray-50">
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-500">
                            {formatDate(payment.createdAt)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700">
                            {payment.type
                              ? payment.type.charAt(0).toUpperCase() +
                                payment.type.slice(1).replace(/_/g, " ")
                              : "--"}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900">
                            ${formatMoney(payment.amount)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3">
                            <PaymentStatusBadge status={payment.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Recent Notices */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">
                Recent Notices
              </h2>
              {tenant.notices.length === 0 ? (
                <p className="text-sm text-gray-500">No notices sent.</p>
              ) : (
                <div className="space-y-3">
                  {tenant.notices.map((notice) => (
                    <div
                      key={notice.id}
                      className="flex items-center justify-between rounded-md border border-gray-100 bg-gray-50 px-4 py-3"
                    >
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {notice.subject}
                        </p>
                        <p className="text-xs text-gray-500">
                          {notice.type.replace(/_/g, " ").charAt(0).toUpperCase() +
                            notice.type.replace(/_/g, " ").slice(1)}{" "}
                          &middot; {formatDate(notice.createdAt)}
                        </p>
                      </div>
                      <span
                        className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${
                          notice.status === "sent"
                            ? "bg-green-100 text-green-700"
                            : notice.status === "draft"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-gray-100 text-gray-700"
                        }`}
                      >
                        {notice.status.charAt(0).toUpperCase() +
                          notice.status.slice(1)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Timestamps */}
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
              <div className="flex flex-wrap gap-6 text-xs text-gray-400">
                <span>Created: {formatDate(tenant.createdAt)}</span>
                <span>Updated: {formatDate(tenant.updatedAt)}</span>
              </div>
            </div>
          </div>
        ) : null}
      </div>

      {/* Send Message Modal */}
      {showMessageModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">
                Send Message
              </h2>
              <button
                onClick={() => {
                  setShowMessageModal(false);
                  setMessageError("");
                  setMessageSuccess("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg
                  className="h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </button>
            </div>

            <p className="mb-4 text-sm text-gray-500">
              Sending to{" "}
              <span className="font-medium text-gray-700">
                {tenant?.firstName} {tenant?.lastName}
              </span>
            </p>

            {messageError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {messageError}
              </div>
            )}

            {messageSuccess && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                {messageSuccess}
              </div>
            )}

            <form onSubmit={handleSendMessage} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Subject <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={messageForm.subject}
                  onChange={(e) =>
                    setMessageForm((f) => ({ ...f, subject: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Message subject"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Message <span className="text-red-500">*</span>
                </label>
                <textarea
                  required
                  rows={5}
                  value={messageForm.body}
                  onChange={(e) =>
                    setMessageForm((f) => ({ ...f, body: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Type your message..."
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowMessageModal(false);
                    setMessageError("");
                    setMessageSuccess("");
                  }}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={messageSubmitting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {messageSubmitting ? "Sending..." : "Send Message"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
