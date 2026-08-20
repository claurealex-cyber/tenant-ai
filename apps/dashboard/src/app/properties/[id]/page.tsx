"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface Question {
  id: string;
  text: string;
  fieldKey: string;
  type: string;
  required: boolean;
  sortOrder: number;
  isStandard: boolean;
}

interface Unit {
  id: string;
  unitNumber: string;
  bedrooms: number | null;
  bathrooms: number | null;
  sqft: number | null;
  monthlyRent: number;
  status: string;
}

interface Photo {
  id: string;
  url: string;
  caption: string | null;
  sortOrder: number;
}

interface Property {
  id: string;
  name: string;
  address: string;
  unitCount: number | null;
  twilioPhone: string | null;
  twilioPhoneSid: string | null;
  smsIntakeEnabled: boolean;
  intakeAutoReply: string | null;
  description: string | null;
  isActive: boolean;
  aiModel: string;
  voiceName: string;
  maxCallMinutes: number;
  recordingEnabled: boolean;
  answerValidation: boolean;
  aiDisclosureText: string | null;
  greetingMessage: string | null;
  cookCounty: boolean;
  petPolicy: string | null;
  amenities: string[];
  questions: Question[];
  units: Unit[];
  photos: Photo[];
  _count: { applications: number; callLogs: number };
  createdAt: string;
}

interface TourBookingSummary {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  date: string;
  status: string;
  source: string;
}

interface TourSummary {
  activeSlotCount: number;
  upcomingBookings: TourBookingSummary[];
}

type Tab = "overview" | "questions" | "photos" | "units" | "tours" | "intake" | "settings";

export default function PropertyDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");

  const loadProperty = useCallback(() => {
    fetch(`/api/properties/${id}`)
      .then((res) => {
        if (!res.ok) throw new Error("Not found");
        return res.json();
      })
      .then((data) => {
        setProperty(data.property);
        setLoading(false);
      })
      .catch(() => {
        setError("Property not found");
        setLoading(false);
      });
  }, [id]);

  useEffect(() => {
    loadProperty();
  }, [loadProperty]);

  if (loading) {
    return (
      <DashboardShell>
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
      </DashboardShell>
    );
  }

  if (error || !property) {
    return (
      <DashboardShell>
      <div className="mx-auto max-w-4xl px-4 py-8">
        <p className="text-red-600">{error || "Property not found"}</p>
        <Link href="/properties" className="mt-2 text-sm text-blue-600">
          &larr; Back to Properties
        </Link>
      </div>
      </DashboardShell>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: "overview", label: "Overview" },
    { key: "questions", label: `Questions (${property.questions.length})` },
    { key: "photos", label: `Photos (${property.photos.length})` },
    { key: "units", label: `Units (${property.units.length})` },
    { key: "tours", label: "Tours" },
    { key: "intake", label: "SMS Intake" },
    { key: "settings", label: "Settings" },
  ];

  return (
    <DashboardShell>
    <div className="mx-auto max-w-5xl px-4 py-8">
      <Link href="/properties" className="text-sm text-blue-600 hover:text-blue-800">
        &larr; Back to Properties
      </Link>

      {/* Header */}
      <div className="mt-4 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{property.name}</h1>
          <p className="mt-1 text-sm text-gray-500">{property.address}</p>
          {property.cookCounty && (
            <span className="mt-1 inline-block rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-700">
              Cook County
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {property.twilioPhone ? (
            <span className="font-mono text-sm text-gray-700">
              {property.twilioPhone}
            </span>
          ) : (
            <button
              onClick={() => setTab("settings")}
              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-sm font-medium text-amber-700 hover:bg-amber-100"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z" />
              </svg>
              Assign Phone
            </button>
          )}
          <ToggleActive property={property} onUpdate={loadProperty} />
        </div>
      </div>

      {/* Stats */}
      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Applications" value={property._count.applications} />
        <StatCard label="Call Logs" value={property._count.callLogs} />
        <StatCard label="Units" value={property.units.length} />
        <StatCard label="Questions" value={property.questions.length} />
      </div>

      {/* Tabs */}
      <div className="mt-8 border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`whitespace-nowrap border-b-2 pb-3 text-sm font-medium ${
                tab === t.key
                  ? "border-blue-500 text-blue-600"
                  : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {tab === "overview" && <OverviewTab property={property} />}
        {tab === "questions" && (
          <QuestionsTab property={property} onUpdate={loadProperty} />
        )}
        {tab === "photos" && (
          <PhotosTab property={property} onUpdate={loadProperty} />
        )}
        {tab === "units" && <UnitsTab property={property} />}
        {tab === "tours" && <ToursTab property={property} />}
        {tab === "intake" && <IntakeTab property={property} onUpdate={loadProperty} />}
        {tab === "settings" && (
          <SettingsTab property={property} onUpdate={loadProperty} router={router} />
        )}
      </div>
    </div>
    </DashboardShell>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  );
}

function ToggleActive({
  property,
  onUpdate,
}: {
  property: Property;
  onUpdate: () => void;
}) {
  const [toggling, setToggling] = useState(false);

  async function toggle() {
    if (
      property.isActive &&
      !confirm("Deactivating will stop the AI from answering calls. Continue?")
    ) {
      return;
    }
    setToggling(true);
    await fetch(`/api/properties/${property.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isActive: !property.isActive }),
    });
    onUpdate();
    setToggling(false);
  }

  return (
    <button
      onClick={toggle}
      disabled={toggling}
      className={`rounded-full px-3 py-1 text-xs font-medium ${
        property.isActive
          ? "bg-green-100 text-green-700 hover:bg-green-200"
          : "bg-gray-100 text-gray-600 hover:bg-gray-200"
      }`}
    >
      {property.isActive ? "Active" : "Inactive"}
    </button>
  );
}

function OverviewTab({ property }: { property: Property }) {
  return (
    <div className="space-y-6">
      {property.description && (
        <div>
          <h3 className="text-sm font-medium text-gray-700">Description</h3>
          <p className="mt-1 text-sm text-gray-600 whitespace-pre-wrap">
            {property.description}
          </p>
        </div>
      )}

      {property.amenities.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-gray-700">Amenities</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {property.amenities.map((amenity, i) => (
              <span
                key={i}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-700"
              >
                {amenity}
              </span>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3 className="text-sm font-medium text-gray-700">AI Configuration</h3>
        <dl className="mt-2 grid grid-cols-2 gap-4 text-sm">
          <div>
            <dt className="text-gray-500">Model</dt>
            <dd className="font-medium text-gray-900">{property.aiModel}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Voice</dt>
            <dd className="font-medium text-gray-900">{property.voiceName}</dd>
          </div>
          <div>
            <dt className="text-gray-500">Max Call Duration</dt>
            <dd className="font-medium text-gray-900">{property.maxCallMinutes} min</dd>
          </div>
          <div>
            <dt className="text-gray-500">Recording</dt>
            <dd className="font-medium text-gray-900">
              {property.recordingEnabled ? "Enabled" : "Disabled"}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Answer Validation</dt>
            <dd className="font-medium text-gray-900">
              {property.answerValidation ? "Enabled" : "Disabled"}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function QuestionsTab({
  property,
  onUpdate,
}: {
  property: Property;
  onUpdate: () => void;
}) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">
          Questions asked during application
        </h3>
        <Link
          href={`/properties/${property.id}/questions`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Edit Questions
        </Link>
      </div>
      {property.questions.length === 0 ? (
        <p className="text-sm text-gray-500">No questions configured.</p>
      ) : (
        <ol className="space-y-2">
          {property.questions.map((q, i) => (
            <li
              key={q.id}
              className="flex items-center gap-3 rounded border border-gray-100 bg-white px-4 py-3 text-sm"
            >
              <span className="text-gray-400">{i + 1}.</span>
              <span className="flex-1 text-gray-800">{q.text}</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                {q.type}
              </span>
              {q.required && (
                <span className="text-xs text-red-500">Required</span>
              )}
              {q.isStandard && (
                <span className="text-xs text-gray-400">Standard</span>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function PhotosTab({
  property,
  onUpdate,
}: {
  property: Property;
  onUpdate: () => void;
}) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");

  async function addPhoto(e: React.FormEvent) {
    e.preventDefault();
    setAdding(true);
    const res = await fetch(`/api/properties/${property.id}/photos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, caption: caption || null }),
    });
    if (res.ok) {
      setUrl("");
      setCaption("");
      onUpdate();
    }
    setAdding(false);
  }

  async function deletePhoto(photoId: string) {
    if (!confirm("Delete this photo?")) return;
    await fetch(`/api/properties/${property.id}/photos/${photoId}`, {
      method: "DELETE",
    });
    onUpdate();
  }

  return (
    <div>
      <h3 className="mb-4 text-sm font-medium text-gray-700">
        Property Photos ({property.photos.length}/20)
      </h3>

      {property.photos.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4">
          {property.photos.map((photo) => (
            <div key={photo.id} className="group relative">
              <img
                src={photo.url}
                alt={photo.caption || "Property photo"}
                className="h-32 w-full rounded-lg border border-gray-200 object-cover"
              />
              {photo.caption && (
                <p className="mt-1 truncate text-xs text-gray-500">
                  {photo.caption}
                </p>
              )}
              <button
                onClick={() => deletePhoto(photo.id)}
                className="absolute right-1 top-1 hidden rounded bg-red-500 px-2 py-0.5 text-xs text-white group-hover:block"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {property.photos.length < 20 && (
        <form onSubmit={addPhoto} className="flex gap-3 rounded border border-gray-200 bg-gray-50 p-4">
          <input
            type="url"
            required
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Photo URL"
            className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Caption (optional)"
            className="w-40 rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={adding}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {adding ? "Adding..." : "Add"}
          </button>
        </form>
      )}
    </div>
  );
}

function UnitsTab({ property }: { property: Property }) {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Units</h3>
        <Link
          href={`/properties/${property.id}/units`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Manage Units
        </Link>
      </div>
      {property.units.length === 0 ? (
        <p className="text-sm text-gray-500">No units added yet.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200">
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
                  Rent
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                  Status
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              {property.units.map((unit) => (
                <tr key={unit.id}>
                  <td className="px-4 py-3 text-sm font-medium text-gray-900">
                    {unit.unitNumber}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {unit.bedrooms ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {unit.bathrooms ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    {unit.sqft ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-600">
                    ${(unit.monthlyRent / 100).toLocaleString()}
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ToursTab({ property }: { property: Property }) {
  const [tourData, setTourData] = useState<TourSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/properties/${property.id}/tours/summary`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setTourData(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [property.id]);

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

  if (loading) {
    return <p className="text-sm text-gray-500">Loading tour data...</p>;
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-medium text-gray-700">Tours</h3>
        <Link
          href={`/properties/${property.id}/tours`}
          className="text-sm text-blue-600 hover:text-blue-800"
        >
          Manage Tours &rarr;
        </Link>
      </div>

      {!tourData || tourData.activeSlotCount === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-8 text-center">
          <p className="text-gray-500">
            No tour slots configured. Set up availability in{" "}
            <Link
              href={`/properties/${property.id}/tours`}
              className="text-blue-600 hover:text-blue-800"
            >
              Manage Tours
            </Link>
            .
          </p>
        </div>
      ) : (
        <>
          <p className="mb-4 text-sm text-gray-600">
            {tourData.activeSlotCount} active tour slot{tourData.activeSlotCount !== 1 ? "s" : ""},{" "}
            {tourData.upcomingBookings.length} upcoming booking{tourData.upcomingBookings.length !== 1 ? "s" : ""}
          </p>

          {tourData.upcomingBookings.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-gray-200">
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
                      Source
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium uppercase text-gray-500">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 bg-white">
                  {tourData.upcomingBookings.map((booking) => (
                    <tr key={booking.id}>
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
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-gray-500">No upcoming bookings.</p>
          )}
        </>
      )}
    </div>
  );
}

function IntakeTab({
  property,
  onUpdate,
}: {
  property: Property;
  onUpdate: () => void;
}) {
  const [enabled, setEnabled] = useState(property.smsIntakeEnabled);
  const [autoReply, setAutoReply] = useState(property.intakeAutoReply || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    await fetch(`/api/properties/${property.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        smsIntakeEnabled: enabled,
        intakeAutoReply: autoReply.trim() || null,
      }),
    });
    onUpdate();
    setSaving(false);
    setSaved(true);
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="font-medium text-gray-900">SMS Application Intake</h3>
        <p className="mt-1 text-sm text-gray-500">
          When enabled, anyone who texts this property&apos;s number gets an automatic
          reply with a link to the online rental application, instead of the
          conversational text flow.
        </p>
      </div>

      {!property.twilioPhone && (
        <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-700">
          Assign a phone number to this property (Settings &rarr; Phone Number) before
          enabling SMS intake.
        </div>
      )}

      <form onSubmit={handleSave} className="space-y-5">
        <div className="flex items-center gap-3">
          <input
            type="checkbox"
            id="smsIntakeEnabled"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
            disabled={!property.twilioPhone}
            className="h-4 w-4 rounded border-gray-300"
          />
          <label htmlFor="smsIntakeEnabled" className="text-sm text-gray-700">
            Reply to inbound texts with the application link
          </label>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700">
            Auto-reply message
          </label>
          <textarea
            rows={3}
            value={autoReply}
            onChange={(e) => setAutoReply(e.target.value)}
            placeholder={`Thanks for your interest in ${property.name}! Start your rental application here:`}
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-gray-500">
            The application link and an opt-out notice are appended automatically. Leave
            blank to use the default message.
          </p>
        </div>

        {property.twilioPhone && (
          <div className="rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="text-gray-700">
              Intake number:{" "}
              <span className="font-mono font-medium">{property.twilioPhone}</span>
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Texts to this number receive the application link when intake is on.
            </p>
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </form>
    </div>
  );
}

// Inline constants matching @tenant-ai/shared/constants
const OPENAI_REALTIME_MODELS = [
  { value: "gpt-4o-mini-realtime-preview", label: "gpt-4o-mini-realtime (Default)" },
  { value: "gpt-4o-realtime-preview", label: "gpt-4o-realtime" },
] as const;

const OPENAI_VOICES = [
  { value: "alloy", label: "Alloy" },
  { value: "echo", label: "Echo" },
  { value: "fable", label: "Fable" },
  { value: "onyx", label: "Onyx" },
  { value: "nova", label: "Nova" },
  { value: "shimmer", label: "Shimmer" },
] as const;

function SettingsTab({
  property,
  onUpdate,
  router,
}: {
  property: Property;
  onUpdate: () => void;
  router: ReturnType<typeof useRouter>;
}) {
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({
    description: property.description || "",
    amenities: property.amenities.join(", "),
    petPolicy: property.petPolicy || "",
    aiModel: property.aiModel,
    voiceName: property.voiceName,
    maxCallMinutes: property.maxCallMinutes,
    recordingEnabled: property.recordingEnabled,
    answerValidation: property.answerValidation,
    aiDisclosureText: property.aiDisclosureText || "",
    greetingMessage: property.greetingMessage || "",
  });

  function update(key: string, value: string | number | boolean) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/properties/${property.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: form.description || null,
        amenities: form.amenities
          ? form.amenities.split(",").map((a) => a.trim()).filter(Boolean)
          : [],
        petPolicy: form.petPolicy || null,
        aiModel: form.aiModel,
        voiceName: form.voiceName,
        maxCallMinutes: form.maxCallMinutes,
        recordingEnabled: form.recordingEnabled,
        answerValidation: form.answerValidation,
        aiDisclosureText: form.aiDisclosureText || null,
        greetingMessage: form.greetingMessage || null,
      }),
    });
    onUpdate();
    setSaving(false);
  }

  async function handleDelete() {
    if (
      !confirm(
        "Are you sure you want to delete this property? This cannot be undone."
      )
    ) {
      return;
    }
    setDeleting(true);
    const res = await fetch(`/api/properties/${property.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      router.push("/properties");
    } else {
      const data = await res.json();
      alert(data.error || "Failed to delete property");
      setDeleting(false);
    }
  }

  return (
    <div className="space-y-8">
      {/* Phone Number */}
      <PhoneAssignment property={property} onUpdate={onUpdate} />

    <form onSubmit={handleSave} className="space-y-8">
      {/* Property Details */}
      <section>
        <h3 className="mb-4 font-medium text-gray-900">Property Details</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Description
            </label>
            <textarea
              rows={3}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Amenities
            </label>
            <input
              type="text"
              value={form.amenities}
              onChange={(e) => update("amenities", e.target.value)}
              placeholder="Laundry, Parking, Pet-Friendly"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">Comma-separated</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Pet Policy
            </label>
            <textarea
              rows={3}
              value={form.petPolicy}
              onChange={(e) => update("petPolicy", e.target.value)}
              placeholder="e.g., Cats and small dogs allowed with $300 deposit. 2 pet max."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Property-wide pet policy (individual units can override)
            </p>
          </div>
        </div>
      </section>

      {/* AI Configuration */}
      <section>
        <h3 className="mb-4 font-medium text-gray-900">AI Configuration</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              AI Model
            </label>
            <select
              value={form.aiModel}
              onChange={(e) => update("aiModel", e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {OPENAI_REALTIME_MODELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Voice
            </label>
            <select
              value={form.voiceName}
              onChange={(e) => update("voiceName", e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              {OPENAI_VOICES.map((v) => (
                <option key={v.value} value={v.value}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Max Call Duration (minutes)
            </label>
            <input
              type="number"
              min={1}
              max={60}
              value={form.maxCallMinutes}
              onChange={(e) =>
                update("maxCallMinutes", parseInt(e.target.value, 10) || 15)
              }
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="recordingEnabled"
              checked={form.recordingEnabled}
              onChange={(e) => update("recordingEnabled", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="recordingEnabled" className="text-sm text-gray-700">
              Enable call recording
            </label>
          </div>
          <div className="flex items-center gap-2 pt-6">
            <input
              type="checkbox"
              id="answerValidation"
              checked={form.answerValidation}
              onChange={(e) => update("answerValidation", e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            <label htmlFor="answerValidation" className="text-sm text-gray-700">
              Enable AI answer validation
            </label>
          </div>
        </div>
        {form.recordingEnabled && (
          <p className="mt-2 text-xs text-amber-600">
            Illinois is a two-party consent state (720 ILCS 5/14-2). Recording
            consent language will be appended to the AI disclosure automatically.
          </p>
        )}
        {form.answerValidation && (
          <p className="mt-2 text-xs text-gray-500">
            A secondary AI will verify each answer for completeness before saving
            (e.g., full names include last name, addresses include city/state).
          </p>
        )}
      </section>

      {/* Test Your AI */}
      <TestCallSection property={property} />

      {/* Legal & Compliance */}
      <section>
        <h3 className="mb-4 font-medium text-gray-900">Legal & Compliance</h3>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              AI Disclosure Text
            </label>
            <textarea
              rows={2}
              value={form.aiDisclosureText}
              onChange={(e) => update("aiDisclosureText", e.target.value)}
              placeholder="This call is assisted by AI and may be recorded for quality purposes."
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Custom Greeting
            </label>
            <textarea
              rows={2}
              value={form.greetingMessage}
              onChange={(e) => update("greetingMessage", e.target.value)}
              placeholder="Optional custom greeting"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
        </div>
      </section>

      {/* Actions */}
      <div className="flex items-center justify-between border-t border-gray-200 pt-6">
        <button
          type="button"
          onClick={handleDelete}
          disabled={deleting}
          className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          {deleting ? "Deleting..." : "Delete Property"}
        </button>
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
      </div>
    </form>
    </div>
  );
}

function PhoneAssignment({
  property,
  onUpdate,
}: {
  property: Property;
  onUpdate: () => void;
}) {
  const [areaCode, setAreaCode] = useState("312");
  const [searching, setSearching] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [numbers, setNumbers] = useState<
    { phoneNumber: string; friendlyName: string; locality: string; region: string }[]
  >([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");

  async function searchNumbers() {
    if (!/^\d{3}$/.test(areaCode)) {
      setError("Enter a valid 3-digit area code");
      return;
    }
    setError("");
    setSearching(true);
    setNumbers([]);
    setSearched(false);
    try {
      const res = await fetch(`/api/twilio/available-numbers?areaCode=${areaCode}`);
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to search numbers");
      } else {
        setNumbers(data.numbers || []);
        setSearched(true);
      }
    } catch {
      setError("Failed to search numbers");
    } finally {
      setSearching(false);
    }
  }

  async function assignNumber(phoneNumber: string) {
    if (!confirm(`Assign ${phoneNumber} to this property?`)) return;
    setAssigning(true);
    setError("");
    try {
      const res = await fetch(`/api/properties/${property.id}/phone`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to assign phone number");
      } else {
        setNumbers([]);
        setSearched(false);
        onUpdate();
      }
    } catch {
      setError("Failed to assign phone number");
    } finally {
      setAssigning(false);
    }
  }

  async function releaseNumber() {
    if (!confirm("Release this phone number? The property will be deactivated.")) return;
    setReleasing(true);
    setError("");
    try {
      const res = await fetch(`/api/properties/${property.id}/phone`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to release phone number");
      } else {
        onUpdate();
      }
    } catch {
      setError("Failed to release phone number");
    } finally {
      setReleasing(false);
    }
  }

  return (
    <section>
      <h3 className="mb-4 font-medium text-gray-900">Phone Number</h3>

      {property.twilioPhone ? (
        <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4">
          <div>
            <p className="font-mono text-lg font-medium text-gray-900">
              {property.twilioPhone}
            </p>
            <p className="text-sm text-gray-500">
              Twilio phone number assigned to this property
            </p>
          </div>
          <button
            onClick={releaseNumber}
            disabled={releasing}
            className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {releasing ? "Releasing..." : "Release Number"}
          </button>
        </div>
      ) : (
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="mb-3 text-sm text-gray-600">
            Search for an available phone number to assign to this property.
          </p>
          <div className="flex items-end gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700">
                Area Code
              </label>
              <input
                type="text"
                maxLength={3}
                value={areaCode}
                onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
                placeholder="312"
                className="mt-1 w-24 rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={searchNumbers}
              disabled={searching}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {searching ? "Searching..." : "Search"}
            </button>
          </div>

          {searched && numbers.length === 0 && (
            <p className="mt-3 text-sm text-gray-500">
              No numbers found for area code {areaCode}. Try a different area code.
            </p>
          )}

          {numbers.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-sm font-medium text-gray-700">
                Available Numbers ({numbers.length})
              </p>
              {numbers.map((n) => (
                <div
                  key={n.phoneNumber}
                  className="flex items-center justify-between rounded border border-gray-100 px-3 py-2"
                >
                  <div>
                    <span className="font-mono text-sm font-medium text-gray-900">
                      {n.friendlyName}
                    </span>
                    <span className="ml-2 text-xs text-gray-500">
                      {n.locality}, {n.region}
                    </span>
                  </div>
                  <button
                    onClick={() => assignNumber(n.phoneNumber)}
                    disabled={assigning}
                    className="rounded-md bg-green-600 px-3 py-1 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
                  >
                    {assigning ? "Assigning..." : "Assign"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </section>
  );
}

function TestCallSection({ property }: { property: Property }) {
  const [phoneNumber, setPhoneNumber] = useState("");
  const [calling, setCalling] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");

  const canTestCall = property.twilioPhone && property.isActive;

  async function handleTestCall() {
    if (!phoneNumber.trim()) {
      setError("Please enter a phone number.");
      return;
    }
    setError("");
    setSuccess("");
    setCalling(true);

    try {
      const res = await fetch(`/api/properties/${property.id}/test-call`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phoneNumber: phoneNumber.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Failed to initiate test call.");
      } else {
        setSuccess("Call initiated! Your phone should ring shortly.");
      }
    } catch {
      setError("Failed to initiate test call. Please try again.");
    } finally {
      setCalling(false);
    }
  }

  return (
    <section>
      <h3 className="mb-4 font-medium text-gray-900">Test Your AI</h3>
      <p className="mb-4 text-sm text-gray-500">
        Call your AI to test how it sounds. The AI will call your phone and run
        through the application flow.
      </p>

      {!canTestCall && (
        <p className="text-sm text-amber-600">
          {!property.twilioPhone
            ? "A phone number must be configured before you can make test calls."
            : "The property must be active before you can make test calls."}
        </p>
      )}

      {canTestCall && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              Your Phone Number
            </label>
            <input
              type="tel"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="+1 (312) 123-4567"
              className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <p className="mt-1 text-xs text-gray-500">
              Enter the phone number where you want to receive the test call.
            </p>
          </div>

          <button
            type="button"
            onClick={handleTestCall}
            disabled={calling}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {calling ? "Calling..." : "Start Test Call"}
          </button>

          {success && (
            <div className="rounded-md bg-green-50 p-3 text-sm text-green-700">
              {success}
            </div>
          )}

          {error && (
            <div className="rounded-md bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
