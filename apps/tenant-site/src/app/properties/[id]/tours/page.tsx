"use client";

import { useEffect, useState, FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/* -- Types ---------------------------------------------------------------- */

interface Property {
  id: string;
  name: string;
  address: string;
}

interface AvailableSlot {
  date: string; // "YYYY-MM-DD"
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
  datetime: string; // ISO datetime
}

/* -- Helpers -------------------------------------------------------------- */

function formatDateLabel(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function formatDateFull(dateStr: string): string {
  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(year, month - 1, day);
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatTime12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const hour = h % 12 || 12;
  return `${hour}:${String(m).padStart(2, "0")} ${ampm}`;
}

function getNext7Days(): string[] {
  const days: string[] = [];
  const today = new Date();
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    days.push(`${yyyy}-${mm}-${dd}`);
  }
  return days;
}

/* -- Spinner -------------------------------------------------------------- */

function Spinner({ size = "h-4 w-4" }: { size?: string }) {
  return (
    <svg className={`${size} animate-spin`} fill="none" viewBox="0 0 24 24">
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
  );
}

/* -- Main Component ------------------------------------------------------- */

export default function TourBookingPage() {
  const params = useParams();
  const id = params.id as string;

  /* State: property data */
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* State: availability */
  const [slots, setSlots] = useState<AvailableSlot[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);

  /* State: selection */
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<AvailableSlot | null>(null);

  /* State: form fields */
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [notes, setNotes] = useState("");

  /* State: submission */
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const next7Days = getNext7Days();

  /* -- Fetch property on mount -------------------------------------------- */

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/properties/${id}`);
        if (!res.ok) {
          if (res.status === 404) throw new Error("Property not found");
          throw new Error("Failed to load property");
        }
        const data = await res.json();
        setProperty(data.property);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Something went wrong"
        );
      } finally {
        setLoading(false);
      }
    }
    if (id) load();
  }, [id]);

  /* -- Fetch availability when property loads ----------------------------- */

  useEffect(() => {
    if (!property) return;

    async function fetchSlots() {
      setSlotsLoading(true);
      try {
        const days = getNext7Days();
        const startDate = days[0];
        const endDate = days[days.length - 1];
        const res = await fetch(
          `/api/tours/availability?propertyId=${id}&startDate=${startDate}&endDate=${endDate}`
        );
        if (res.ok) {
          const data = await res.json();
          setSlots(data.slots || []);
        }
      } catch {
        // Silently fail — user will see "no slots" message
      } finally {
        setSlotsLoading(false);
      }
    }

    fetchSlots();
  }, [property, id]);

  /* -- Derived: slots for selected date ----------------------------------- */

  const slotsForDate = selectedDate
    ? slots.filter((s) => s.date === selectedDate)
    : [];

  /* -- Handle date selection ---------------------------------------------- */

  function handleDateSelect(dateStr: string) {
    setSelectedDate(dateStr);
    setSelectedSlot(null);
    setSubmitError(null);
  }

  /* -- Handle form submit ------------------------------------------------- */

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!selectedSlot) return;

    setSubmitError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/tours/book", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyId: id,
          name: name.trim(),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          datetime: selectedSlot.datetime,
          notes: notes.trim() || undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to book tour");
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong"
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* -- Loading state ------------------------------------------------------ */

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <Spinner size="h-5 w-5" />
          <span className="text-sm">Loading...</span>
        </div>
      </div>
    );
  }

  /* -- Error state -------------------------------------------------------- */

  if (loadError || !property) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center px-4">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-50">
          <svg
            className="h-8 w-8 text-red-400"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
            />
          </svg>
        </div>
        <h2 className="mt-4 text-lg font-semibold text-gray-900">
          {loadError || "Property not found"}
        </h2>
        <p className="mt-2 text-sm text-gray-500">
          This property may no longer be available.
        </p>
        <Link href="/" className="btn-primary mt-6">
          Back to Properties
        </Link>
      </div>
    );
  }

  /* -- Success state ------------------------------------------------------ */

  if (submitted && selectedSlot) {
    return (
      <div className="flex min-h-[80vh] flex-col items-center justify-center px-4 py-12">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
          <svg
            className="h-8 w-8 text-green-600"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={2}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4.5 12.75l6 6 9-13.5"
            />
          </svg>
        </div>
        <h2 className="mt-6 text-2xl font-bold text-gray-900">
          Tour Scheduled!
        </h2>
        <p className="mt-3 max-w-md text-center text-gray-500">
          Your tour for{" "}
          <span className="font-medium text-gray-700">{property.name}</span> has
          been confirmed.
        </p>

        {/* Confirmation details card */}
        <div className="mt-6 w-full max-w-sm rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Date</span>
              <span className="font-medium text-gray-900">
                {formatDateFull(selectedSlot.date)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Time</span>
              <span className="font-medium text-gray-900">
                {formatTime12(selectedSlot.startTime)} -{" "}
                {formatTime12(selectedSlot.endTime)}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Location</span>
              <span className="font-medium text-gray-900 text-right max-w-[200px]">
                {property.address}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Name</span>
              <span className="font-medium text-gray-900">{name}</span>
            </div>
            {email && (
              <div className="flex justify-between">
                <span className="text-gray-500">Email</span>
                <span className="font-medium text-gray-900">{email}</span>
              </div>
            )}
          </div>
        </div>

        {email && (
          <p className="mt-4 text-sm text-gray-500">
            A confirmation has been sent to{" "}
            <span className="font-medium text-gray-700">{email}</span>.
          </p>
        )}

        <Link
          href={`/properties/${id}`}
          className="btn-primary mt-8"
        >
          Back to Property
        </Link>
      </div>
    );
  }

  /* -- Main form ---------------------------------------------------------- */

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Breadcrumb */}
      <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/" className="hover:text-gray-700">
          Properties
        </Link>
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
          />
        </svg>
        <Link
          href={`/properties/${id}`}
          className="hover:text-gray-700"
        >
          {property.name}
        </Link>
        <svg
          className="h-4 w-4"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={2}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M8.25 4.5l7.5 7.5-7.5 7.5"
          />
        </svg>
        <span className="text-gray-900 font-medium">Schedule a Tour</span>
      </nav>

      {/* Property header card */}
      <div className="card mb-8 p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100">
            <svg
              className="h-6 w-6 text-blue-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.25 12l8.954-8.955a1.126 1.126 0 011.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{property.name}</h1>
            <p className="text-sm text-gray-500">{property.address}</p>
          </div>
        </div>
      </div>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">Schedule a Tour</h2>
      <p className="text-gray-500 mb-8">
        Select a date and time to visit the property in person.
      </p>

      {/* Step 1: Date selection */}
      <div className="mb-8">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
          Step 1: Choose a Date
        </h3>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
          {next7Days.map((dateStr) => {
            const isSelected = selectedDate === dateStr;
            const dateSlots = slots.filter((s) => s.date === dateStr);
            const hasSlots = dateSlots.length > 0;

            return (
              <button
                key={dateStr}
                type="button"
                disabled={!hasSlots && !slotsLoading}
                onClick={() => handleDateSelect(dateStr)}
                className={`flex flex-col items-center rounded-xl border-2 px-3 py-3 text-center transition-all ${
                  isSelected
                    ? "border-blue-600 bg-blue-50 text-blue-700"
                    : hasSlots
                      ? "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50/50"
                      : "border-gray-100 bg-gray-50 text-gray-400 cursor-not-allowed"
                }`}
              >
                <span className="text-xs font-medium">
                  {formatDateLabel(dateStr).split(",")[0]?.split(" ")[0]}
                </span>
                <span className="text-lg font-bold mt-0.5">
                  {dateStr.split("-")[2]}
                </span>
                <span className="text-xs mt-0.5">
                  {slotsLoading ? (
                    <span className="text-gray-400">...</span>
                  ) : hasSlots ? (
                    <span className="text-green-600">
                      {dateSlots.length} {dateSlots.length === 1 ? "slot" : "slots"}
                    </span>
                  ) : (
                    <span className="text-gray-400">None</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Time slot chips */}
      {selectedDate && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
            Available Times for {formatDateFull(selectedDate)}
          </h3>

          {slotsLoading ? (
            <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
              <Spinner />
              <span>Loading available times...</span>
            </div>
          ) : slotsForDate.length === 0 ? (
            <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-200 px-5 py-4">
              <svg
                className="h-5 w-5 flex-shrink-0 text-blue-500"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
                />
              </svg>
              <p className="text-sm text-blue-700">
                No tour slots are available for this date. Please try another
                day.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
              {slotsForDate.map((slot) => {
                const isSelected =
                  selectedSlot?.datetime === slot.datetime;
                return (
                  <button
                    key={slot.datetime}
                    type="button"
                    onClick={() => {
                      setSelectedSlot(slot);
                      setSubmitError(null);
                    }}
                    className={`rounded-lg border-2 px-3 py-2.5 text-sm font-medium transition-all ${
                      isSelected
                        ? "border-blue-600 bg-blue-600 text-white shadow-sm"
                        : "border-gray-200 bg-white text-gray-700 hover:border-blue-300 hover:bg-blue-50/50"
                    }`}
                  >
                    {formatTime12(slot.startTime)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Step 2: Contact information */}
      {selectedSlot && (
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <h3 className="text-sm font-semibold uppercase tracking-wider text-gray-500 mb-4">
              Step 2: Your Information
            </h3>

            <div className="card p-6 space-y-5">
              {/* Name */}
              <div>
                <label
                  htmlFor="tour-name"
                  className="block text-sm font-medium text-gray-700"
                >
                  Your Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="tour-name"
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="John Doe"
                />
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="tour-email"
                  className="block text-sm font-medium text-gray-700"
                >
                  Email{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="tour-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="you@example.com"
                />
                <p className="mt-1 text-xs text-gray-400">
                  We will send you a confirmation email.
                </p>
              </div>

              {/* Phone */}
              <div>
                <label
                  htmlFor="tour-phone"
                  className="block text-sm font-medium text-gray-700"
                >
                  Phone{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <input
                  id="tour-phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="(312) 123-4567"
                />
              </div>

              {/* Notes */}
              <div>
                <label
                  htmlFor="tour-notes"
                  className="block text-sm font-medium text-gray-700"
                >
                  Notes{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="tour-notes"
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="Any questions or special requests..."
                />
              </div>
            </div>
          </div>

          {/* Selected time summary */}
          <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
            <div className="flex items-center gap-3">
              <svg
                className="h-5 w-5 flex-shrink-0 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5"
                />
              </svg>
              <div className="text-sm">
                <p className="font-semibold text-blue-800">
                  {formatDateFull(selectedSlot.date)}
                </p>
                <p className="text-blue-700">
                  {formatTime12(selectedSlot.startTime)} -{" "}
                  {formatTime12(selectedSlot.endTime)}
                </p>
              </div>
            </div>
          </div>

          {/* Conflict error (yellow banner) */}
          {submitError &&
            submitError.toLowerCase().includes("no longer available") && (
              <div className="flex items-center gap-3 rounded-xl bg-yellow-50 border border-yellow-200 px-5 py-4">
                <svg
                  className="h-5 w-5 flex-shrink-0 text-yellow-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z"
                  />
                </svg>
                <p className="text-sm text-yellow-800">{submitError}</p>
              </div>
            )}

          {/* Generic error */}
          {submitError &&
            !submitError.toLowerCase().includes("no longer available") && (
              <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
                <svg
                  className="h-5 w-5 flex-shrink-0"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                  />
                </svg>
                {submitError}
              </div>
            )}

          {/* Submit button */}
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="btn-primary w-full"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <Spinner />
                Scheduling...
              </span>
            ) : (
              <>
                <svg
                  className="mr-2 h-5 w-5"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={1.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z"
                  />
                </svg>
                Schedule Tour
              </>
            )}
          </button>
        </form>
      )}

      {/* No slots at all message */}
      {!slotsLoading && slots.length === 0 && !selectedDate && (
        <div className="flex items-center gap-3 rounded-xl bg-blue-50 border border-blue-200 px-5 py-4">
          <svg
            className="h-5 w-5 flex-shrink-0 text-blue-500"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z"
            />
          </svg>
          <div className="text-sm text-blue-700">
            <p className="font-medium">No tour times available</p>
            <p className="mt-1">
              There are no tour slots configured for the next 7 days. Please
              contact the property manager directly.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
