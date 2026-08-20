"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface PricingTier {
  id: string;
  name: string;
  displayName: string;
  basePriceCents: number;
  includedAiCents: number;
  aiMarkupPercent: number;
  maxProperties: number | null;
  maxPhoneNumbers: number | null;
  websiteEnabled: boolean;
  customDomainEnabled: boolean;
  isActive: boolean;
  description: string | null;
  sortOrder: number;
  _count: {
    subscriptions: number;
  };
}

interface TierForm {
  name: string;
  displayName: string;
  basePriceCents: string;
  includedAiCents: string;
  aiMarkupPercent: string;
  maxProperties: string;
  maxPhoneNumbers: string;
  sortOrder: string;
}

const emptyForm: TierForm = {
  name: "",
  displayName: "",
  basePriceCents: "",
  includedAiCents: "",
  aiMarkupPercent: "50",
  maxProperties: "",
  maxPhoneNumbers: "",
  sortOrder: "0",
};

function formatCents(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function AdminPricingPage() {
  const [tiers, setTiers] = useState<PricingTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState("");

  // Add tier form
  const [showAddForm, setShowAddForm] = useState(false);
  const [addForm, setAddForm] = useState<TierForm>(emptyForm);

  // Edit state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<TierForm>(emptyForm);

  useEffect(() => {
    loadTiers();
  }, []);

  async function loadTiers() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/admin/pricing");
      if (!res.ok) {
        setError("Failed to load pricing tiers");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setTiers(data.tiers || []);
    } catch {
      setError("Failed to load pricing tiers");
    } finally {
      setLoading(false);
    }
  }

  async function handleAddTier() {
    if (!addForm.name || !addForm.displayName || !addForm.basePriceCents || !addForm.includedAiCents) {
      setSaveMessage("Name, display name, base price, and included AI are required.");
      return;
    }
    if (Number(addForm.basePriceCents) < 0 || Number(addForm.includedAiCents) < 0) {
      setSaveMessage("Prices must be positive values.");
      return;
    }
    if (isNaN(Number(addForm.basePriceCents)) || isNaN(Number(addForm.includedAiCents))
      || !isFinite(Number(addForm.basePriceCents)) || !isFinite(Number(addForm.includedAiCents))) {
      setSaveMessage("Prices must be valid numbers.");
      return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const body: Record<string, unknown> = {
        name: addForm.name,
        displayName: addForm.displayName,
        basePriceCents: Number(addForm.basePriceCents),
        includedAiCents: Number(addForm.includedAiCents),
        aiMarkupPercent: Number(addForm.aiMarkupPercent) || 50,
        sortOrder: Number(addForm.sortOrder) || 0,
      };
      if (addForm.maxProperties) body.maxProperties = Number(addForm.maxProperties);
      if (addForm.maxPhoneNumbers) body.maxPhoneNumbers = Number(addForm.maxPhoneNumbers);

      const res = await fetch("/api/admin/pricing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errData = await res.json();
        setSaveMessage(errData.error || "Failed to create tier.");
      } else {
        setSaveMessage("Tier created successfully.");
        setShowAddForm(false);
        setAddForm(emptyForm);
        await loadTiers();
      }
    } catch {
      setSaveMessage("Failed to create tier.");
    } finally {
      setSaving(false);
    }
  }

  function startEdit(tier: PricingTier) {
    setEditingId(tier.id);
    setEditForm({
      name: tier.name,
      displayName: tier.displayName,
      basePriceCents: String(tier.basePriceCents),
      includedAiCents: String(tier.includedAiCents),
      aiMarkupPercent: String(tier.aiMarkupPercent),
      maxProperties: tier.maxProperties !== null ? String(tier.maxProperties) : "",
      maxPhoneNumbers: tier.maxPhoneNumbers !== null ? String(tier.maxPhoneNumbers) : "",
      sortOrder: String(tier.sortOrder),
    });
    setSaveMessage("");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm(emptyForm);
  }

  async function handleSaveEdit() {
    if (!editingId) return;
    setSaving(true);
    setSaveMessage("");
    try {
      const body: Record<string, unknown> = {
        id: editingId,
        name: editForm.name,
        displayName: editForm.displayName,
        basePriceCents: Number(editForm.basePriceCents),
        includedAiCents: Number(editForm.includedAiCents),
        aiMarkupPercent: Number(editForm.aiMarkupPercent),
        sortOrder: Number(editForm.sortOrder) || 0,
        maxProperties: editForm.maxProperties ? Number(editForm.maxProperties) : null,
        maxPhoneNumbers: editForm.maxPhoneNumbers ? Number(editForm.maxPhoneNumbers) : null,
      };

      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setSaveMessage("Failed to update tier.");
      } else {
        setSaveMessage("Tier updated successfully.");
        setEditingId(null);
        setEditForm(emptyForm);
        await loadTiers();
      }
    } catch {
      setSaveMessage("Failed to update tier.");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleActive(tier: PricingTier) {
    // Confirmation when deactivating a tier with subscribers
    if (tier.isActive && tier._count.subscriptions > 0) {
      const confirmed = window.confirm(
        `This tier has ${tier._count.subscriptions} active subscriber${tier._count.subscriptions !== 1 ? "s" : ""}. Deactivating it will prevent new sign-ups. Continue?`
      );
      if (!confirmed) return;
    }
    setSaving(true);
    setSaveMessage("");
    try {
      const res = await fetch("/api/admin/pricing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: tier.id, isActive: !tier.isActive }),
      });
      if (!res.ok) {
        setSaveMessage("Failed to toggle tier status.");
      } else {
        await loadTiers();
      }
    } catch {
      setSaveMessage("Failed to toggle tier status.");
    } finally {
      setSaving(false);
    }
  }

  function renderFormRow(
    form: TierForm,
    setForm: (f: TierForm) => void,
    onSave: () => void,
    onCancel: () => void,
    saveLabel: string
  ) {
    return (
      <tr className="bg-blue-50">
        <td className="px-4 py-3">
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            placeholder="slug_name"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="text"
            value={form.displayName}
            onChange={(e) => setForm({ ...form, displayName: e.target.value })}
            placeholder="Display Name"
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="number"
            value={form.basePriceCents}
            onChange={(e) => setForm({ ...form, basePriceCents: e.target.value })}
            placeholder="0"
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="number"
            value={form.includedAiCents}
            onChange={(e) => setForm({ ...form, includedAiCents: e.target.value })}
            placeholder="0"
            className="w-24 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="number"
            value={form.aiMarkupPercent}
            onChange={(e) => setForm({ ...form, aiMarkupPercent: e.target.value })}
            placeholder="50"
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="number"
            value={form.maxProperties}
            onChange={(e) => setForm({ ...form, maxProperties: e.target.value })}
            placeholder="--"
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          <input
            type="number"
            value={form.maxPhoneNumbers}
            onChange={(e) => setForm({ ...form, maxPhoneNumbers: e.target.value })}
            placeholder="--"
            className="w-20 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
        </td>
        <td className="px-4 py-3">
          {/* No toggle for form row */}
        </td>
        <td className="whitespace-nowrap px-4 py-3">
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saveLabel}
            </button>
            <button
              onClick={onCancel}
              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Pricing Tiers</h1>
            <p className="mt-1 text-sm text-gray-500">
              Manage subscription tiers and pricing.
            </p>
          </div>
          {!showAddForm && (
            <button
              onClick={() => {
                setShowAddForm(true);
                setEditingId(null);
                setSaveMessage("");
              }}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add Tier
            </button>
          )}
        </div>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {saveMessage && (
          <div
            className={`mb-6 rounded-md p-4 text-sm ${
              saveMessage.includes("success")
                ? "bg-green-50 text-green-700"
                : "bg-red-50 text-red-700"
            }`}
          >
            {saveMessage}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading pricing tiers...</p>
            </div>
          </div>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Display Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Base Price
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Included AI
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Markup %
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Max Props
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Max Phones
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Active
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {showAddForm &&
                    renderFormRow(
                      addForm,
                      setAddForm,
                      handleAddTier,
                      () => {
                        setShowAddForm(false);
                        setAddForm(emptyForm);
                        setSaveMessage("");
                      },
                      "Create"
                    )}
                  {tiers.map((tier) =>
                    editingId === tier.id ? (
                      renderFormRow(
                        editForm,
                        setEditForm,
                        handleSaveEdit,
                        cancelEdit,
                        "Save"
                      )
                    ) : (
                      <tr
                        key={tier.id}
                        className="transition-colors hover:bg-gray-50"
                      >
                        <td className="whitespace-nowrap px-4 py-4 text-sm font-medium text-gray-900">
                          {tier.name}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-900">
                          {tier.displayName}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                          ${formatCents(tier.basePriceCents)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                          ${formatCents(tier.includedAiCents)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                          {tier.aiMarkupPercent}%
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                          {tier.maxProperties ?? "Unlimited"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4 text-sm text-gray-500">
                          {tier.maxPhoneNumbers ?? "Unlimited"}
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <button
                            onClick={() => handleToggleActive(tier)}
                            disabled={saving}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out disabled:opacity-50 ${
                              tier.isActive ? "bg-blue-600" : "bg-gray-200"
                            }`}
                          >
                            <span
                              className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ease-in-out ${
                                tier.isActive ? "translate-x-5" : "translate-x-0"
                              }`}
                            />
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-4">
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => startEdit(tier)}
                              className="rounded border border-gray-300 bg-white px-3 py-1 text-xs font-medium text-gray-700 hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <span className="text-xs text-gray-400">
                              {tier._count.subscriptions} subs
                            </span>
                          </div>
                        </td>
                      </tr>
                    )
                  )}
                  {!showAddForm && tiers.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-6 py-12 text-center">
                        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8">
                          <h3 className="text-lg font-medium text-gray-900">
                            No pricing tiers
                          </h3>
                          <p className="mt-1 text-sm text-gray-500">
                            Click &quot;Add Tier&quot; to create your first pricing tier.
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
