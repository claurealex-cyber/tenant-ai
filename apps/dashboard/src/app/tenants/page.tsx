"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  createdAt: string;
  leases: {
    id: string;
    status: string;
    monthlyRent: number;
    unit: {
      id: string;
      unitNumber: string;
      property: {
        id: string;
        name: string;
      };
    };
  }[];
}

interface Property {
  id: string;
  name: string;
}

function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

export default function TenantsPage() {
  const router = useRouter();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Add Tenant modal
  const [showAddModal, setShowAddModal] = useState(false);
  const [addForm, setAddForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
  });
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState("");

  // Invite Tenant modal
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteForm, setInviteForm] = useState({
    email: "",
    propertyId: "",
    unitId: "",
  });
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [inviteSuccess, setInviteSuccess] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [units, setUnits] = useState<{ id: string; unitNumber: string }[]>([]);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/tenants");
      if (!res.ok) {
        setError("Failed to load tenants");
        setLoading(false);
        return;
      }

      const data = await res.json();
      setTenants(data.tenants || []);
    } catch {
      setError("Failed to load tenants");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  // Load properties when invite modal opens
  useEffect(() => {
    if (showInviteModal && properties.length === 0) {
      fetch("/api/properties")
        .then((res) => res.json())
        .then((data) => setProperties(data.properties || []))
        .catch(() => {});
    }
  }, [showInviteModal, properties.length]);

  // Load units when property is selected in invite modal
  useEffect(() => {
    if (inviteForm.propertyId) {
      setUnits([]);
      setInviteForm((prev) => ({ ...prev, unitId: "" }));
      fetch(`/api/properties/${inviteForm.propertyId}/units`)
        .then((res) => res.json())
        .then((data) => setUnits(data.units || []))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inviteForm.propertyId]);

  async function handleAddTenant(e: React.FormEvent) {
    e.preventDefault();
    setAddSubmitting(true);
    setAddError("");

    try {
      const res = await fetch("/api/tenants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          firstName: addForm.firstName.trim(),
          lastName: addForm.lastName.trim(),
          email: addForm.email.trim(),
          phone: addForm.phone.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setAddError(data.error || "Failed to create tenant");
        setAddSubmitting(false);
        return;
      }

      setShowAddModal(false);
      setAddForm({ firstName: "", lastName: "", email: "", phone: "" });
      loadTenants();
    } catch {
      setAddError("Failed to create tenant");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleInviteTenant(e: React.FormEvent) {
    e.preventDefault();
    setInviteSubmitting(true);
    setInviteError("");
    setInviteSuccess("");

    try {
      const res = await fetch("/api/tenants/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteForm.email.trim(),
          propertyId: inviteForm.propertyId,
          unitId: inviteForm.unitId || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setInviteError(data.error || "Failed to send invite");
        setInviteSubmitting(false);
        return;
      }

      setInviteSuccess("Invite sent successfully!");
      setTimeout(() => {
        setShowInviteModal(false);
        setInviteForm({ email: "", propertyId: "", unitId: "" });
        setInviteSuccess("");
      }, 2000);
    } catch {
      setInviteError("Failed to send invite");
    } finally {
      setInviteSubmitting(false);
    }
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Tenants</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage your tenants and their lease information.
            </p>
          </div>
          <div className="flex gap-3">
            <button
              onClick={() => setShowInviteModal(true)}
              className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Invite Tenant
            </button>
            <button
              onClick={() => setShowAddModal(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Tenant
            </button>
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
              <p className="mt-3 text-sm text-gray-500">Loading tenants...</p>
            </div>
          </div>
        ) : tenants.length === 0 ? (
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
                d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z"
              />
            </svg>
            <h3 className="mt-4 text-lg font-medium text-gray-900">No tenants yet</h3>
            <p className="mt-1 text-sm text-gray-500">
              Get started by adding your first tenant or sending an invite.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={() => setShowInviteModal(true)}
                className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Invite Tenant
              </button>
              <button
                onClick={() => setShowAddModal(true)}
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Add Tenant
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Name
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Email
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Phone
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Property / Unit
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Lease Status
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                    Rent
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {tenants.map((tenant) => {
                  const activeLease = tenant.leases?.[0];
                  return (
                    <tr
                      key={tenant.id}
                      className="cursor-pointer transition-colors hover:bg-gray-50"
                      onClick={() =>
                        router.push(`/tenants/${tenant.id}`)
                      }
                    >
                      <td className="whitespace-nowrap px-6 py-4">
                        <Link
                          href={`/tenants/${tenant.id}`}
                          className="text-sm font-medium text-gray-900 hover:text-blue-600"
                        >
                          {tenant.firstName} {tenant.lastName}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {tenant.email}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm font-mono text-gray-500">
                        {tenant.phone || "--"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {activeLease
                          ? `${activeLease.unit.property.name} - ${activeLease.unit.unitNumber}`
                          : "--"}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        {activeLease ? (
                          <LeaseStatusBadge status={activeLease.status} />
                        ) : (
                          <span className="inline-flex rounded-full px-2 py-1 text-xs font-medium bg-gray-100 text-gray-500">
                            No Lease
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {activeLease
                          ? `$${formatMoney(activeLease.monthlyRent)}`
                          : "--"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add Tenant Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Add Tenant</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setAddError("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {addError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {addError}
              </div>
            )}

            <form onSubmit={handleAddTenant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  First Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={addForm.firstName}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, firstName: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="John"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Last Name <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={addForm.lastName}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, lastName: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="Doe"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={addForm.email}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="john@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Phone
                </label>
                <input
                  type="tel"
                  value={addForm.phone}
                  onChange={(e) =>
                    setAddForm((f) => ({ ...f, phone: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="(312) 555-0100"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowAddModal(false);
                    setAddError("");
                  }}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={addSubmitting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {addSubmitting ? "Creating..." : "Add Tenant"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Invite Tenant Modal */}
      {showInviteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="mx-4 w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900">Invite Tenant</h2>
              <button
                onClick={() => {
                  setShowInviteModal(false);
                  setInviteError("");
                  setInviteSuccess("");
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {inviteError && (
              <div className="mb-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                {inviteError}
              </div>
            )}

            {inviteSuccess && (
              <div className="mb-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                {inviteSuccess}
              </div>
            )}

            <form onSubmit={handleInviteTenant} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={inviteForm.email}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, email: e.target.value }))
                  }
                  className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  placeholder="tenant@example.com"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">
                  Property <span className="text-red-500">*</span>
                </label>
                <select
                  required
                  value={inviteForm.propertyId}
                  onChange={(e) =>
                    setInviteForm((f) => ({ ...f, propertyId: e.target.value }))
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
              {inviteForm.propertyId && units.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-gray-700">
                    Unit (optional)
                  </label>
                  <select
                    value={inviteForm.unitId}
                    onChange={(e) =>
                      setInviteForm((f) => ({ ...f, unitId: e.target.value }))
                    }
                    className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  >
                    <option value="">Select a unit</option>
                    {units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.unitNumber}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowInviteModal(false);
                    setInviteError("");
                    setInviteSuccess("");
                  }}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={inviteSubmitting}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {inviteSubmitting ? "Sending..." : "Send Invite"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </DashboardShell>
  );
}
