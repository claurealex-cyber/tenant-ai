"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface TourSlot {
  id: string;
  dayOfWeek: number | null;
  specificDate: string | null;
  startTime: string;
  endTime: string;
  slotMinutes: number;
  isActive: boolean;
  createdAt: string;
}

interface TourBooking {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  date: string;
  status: string;
  source: string;
  notes: string | null;
  createdAt: string;
}

const DAYS_OF_WEEK = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

type BookingFilter = "all" | "confirmed" | "completed" | "canceled" | "no_show";

export default function ToursPage() {
  const params = useParams();
  const id = params.id as string;
  const [propertyName, setPropertyName] = useState("");
  const [slots, setSlots] = useState<TourSlot[]>([]);
  const [bookings, setBookings] = useState<TourBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSlotForm, setShowSlotForm] = useState(false);
  const [bookingFilter, setBookingFilter] = useState<BookingFilter>("all");

  const loadData = useCallback(async () => {
    const [slotsRes, propertyRes] = await Promise.all([
      fetch(`/api/properties/${id}/tours/slots`),
      fetch(`/api/properties/${id}`),
    ]);

    if (slotsRes.ok) {
      const data = await slotsRes.json();
      setSlots(data.slots || []);
    }
    if (propertyRes.ok) {
      const data = await propertyRes.json();
      setPropertyName(data.property?.name || "");
    }
    setLoading(false);
  }, [id]);

  const loadBookings = useCallback(async () => {
    const filterParam = bookingFilter !== "all" ? `?status=${bookingFilter}` : "";
    const res = await fetch(`/api/properties/${id}/tours/bookings${filterParam}`);
    if (res.ok) {
      const data = await res.json();
      setBookings(data.bookings || []);
    }
  }, [id, bookingFilter]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!loading) {
      loadBookings();
    }
  }, [loadBookings, loading]);

  async function handleDeleteSlot(slotId: string) {
    if (!confirm("Delete this tour slot?")) return;
    const res = await fetch(`/api/properties/${id}/tours/slots/${slotId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      setSlots((prev) => prev.filter((s) => s.id !== slotId));
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete slot");
    }
  }

  async function handleToggleSlot(slotId: string, currentActive: boolean) {
    const res = await fetch(`/api/properties/${id}/tours/slots/${slotId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !currentActive }),
    });
    if (res.ok) {
      setSlots((prev) =>
        prev.map((s) =>
          s.id === slotId ? { ...s, isActive: !currentActive } : s
        )
      );
    }
  }

  async function handleBookingAction(bookingId: string, status: string) {
    const res = await fetch(
      `/api/properties/${id}/tours/bookings/${bookingId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      }
    );
    if (res.ok) {
      setBookings((prev) =>
        prev.map((b) => (b.id === bookingId ? { ...b, status } : b))
      );
    } else {
      const data = await res.json();
      alert(data.error || "Failed to update booking");
    }
  }

  function slotDescription(slot: TourSlot): string {
    if (slot.dayOfWeek !== null) {
      return `Every ${DAYS_OF_WEEK[slot.dayOfWeek]}, ${slot.startTime} - ${slot.endTime} (${slot.slotMinutes}min slots)`;
    }
    if (slot.specificDate) {
      const d = new Date(slot.specificDate);
      return `${d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}, ${slot.startTime} - ${slot.endTime} (${slot.slotMinutes}min slots)`;
    }
    return `${slot.startTime} - ${slot.endTime}`;
  }

  const sourceBadge = (source: string) => {
    const colors: Record<string, string> = {
      web: "bg-teal-100 text-teal-700",
      voice: "bg-blue-100 text-blue-700",
      sms: "bg-purple-100 text-purple-700",
    };
    return colors[source] || "bg-gray-100 text-gray-700";
  };

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      confirmed: "bg-green-100 text-green-700",
      completed: "bg-blue-100 text-blue-700",
      canceled: "bg-gray-100 text-gray-600",
      no_show: "bg-red-100 text-red-700",
    };
    return colors[status] || "bg-gray-100 text-gray-700";
  };

  const filterButtons: { key: BookingFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "confirmed", label: "Confirmed" },
    { key: "completed", label: "Completed" },
    { key: "canceled", label: "Canceled" },
    { key: "no_show", label: "No Show" },
  ];

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
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Link
          href={`/properties/${id}?tab=tours`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          &larr; Back to {propertyName || "Property"}
        </Link>

        <h1 className="mt-4 text-2xl font-bold text-gray-900">Tours</h1>

        {/* Section 1: Tour Availability Settings */}
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Tour Availability
            </h2>
            <button
              onClick={() => setShowSlotForm(true)}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              + Add Slot
            </button>
          </div>

          {showSlotForm && (
            <SlotForm
              propertyId={id}
              onSaved={() => {
                setShowSlotForm(false);
                loadData();
              }}
              onCancel={() => setShowSlotForm(false)}
            />
          )}

          {slots.length === 0 && !showSlotForm ? (
            <div className="mt-4 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
              <p className="text-gray-500">
                No tour slots. Add your first availability slot.
              </p>
            </div>
          ) : (
            <div className="mt-4 space-y-2">
              {slots.map((slot) => (
                <div
                  key={slot.id}
                  className="flex items-center justify-between rounded border border-gray-100 bg-gray-50 px-4 py-3"
                >
                  <span className="text-sm text-gray-800">
                    {slotDescription(slot)}
                  </span>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={() => handleToggleSlot(slot.id, slot.isActive)}
                      className={`rounded-full px-3 py-1 text-xs font-medium ${
                        slot.isActive
                          ? "bg-green-100 text-green-700 hover:bg-green-200"
                          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                      }`}
                    >
                      {slot.isActive ? "Active" : "Inactive"}
                    </button>
                    <button
                      onClick={() => handleDeleteSlot(slot.id)}
                      className="text-sm text-red-500 hover:text-red-700"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Section 2: Tour Bookings */}
        <div className="mt-8 rounded-lg border border-gray-200 bg-white p-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-900">
              Tour Bookings
            </h2>
          </div>

          <div className="mt-4 flex gap-2">
            {filterButtons.map((fb) => (
              <button
                key={fb.key}
                onClick={() => setBookingFilter(fb.key)}
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  bookingFilter === fb.key
                    ? "bg-blue-100 text-blue-700"
                    : "bg-gray-100 text-gray-600 hover:bg-gray-200"
                }`}
              >
                {fb.label}
              </button>
            ))}
          </div>

          {bookings.length === 0 ? (
            <div className="mt-4 rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
              <p className="text-gray-500">No tour bookings yet.</p>
            </div>
          ) : (
            <div className="mt-4 overflow-hidden rounded-lg border border-gray-200">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Date/Time
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Phone
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Source
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
                  {bookings.map((booking) => (
                    <tr key={booking.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {new Date(booking.date).toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                        })}{" "}
                        {new Date(booking.date).toLocaleTimeString("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900">
                        {booking.name}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {booking.phone || "—"}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {booking.email || "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadge(booking.source)}`}
                        >
                          {booking.source}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${statusBadge(booking.status)}`}
                        >
                          {booking.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {booking.status === "confirmed" && (
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() =>
                                handleBookingAction(booking.id, "completed")
                              }
                              className="text-xs text-blue-600 hover:text-blue-800"
                            >
                              Completed
                            </button>
                            <button
                              onClick={() =>
                                handleBookingAction(booking.id, "no_show")
                              }
                              className="text-xs text-red-500 hover:text-red-700"
                            >
                              No Show
                            </button>
                            <button
                              onClick={() =>
                                handleBookingAction(booking.id, "canceled")
                              }
                              className="text-xs text-gray-500 hover:text-gray-700"
                            >
                              Cancel
                            </button>
                          </div>
                        )}
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

function SlotForm({
  propertyId,
  onSaved,
  onCancel,
}: {
  propertyId: string;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [slotType, setSlotType] = useState<"recurring" | "specific">(
    "recurring"
  );
  const [dayOfWeek, setDayOfWeek] = useState(1); // Monday default
  const [specificDate, setSpecificDate] = useState("");
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("17:00");
  const [slotMinutes, setSlotMinutes] = useState(30);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const body: Record<string, unknown> = {
      startTime,
      endTime,
      slotMinutes,
    };

    if (slotType === "recurring") {
      body.dayOfWeek = dayOfWeek;
    } else {
      if (!specificDate) {
        setError("Please select a date");
        setSaving(false);
        return;
      }
      body.specificDate = specificDate;
    }

    try {
      const res = await fetch(`/api/properties/${propertyId}/tours/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (res.ok) {
        onSaved();
      } else {
        setError(data.error || "Failed to create slot");
        setSaving(false);
      }
    } catch {
      setError("Failed to create slot");
      setSaving(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-5">
      <h3 className="mb-4 text-sm font-medium text-gray-900">
        Add Tour Slot
      </h3>

      {error && (
        <div className="mb-3 rounded bg-red-50 p-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        {/* Type toggle */}
        <div className="mb-4">
          <label className="block text-xs font-medium text-gray-700 mb-2">
            Type
          </label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="slotType"
                checked={slotType === "recurring"}
                onChange={() => setSlotType("recurring")}
                className="h-4 w-4 border-gray-300 text-blue-600"
              />
              Recurring weekly
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="slotType"
                checked={slotType === "specific"}
                onChange={() => setSlotType("specific")}
                className="h-4 w-4 border-gray-300 text-blue-600"
              />
              Specific date
            </label>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
          {slotType === "recurring" ? (
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Day of Week
              </label>
              <select
                value={dayOfWeek}
                onChange={(e) => setDayOfWeek(parseInt(e.target.value, 10))}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                {DAYS_OF_WEEK.map((day, i) => (
                  <option key={i} value={i}>
                    {day}
                  </option>
                ))}
              </select>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-medium text-gray-700">
                Date
              </label>
              <input
                type="date"
                value={specificDate}
                onChange={(e) => setSpecificDate(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700">
              Start Time
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">
              End Time
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700">
              Slot Duration (min)
            </label>
            <input
              type="number"
              min={10}
              max={240}
              value={slotMinutes}
              onChange={(e) =>
                setSlotMinutes(parseInt(e.target.value, 10) || 30)
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
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
            {saving ? "Saving..." : "Save Slot"}
          </button>
        </div>
      </form>
    </div>
  );
}
