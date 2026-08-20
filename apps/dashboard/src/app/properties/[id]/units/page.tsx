"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface Unit {
  id: string;
  unitNumber: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  monthlyRent: number;
  status: string;
  description: string | null;
  petPolicy: string | null;
  parkingInfo: string | null;
  utilitiesIncluded: string | null;
  laundry: string | null;
  availableDate: string | null;
}

export default function UnitsPage() {
  const params = useParams();
  const id = params.id as string;
  const [units, setUnits] = useState<Unit[]>([]);
  const [propertyName, setPropertyName] = useState("");
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | null>(null);

  const loadUnits = useCallback(async () => {
    const [uRes, pRes] = await Promise.all([
      fetch(`/api/properties/${id}/units`),
      fetch(`/api/properties/${id}`),
    ]);
    if (uRes.ok) {
      const data = await uRes.json();
      setUnits(data.units || []);
    }
    if (pRes.ok) {
      const data = await pRes.json();
      setPropertyName(data.property?.name || "");
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    loadUnits();
  }, [loadUnits]);

  async function handleDelete(unitId: string) {
    if (!confirm("Delete this unit? This cannot be undone.")) return;

    const res = await fetch(`/api/properties/${id}/units/${unitId}`, {
      method: "DELETE",
    });

    if (res.ok) {
      setUnits((prev) => prev.filter((u) => u.id !== unitId));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete unit");
    }
  }

  if (loading) {
    return (
      <DashboardShell>
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
      </DashboardShell>
    );
  }

  return (
    <DashboardShell>
    <div className="mx-auto max-w-4xl px-4 py-8">
      <Link
        href={`/properties/${id}`}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        &larr; Back to {propertyName || "Property"}
      </Link>

      <div className="mt-4 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Units</h1>
        <button
          onClick={() => {
            setEditingUnit(null);
            setShowForm(true);
          }}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Add Unit
        </button>
      </div>

      {/* Unit form */}
      {showForm && (
        <UnitForm
          propertyId={id}
          unit={editingUnit}
          onSaved={() => {
            setShowForm(false);
            setEditingUnit(null);
            loadUnits();
          }}
          onCancel={() => {
            setShowForm(false);
            setEditingUnit(null);
          }}
        />
      )}

      {/* Units table */}
      {units.length === 0 ? (
        <div className="mt-6 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-gray-500">No units yet. Add your first unit.</p>
        </div>
      ) : (
        <div className="mt-6 overflow-hidden rounded-lg border border-gray-200">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Unit #
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Beds
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Baths
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Sqft
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Monthly Rent
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {units.map((unit) => {
                const details = [
                  unit.description && { label: "Description", value: unit.description },
                  unit.petPolicy && { label: "Pet Policy", value: unit.petPolicy },
                  unit.parkingInfo && { label: "Parking", value: unit.parkingInfo },
                  unit.utilitiesIncluded && { label: "Utilities", value: unit.utilitiesIncluded },
                  unit.laundry && { label: "Laundry", value: unit.laundry },
                  unit.availableDate && {
                    label: "Available",
                    value: new Date(unit.availableDate).toLocaleDateString(),
                  },
                ].filter(Boolean) as { label: string; value: string }[];

                return (
                  <tr key={unit.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      <div>{unit.unitNumber}</div>
                      {details.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                          {details.map((d) => (
                            <span key={d.label} className="text-xs text-gray-400">
                              {d.label}: <span className="text-gray-600">{d.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {unit.bedrooms ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {unit.bathrooms ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {unit.sqft ? unit.sqft.toLocaleString() : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      ${(unit.monthlyRent / 100).toLocaleString(undefined, {
                        minimumFractionDigits: 2,
                      })}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${
                          unit.status === "vacant"
                            ? "bg-green-100 text-green-700"
                            : unit.status === "occupied"
                            ? "bg-blue-100 text-blue-700"
                            : "bg-yellow-100 text-yellow-700"
                        }`}
                      >
                        {unit.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => {
                          setEditingUnit(unit);
                          setShowForm(true);
                        }}
                        className="mr-2 text-sm text-blue-600 hover:text-blue-800"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(unit.id)}
                        className="text-sm text-red-500 hover:text-red-700"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
    </DashboardShell>
  );
}

function UnitForm({
  propertyId,
  unit,
  onSaved,
  onCancel,
}: {
  propertyId: string;
  unit: Unit | null;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const isEditing = !!unit;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [unitNumber, setUnitNumber] = useState(unit?.unitNumber || "");
  const [bedrooms, setBedrooms] = useState(
    unit?.bedrooms?.toString() || ""
  );
  const [bathrooms, setBathrooms] = useState(
    unit?.bathrooms?.toString() || ""
  );
  const [sqft, setSqft] = useState(unit?.sqft?.toString() || "");
  const [monthlyRent, setMonthlyRent] = useState(
    unit ? (unit.monthlyRent / 100).toFixed(2) : ""
  );
  const [status, setStatus] = useState(unit?.status || "vacant");
  const [description, setDescription] = useState(unit?.description || "");
  const [petPolicy, setPetPolicy] = useState(unit?.petPolicy || "");
  const [parkingInfo, setParkingInfo] = useState(unit?.parkingInfo || "");
  const [utilitiesIncluded, setUtilitiesIncluded] = useState(
    unit?.utilitiesIncluded || ""
  );
  const [laundry, setLaundry] = useState(unit?.laundry || "");
  const [availableDate, setAvailableDate] = useState(
    unit?.availableDate ? unit.availableDate.slice(0, 10) : ""
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const rentCents = Math.round(parseFloat(monthlyRent) * 100);

    if (isNaN(rentCents) || rentCents <= 0) {
      setError("Monthly rent must be greater than 0");
      setSaving(false);
      return;
    }

    const body: Record<string, unknown> = {
      unitNumber,
      bedrooms: bedrooms ? parseInt(bedrooms, 10) : null,
      bathrooms: bathrooms ? parseFloat(bathrooms) : null,
      sqft: sqft ? parseInt(sqft, 10) : null,
      monthlyRent: rentCents,
      description: description || null,
      petPolicy: petPolicy || null,
      parkingInfo: parkingInfo || null,
      utilitiesIncluded: utilitiesIncluded || null,
      laundry: laundry || null,
      availableDate: availableDate ? new Date(availableDate).toISOString() : null,
    };

    if (isEditing) {
      body.status = status;
    }

    const url = isEditing
      ? `/api/properties/${propertyId}/units/${unit.id}`
      : `/api/properties/${propertyId}/units`;

    const res = await fetch(url, {
      method: isEditing ? "PUT" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await res.json();

    if (res.ok) {
      onSaved();
    } else {
      setError(data.error || "Failed to save unit");
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="mb-4 text-sm font-medium text-gray-900">
        {isEditing ? `Edit Unit ${unit.unitNumber}` : "Add Unit"}
      </h3>

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Unit Number *
            </label>
            <input
              type="text"
              required
              value={unitNumber}
              onChange={(e) => setUnitNumber(e.target.value)}
              placeholder="101"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Bedrooms
            </label>
            <input
              type="number"
              min="0"
              value={bedrooms}
              onChange={(e) => setBedrooms(e.target.value)}
              placeholder="2"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Bathrooms
            </label>
            <input
              type="number"
              min="0"
              step="0.5"
              value={bathrooms}
              onChange={(e) => setBathrooms(e.target.value)}
              placeholder="1"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Square Feet
            </label>
            <input
              type="number"
              min="0"
              value={sqft}
              onChange={(e) => setSqft(e.target.value)}
              placeholder="850"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Monthly Rent ($) *
            </label>
            <input
              type="number"
              required
              min="0.01"
              step="0.01"
              value={monthlyRent}
              onChange={(e) => setMonthlyRent(e.target.value)}
              placeholder="1500.00"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          {isEditing && (
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="vacant">Vacant</option>
                <option value="occupied">Occupied</option>
                <option value="maintenance">Maintenance</option>
              </select>
            </div>
          )}
        </div>

        {/* Unit detail fields */}
        <div className="mt-4 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700">
              Description
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Unit description visible to prospective tenants"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Pet Policy
              </label>
              <input
                type="text"
                value={petPolicy}
                onChange={(e) => setPetPolicy(e.target.value)}
                placeholder="Pet policy for this unit (overrides property-level)"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Parking Info
              </label>
              <input
                type="text"
                value={parkingInfo}
                onChange={(e) => setParkingInfo(e.target.value)}
                placeholder="Parking details (e.g., '1 assigned spot, #A-12')"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Utilities Included
              </label>
              <input
                type="text"
                value={utilitiesIncluded}
                onChange={(e) => setUtilitiesIncluded(e.target.value)}
                placeholder="Utilities included (e.g., 'Water, trash')"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Laundry
              </label>
              <input
                type="text"
                value={laundry}
                onChange={(e) => setLaundry(e.target.value)}
                placeholder="Laundry (e.g., 'In-unit washer/dryer')"
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Available Date
              </label>
              <input
                type="date"
                value={availableDate}
                onChange={(e) => setAvailableDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : isEditing ? "Save Changes" : "Add Unit"}
          </button>
        </div>
      </form>
    </div>
  );
}
