"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface ApplicationDetail {
  id: string;
  propertyId: string;
  status: string;
  channel: string;
  callerPhone: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
  ssn: string | null;
  ssnPresent: boolean;
  email: string | null;
  currentAddress: string | null;
  monthlyIncome: string | null;
  employer: string | null;
  employerPhone: string | null;
  rentalHistory: Record<string, unknown>[] | null;
  references: Record<string, unknown>[] | null;
  hasPets: boolean | null;
  petDetails: string | null;
  moveInDate: string | null;
  vehicles: Record<string, unknown>[] | null;
  customResponses: Record<string, unknown> | null;
  reviewNotes: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  property: {
    id: string;
    name: string;
  };
  callLog: {
    id: string;
    transcript: unknown;
    duration: number | null;
    channel: string;
    startedAt: string;
    endedAt: string | null;
  } | null;
}

const ALL_STATUSES: Record<string, string> = {
  in_progress: "In Progress",
  completed: "Completed",
  reviewed: "Reviewed",
  rejected: "Rejected",
};

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  in_progress: ["completed"],
  completed: ["reviewed", "rejected"],
  reviewed: ["rejected"],
  rejected: ["reviewed"],
};

function getAvailableStatuses(current: string) {
  const nextStatuses = ALLOWED_TRANSITIONS[current] || [];
  return [
    { value: current, label: ALL_STATUSES[current] || current },
    ...nextStatuses.map((s) => ({ value: s, label: ALL_STATUSES[s] || s })),
  ];
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    completed: "bg-green-100 text-green-700",
    reviewed: "bg-green-100 text-green-700",
    in_progress: "bg-yellow-100 text-yellow-700",
    rejected: "bg-red-100 text-red-700",
  };

  const labels: Record<string, string> = {
    completed: "Completed",
    reviewed: "Reviewed",
    in_progress: "In Progress",
    rejected: "Rejected",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
        styles[status] || "bg-gray-100 text-gray-700"
      }`}
    >
      {labels[status] || status}
    </span>
  );
}

function ChannelLabel({ channel }: { channel: string }) {
  const styles: Record<string, string> = {
    voice: "bg-blue-100 text-blue-700",
    sms: "bg-purple-100 text-purple-700",
    web: "bg-teal-100 text-teal-700",
  };

  return (
    <span
      className={`inline-flex rounded-full px-3 py-1 text-sm font-medium ${
        styles[channel] || "bg-gray-100 text-gray-700"
      }`}
    >
      {channel === "voice" ? "Voice" : channel === "sms" ? "SMS" : "Web"}
    </span>
  );
}

function InfoField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-sm font-medium text-gray-500">{label}</dt>
      <dd className="mt-1 text-sm text-gray-900">{value || "--"}</dd>
    </div>
  );
}

export default function ApplicationDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const [application, setApplication] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [reviewNotes, setReviewNotes] = useState("");
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [revealedSSN, setRevealedSSN] = useState<string | null>(null);
  const [revealingSSN, setRevealingSSN] = useState(false);
  const [showSSNConfirm, setShowSSNConfirm] = useState(false);
  const [converting, setConverting] = useState(false);
  const [convertResult, setConvertResult] = useState<{ tenantId: string } | null>(null);
  const [convertError, setConvertError] = useState("");

  useEffect(() => {
    async function loadApplication() {
      try {
        const res = await fetch(`/api/applications/${id}`);
        if (!res.ok) {
          if (res.status === 404) {
            setError("Application not found");
          } else {
            setError("Failed to load application");
          }
          setLoading(false);
          return;
        }

        const data = await res.json();
        setApplication(data.application);
        setReviewNotes(data.application.reviewNotes || "");
      } catch {
        setError("Failed to load application");
      } finally {
        setLoading(false);
      }
    }

    loadApplication();
  }, [id]);

  async function handleStatusChange(newStatus: string) {
    if (!application || statusUpdating) return;

    setStatusUpdating(true);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });

      if (res.ok) {
        const data = await res.json();
        setApplication((prev) =>
          prev
            ? {
                ...prev,
                status: data.application.status,
                reviewedAt: data.application.reviewedAt,
              }
            : null
        );
      }
    } catch {
      // silently fail for now
    } finally {
      setStatusUpdating(false);
    }
  }

  async function handleRevealSSN() {
    setRevealingSSN(true);
    try {
      const res = await fetch(`/api/applications/${id}/reveal-ssn`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        setRevealedSSN(data.ssn);
      }
    } catch {
      // fail silently
    } finally {
      setRevealingSSN(false);
      setShowSSNConfirm(false);
    }
  }

  async function handleConvertToTenant() {
    if (!application || converting) return;
    setConverting(true);
    setConvertError("");
    try {
      const res = await fetch(`/api/tenants/${application.id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ applicationId: application.id }),
      });
      if (res.ok) {
        const data = await res.json();
        setConvertResult({ tenantId: data.tenant.id });
      } else {
        const data = await res.json().catch(() => ({}));
        setConvertError(data.error || "Failed to convert to tenant");
      }
    } catch {
      setConvertError("Failed to convert to tenant");
    } finally {
      setConverting(false);
    }
  }

  async function handleSaveNotes() {
    if (!application || savingNotes) return;

    setSavingNotes(true);
    setNotesSaved(false);
    try {
      const res = await fetch(`/api/applications/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reviewNotes }),
      });

      if (res.ok) {
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 3000);
      }
    } catch {
      // silently fail
    } finally {
      setSavingNotes(false);
    }
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/applications" className="hover:text-blue-600">
            Applications
          </Link>
          <span>/</span>
          <span className="text-gray-900">
            {application?.fullName || "Application Detail"}
          </span>
        </nav>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
            <Link
              href="/applications"
              className="ml-2 font-medium text-red-800 underline hover:text-red-900"
            >
              Back to applications
            </Link>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">Loading application...</p>
            </div>
          </div>
        ) : application ? (
          <div className="space-y-6">
            {/* Header with status */}
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  {application.fullName || "Unknown Applicant"}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <StatusBadge status={application.status} />
                  <ChannelLabel channel={application.channel} />
                  <span className="text-sm text-gray-500">
                    Applied {formatDate(application.createdAt)}
                  </span>
                </div>
              </div>

              {/* Status change dropdown */}
              <div className="flex items-center gap-3">
                <label htmlFor="status-select" className="text-sm font-medium text-gray-700">
                  Change status:
                </label>
                <select
                  id="status-select"
                  value={application.status}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={statusUpdating}
                  className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50"
                >
                  {getAvailableStatuses(application.status).map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* SSN Reveal Confirmation Dialog */}
            {showSSNConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
                  <h3 className="text-lg font-semibold text-gray-900">Reveal SSN</h3>
                  <p className="mt-2 text-sm text-gray-600">
                    Revealing the SSN will be logged for compliance purposes. This action is audited. Continue?
                  </p>
                  <div className="mt-4 flex justify-end gap-3">
                    <button
                      onClick={() => setShowSSNConfirm(false)}
                      className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRevealSSN}
                      disabled={revealingSSN}
                      className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                    >
                      {revealingSSN ? "Revealing..." : "Confirm"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Convert to Tenant */}
            {(application.status === "reviewed" || application.status === "completed") &&
              !!application.email && (
                <div className="rounded-lg border border-blue-100 bg-blue-50 px-6 py-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-blue-900">Ready to onboard?</p>
                      <p className="mt-0.5 text-xs text-blue-700">
                        Convert this applicant into a tenant account
                      </p>
                    </div>
                    {convertResult ? (
                      <Link
                        href={`/tenants/${convertResult.tenantId}`}
                        className="rounded-md bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700"
                      >
                        View Tenant
                      </Link>
                    ) : (
                      <button
                        onClick={handleConvertToTenant}
                        disabled={converting}
                        className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                      >
                        {converting ? "Converting..." : "Convert to Tenant"}
                      </button>
                    )}
                  </div>
                  {convertError && (
                    <p className="mt-2 text-sm text-red-600">{convertError}</p>
                  )}
                </div>
              )}

            {/* Property link */}
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-500">Property</p>
                  <p className="mt-1 text-sm text-gray-900">{application.property.name}</p>
                </div>
                <Link
                  href={`/properties/${application.property.id}`}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  View property
                </Link>
              </div>
            </div>

            {/* Sections */}
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Personal Information */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Personal Information</h2>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <InfoField label="Full Name" value={application.fullName} />
                  <InfoField label="Email" value={application.email} />
                  <InfoField label="Phone" value={application.callerPhone} />
                  <InfoField label="Date of Birth" value={application.dateOfBirth ? "On file (encrypted)" : null} />
                  <div>
                    <dt className="text-sm font-medium text-gray-500">SSN</dt>
                    <dd className="mt-1 flex items-center gap-2 text-sm text-gray-900">
                      {application.ssnPresent ? (
                        revealedSSN ? (
                          <span className="font-mono">{revealedSSN}</span>
                        ) : (
                          <>
                            <span>{application.ssn || "On file (encrypted)"}</span>
                            <button
                              onClick={() => setShowSSNConfirm(true)}
                              disabled={revealingSSN}
                              className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
                            >
                              {revealingSSN ? "Revealing..." : "Reveal"}
                            </button>
                          </>
                        )
                      ) : (
                        <span className="text-gray-400">Not provided</span>
                      )}
                    </dd>
                  </div>
                  <InfoField label="Current Address" value={application.currentAddress} />
                </dl>
              </div>

              {/* Employment */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Employment</h2>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <InfoField label="Employer" value={application.employer} />
                  <InfoField label="Employer Phone" value={application.employerPhone} />
                  <InfoField label="Monthly Income" value={application.monthlyIncome ? `$${application.monthlyIncome}` : null} />
                </dl>
              </div>

              {/* Housing */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Housing</h2>
                <dl className="grid gap-4 sm:grid-cols-2">
                  <InfoField label="Desired Move-in Date" value={application.moveInDate} />
                  <InfoField
                    label="Pets"
                    value={
                      application.hasPets === null
                        ? null
                        : application.hasPets
                        ? `Yes${application.petDetails ? ` - ${application.petDetails}` : ""}`
                        : "No"
                    }
                  />
                </dl>

                {application.rentalHistory &&
                  Array.isArray(application.rentalHistory) &&
                  application.rentalHistory.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium text-gray-500">Rental History</p>
                      <div className="mt-2 space-y-2">
                        {application.rentalHistory.map((entry, i) => (
                          <div
                            key={i}
                            className="rounded-md bg-gray-50 p-3 text-sm text-gray-700"
                          >
                            {Object.entries(entry).map(([key, val]) => (
                              <p key={key}>
                                <span className="font-medium">{key}:</span> {String(val)}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {application.vehicles &&
                  Array.isArray(application.vehicles) &&
                  application.vehicles.length > 0 && (
                    <div className="mt-4">
                      <p className="text-sm font-medium text-gray-500">Vehicles</p>
                      <div className="mt-2 space-y-2">
                        {application.vehicles.map((vehicle, i) => (
                          <div
                            key={i}
                            className="rounded-md bg-gray-50 p-3 text-sm text-gray-700"
                          >
                            {Object.entries(vehicle).map(([key, val]) => (
                              <p key={key}>
                                <span className="font-medium">{key}:</span> {String(val)}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
              </div>

              {/* Additional Information */}
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Additional Information</h2>

                {application.references &&
                  Array.isArray(application.references) &&
                  application.references.length > 0 && (
                    <div className="mb-4">
                      <p className="text-sm font-medium text-gray-500">References</p>
                      <div className="mt-2 space-y-2">
                        {application.references.map((ref, i) => (
                          <div
                            key={i}
                            className="rounded-md bg-gray-50 p-3 text-sm text-gray-700"
                          >
                            {Object.entries(ref).map(([key, val]) => (
                              <p key={key}>
                                <span className="font-medium">{key}:</span> {String(val)}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                {application.customResponses &&
                  typeof application.customResponses === "object" &&
                  Object.keys(application.customResponses).length > 0 && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Custom Responses</p>
                      <dl className="mt-2 space-y-2">
                        {Object.entries(application.customResponses).map(([key, val]) => (
                          <div key={key} className="rounded-md bg-gray-50 p-3">
                            <dt className="text-xs font-medium text-gray-500">{key}</dt>
                            <dd className="mt-0.5 text-sm text-gray-900">{String(val)}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  )}

                {!application.references?.length &&
                  (!application.customResponses ||
                    Object.keys(application.customResponses).length === 0) && (
                    <p className="text-sm text-gray-500">No additional information provided.</p>
                  )}
              </div>
            </div>

            {/* Call Log */}
            {application.callLog && (
              <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-lg font-semibold text-gray-900">Call Details</h2>
                <dl className="grid gap-4 sm:grid-cols-3">
                  <InfoField label="Channel" value={application.callLog.channel} />
                  <InfoField
                    label="Duration"
                    value={
                      application.callLog.duration
                        ? `${Math.floor(application.callLog.duration / 60)}m ${application.callLog.duration % 60}s`
                        : null
                    }
                  />
                  <InfoField label="Started At" value={formatDate(application.callLog.startedAt)} />
                </dl>
              </div>
            )}

            {/* Transcript Viewer */}
            {!!(application.callLog?.transcript) &&
              Array.isArray(application.callLog.transcript) &&
              application.callLog.transcript.length > 0 && (
                <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
                  <h2 className="mb-4 text-lg font-semibold text-gray-900">Conversation Transcript</h2>
                  <div className="max-h-[500px] space-y-3 overflow-y-auto pr-2">
                    {(application.callLog.transcript as Array<{ role: string; content: string; timestamp?: string }>).map(
                      (entry, i) => {
                        const isAI = entry.role === "ai" || entry.role === "assistant" || entry.role === "system";
                        return (
                          <div
                            key={i}
                            className={`flex ${isAI ? "justify-start" : "justify-end"}`}
                          >
                            <div
                              className={`max-w-[75%] rounded-lg px-4 py-2.5 ${
                                isAI
                                  ? "bg-gray-100 text-gray-800"
                                  : "bg-blue-600 text-white"
                              }`}
                            >
                              <p className="text-sm whitespace-pre-wrap">{entry.content}</p>
                              {entry.timestamp && (
                                <p
                                  className={`mt-1 text-xs ${
                                    isAI ? "text-gray-400" : "text-blue-200"
                                  }`}
                                >
                                  {new Date(entry.timestamp).toLocaleTimeString("en-US", {
                                    hour: "numeric",
                                    minute: "2-digit",
                                  })}
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      }
                    )}
                  </div>
                </div>
              )}

            {/* Review Notes */}
            <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-lg font-semibold text-gray-900">Review Notes</h2>
              <textarea
                value={reviewNotes}
                onChange={(e) => setReviewNotes(e.target.value)}
                placeholder="Add review notes for this application..."
                rows={4}
                className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="mt-3 flex items-center gap-3">
                <button
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {savingNotes ? "Saving..." : "Save Notes"}
                </button>
                {notesSaved && (
                  <span className="text-sm text-green-600">Notes saved successfully</span>
                )}
              </div>
              {application.reviewedAt && (
                <p className="mt-3 text-xs text-gray-400">
                  Last reviewed: {formatDate(application.reviewedAt)}
                </p>
              )}
            </div>

            {/* Timestamps */}
            <div className="rounded-lg border border-gray-200 bg-white px-6 py-4 shadow-sm">
              <div className="flex flex-wrap gap-6 text-xs text-gray-400">
                <span>Created: {formatDate(application.createdAt)}</span>
                <span>Updated: {formatDate(application.updatedAt)}</span>
                {application.completedAt && (
                  <span>Completed: {formatDate(application.completedAt)}</span>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </DashboardShell>
  );
}
