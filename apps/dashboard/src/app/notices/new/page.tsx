"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import DashboardShell from "@/components/layout/DashboardShell";

interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

interface LeaseInfo {
  id: string;
  monthlyRent: number;
  overdueBalance?: number;
  unitNumber: string | null;
  startDate: string;
  endDate: string | null;
  property: {
    id: string;
    name: string;
    address: string;
  };
}

type NoticeType = "five_day" | "ten_day" | "thirty_day";

const NOTICE_TYPES: {
  value: NoticeType;
  title: string;
  subtitle: string;
  description: string;
  borderColor: string;
  selectedBg: string;
}[] = [
  {
    value: "five_day",
    title: "5-Day Notice",
    subtitle: "Non-Payment of Rent",
    description:
      "For tenants who haven't paid rent. Illinois 735 ILCS 5/9-209",
    borderColor: "border-red-300",
    selectedBg: "bg-red-50 border-red-500 ring-2 ring-red-200",
  },
  {
    value: "ten_day",
    title: "10-Day Notice",
    subtitle: "Lease Violation",
    description: "For lease violations. 735 ILCS 5/9-210",
    borderColor: "border-yellow-300",
    selectedBg: "bg-yellow-50 border-yellow-500 ring-2 ring-yellow-200",
  },
  {
    value: "thirty_day",
    title: "30-Day Notice",
    subtitle: "Termination",
    description:
      "For terminating month-to-month tenancies. 735 ILCS 5/9-207",
    borderColor: "border-blue-300",
    selectedBg: "bg-blue-50 border-blue-500 ring-2 ring-blue-200",
  },
];

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

function addDays(date: Date, days: number): string {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result.toISOString().split("T")[0];
}

export default function CreateNoticePage() {
  const router = useRouter();

  // Step management
  const [step, setStep] = useState(1);

  // Step 1: Notice type
  const [noticeType, setNoticeType] = useState<NoticeType | null>(null);

  // Step 2: Tenant selection
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [leaseInfo, setLeaseInfo] = useState<LeaseInfo | null>(null);
  const [leaseLoading, setLeaseLoading] = useState(false);

  // Step 3: Type-specific fields
  const [amountOwed, setAmountOwed] = useState("");
  const [periodCovered, setPeriodCovered] = useState("");
  const [violationDescription, setViolationDescription] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");

  // Step 4: Editable content
  const [editableContent, setEditableContent] = useState("");
  const [rewriting, setRewriting] = useState(false);
  const [rewriteError, setRewriteError] = useState("");
  const [aiInstructions, setAiInstructions] = useState("");
  const [showAiInstructions, setShowAiInstructions] = useState(false);

  // General state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Load tenants when entering step 2
  useEffect(() => {
    if (step === 2 && tenants.length === 0) {
      setTenantsLoading(true);
      fetch("/api/tenants")
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load tenants");
          return res.json();
        })
        .then((data) => {
          setTenants(data.tenants || []);
        })
        .catch(() => {
          setError("Failed to load tenants");
        })
        .finally(() => {
          setTenantsLoading(false);
        });
    }
  }, [step, tenants.length]);

  // Load lease info when tenant is selected
  useEffect(() => {
    if (!selectedTenantId) {
      setLeaseInfo(null);
      return;
    }

    setLeaseLoading(true);
    fetch(`/api/tenants/${selectedTenantId}`)
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load tenant info");
        return res.json();
      })
      .then((data) => {
        const tenant = data.tenant;
        if (tenant && tenant.leases && tenant.leases.length > 0) {
          const activeLease = tenant.leases.find(
            (l: { status: string }) => l.status === "active"
          ) || tenant.leases[0];
          setLeaseInfo(activeLease);

          // Auto-fill amount for 5-day notice
          if (noticeType === "five_day" && activeLease.monthlyRent) {
            const balance = activeLease.overdueBalance || activeLease.monthlyRent;
            setAmountOwed((balance / 100).toFixed(2));
          }
        }
      })
      .catch(() => {
        setError("Failed to load tenant lease information");
      })
      .finally(() => {
        setLeaseLoading(false);
      });
  }, [selectedTenantId, noticeType]);

  function getMinEffectiveDate(): string {
    return addDays(new Date(), 30);
  }

  function validateStep3(): boolean {
    if (noticeType === "five_day") {
      if (!amountOwed || parseFloat(amountOwed) <= 0) {
        setError("Amount owed is required and must be greater than zero.");
        return false;
      }
      if (!periodCovered.trim()) {
        setError("Period covered is required.");
        return false;
      }
    }
    if (noticeType === "ten_day") {
      if (!violationDescription.trim()) {
        setError("Violation description is required.");
        return false;
      }
    }
    if (noticeType === "thirty_day") {
      if (!effectiveDate) {
        setError("Effective date is required.");
        return false;
      }
      const minDate = getMinEffectiveDate();
      if (effectiveDate < minDate) {
        setError(
          `Effective date must be at least 30 days from today (${formatDate(minDate)}).`
        );
        return false;
      }
    }
    return true;
  }

  function getNoticeTypeLabel(type: NoticeType): string {
    const labels: Record<NoticeType, string> = {
      five_day: "5-Day Notice (Non-Payment of Rent)",
      ten_day: "10-Day Notice (Lease Violation)",
      thirty_day: "30-Day Notice (Termination)",
    };
    return labels[type];
  }

  function getSelectedTenant(): Tenant | undefined {
    return tenants.find((t) => t.id === selectedTenantId);
  }

  function generatePreviewText(): string {
    const tenant = getSelectedTenant();
    if (!tenant || !noticeType) return "";

    const tenantName = `${tenant.firstName} ${tenant.lastName}`;
    const propertyName = leaseInfo?.property.name || "the premises";
    const propertyAddress = leaseInfo?.property.address || "";
    const unit = leaseInfo?.unitNumber
      ? `, Unit ${leaseInfo.unitNumber}`
      : "";
    const today = formatDate(new Date().toISOString());

    if (noticeType === "five_day") {
      return `FIVE-DAY NOTICE TO PAY RENT OR QUIT
(Illinois 735 ILCS 5/9-209)

TO: ${tenantName}
PROPERTY: ${propertyName}, ${propertyAddress}${unit}
DATE: ${today}

You are hereby notified that there is now due and owing to the undersigned landlord the sum of $${amountOwed} for rent of the premises located at ${propertyName}${unit}, covering the period of ${periodCovered}.

You are hereby required to pay the said amount within FIVE (5) days from the date of service of this notice, or to vacate and surrender possession of the said premises to the undersigned.

If you fail to comply with this notice within the time specified, legal proceedings will be instituted against you to recover possession of said premises, to declare the forfeiture of the lease or rental agreement under which you occupy said premises, and to recover rents and damages, together with court costs and attorney fees, pursuant to the terms of your lease.

This notice is given pursuant to 735 ILCS 5/9-209 of the Illinois Code of Civil Procedure.`;
    }

    if (noticeType === "ten_day") {
      return `TEN-DAY NOTICE TO CURE OR QUIT
(Illinois 735 ILCS 5/9-210)

TO: ${tenantName}
PROPERTY: ${propertyName}, ${propertyAddress}${unit}
DATE: ${today}

You are hereby notified that you are in material noncompliance with your lease agreement for the premises located at ${propertyName}${unit}.

DESCRIPTION OF VIOLATION:
${violationDescription}

You are hereby required to cure the above violation(s) within TEN (10) days from the date of service of this notice, or to vacate and surrender possession of the said premises to the undersigned.

If you fail to comply with this notice within the time specified, your lease will be terminated and legal proceedings may be instituted against you to recover possession of said premises, together with court costs and attorney fees.

This notice is given pursuant to 735 ILCS 5/9-210 of the Illinois Code of Civil Procedure.`;
    }

    if (noticeType === "thirty_day") {
      const effDate = effectiveDate
        ? formatDate(effectiveDate)
        : "[Effective Date]";
      return `THIRTY-DAY NOTICE OF TERMINATION
(Illinois 735 ILCS 5/9-207)

TO: ${tenantName}
PROPERTY: ${propertyName}, ${propertyAddress}${unit}
DATE: ${today}

You are hereby notified that the undersigned landlord hereby terminates your month-to-month tenancy at the premises located at ${propertyName}${unit}.

You are hereby required to vacate and surrender possession of the said premises on or before ${effDate}, which is not less than thirty (30) days from the date of service of this notice.

This notice is given in accordance with 735 ILCS 5/9-207 of the Illinois Code of Civil Procedure. Your tenancy will terminate on the date specified above.

If you fail to vacate the premises by the date specified, legal proceedings may be instituted to recover possession of the premises, together with court costs and attorney fees.`;
    }

    return "";
  }

  async function handleSubmit() {
    if (!noticeType || !selectedTenantId || !leaseInfo) return;

    setSubmitting(true);
    setError("");

    try {
      const body: Record<string, unknown> = {
        type: noticeType,
        leaseId: leaseInfo.id,
        tenantId: selectedTenantId,
      };

      if (noticeType === "five_day") {
        body.amountOwed = Math.round(parseFloat(amountOwed) * 100);
        body.periodCovered = periodCovered;
      }
      if (noticeType === "ten_day") {
        body.violationDescription = violationDescription;
      }
      if (noticeType === "thirty_day") {
        body.effectiveDate = effectiveDate;
      }

      body.content = editableContent;

      const res = await fetch("/api/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to create notice");
        setSubmitting(false);
        return;
      }

      const data = await res.json();
      router.push(`/notices/${data.notice.id}`);
    } catch {
      setError("Failed to create notice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Breadcrumb */}
        <nav className="mb-6 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/notices" className="hover:text-blue-600">
            Notices
          </Link>
          <span>/</span>
          <span className="text-gray-900">Create Notice</span>
        </nav>

        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Create Legal Notice
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Generate a legally compliant notice for your tenant.
          </p>
        </div>

        {/* Step Indicators */}
        <div className="mb-8">
          <div className="flex items-center gap-2">
            {[
              { num: 1, label: "Notice Type" },
              { num: 2, label: "Select Tenant" },
              { num: 3, label: "Details" },
              { num: 4, label: "Preview" },
            ].map((s, i) => (
              <div key={s.num} className="flex items-center gap-2">
                {i > 0 && (
                  <div
                    className={`h-px w-8 ${
                      step >= s.num ? "bg-blue-600" : "bg-gray-300"
                    }`}
                  />
                )}
                <div
                  className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                    step === s.num
                      ? "bg-blue-600 text-white"
                      : step > s.num
                      ? "bg-blue-100 text-blue-700"
                      : "bg-gray-200 text-gray-500"
                  }`}
                >
                  {s.num}
                </div>
                <span
                  className={`text-sm font-medium ${
                    step === s.num ? "text-gray-900" : "text-gray-500"
                  }`}
                >
                  {s.label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-md bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Step 1: Select Notice Type */}
        {step === 1 && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Select Notice Type
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              {NOTICE_TYPES.map((nt) => (
                <button
                  key={nt.value}
                  onClick={() => {
                    setNoticeType(nt.value);
                    setError("");
                  }}
                  className={`rounded-lg border-2 p-6 text-left transition-all ${
                    noticeType === nt.value
                      ? nt.selectedBg
                      : `${nt.borderColor} bg-white hover:shadow-md`
                  }`}
                >
                  <h3 className="text-lg font-semibold text-gray-900">
                    {nt.title}
                  </h3>
                  <p className="mt-1 text-sm font-medium text-gray-700">
                    {nt.subtitle}
                  </p>
                  <p className="mt-2 text-sm text-gray-500">
                    {nt.description}
                  </p>
                </button>
              ))}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  if (!noticeType) {
                    setError("Please select a notice type.");
                    return;
                  }
                  setError("");
                  setStep(2);
                }}
                className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={!noticeType}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select Tenant */}
        {step === 2 && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Select Tenant
            </h2>

            {tenantsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="text-center">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                  <p className="mt-3 text-sm text-gray-500">
                    Loading tenants...
                  </p>
                </div>
              </div>
            ) : (
              <div className="max-w-md">
                <label
                  htmlFor="tenant-select"
                  className="block text-sm font-medium text-gray-700"
                >
                  Tenant
                </label>
                <select
                  id="tenant-select"
                  value={selectedTenantId}
                  onChange={(e) => {
                    setSelectedTenantId(e.target.value);
                    setError("");
                  }}
                  className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                >
                  <option value="">Select a tenant...</option>
                  {tenants.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.firstName} {t.lastName}
                      {t.email ? ` (${t.email})` : ""}
                    </option>
                  ))}
                </select>

                {/* Lease info display */}
                {leaseLoading && (
                  <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    Loading lease information...
                  </div>
                )}

                {leaseInfo && !leaseLoading && (
                  <div className="mt-4 rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <h3 className="text-sm font-medium text-gray-900">
                      Lease Information
                    </h3>
                    <dl className="mt-2 space-y-1 text-sm">
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Property</dt>
                        <dd className="text-gray-900">
                          {leaseInfo.property.name}
                        </dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Address</dt>
                        <dd className="text-gray-900">
                          {leaseInfo.property.address}
                        </dd>
                      </div>
                      {leaseInfo.unitNumber && (
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Unit</dt>
                          <dd className="text-gray-900">
                            {leaseInfo.unitNumber}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Monthly Rent</dt>
                        <dd className="text-gray-900">
                          ${formatMoney(leaseInfo.monthlyRent)}
                        </dd>
                      </div>
                      {noticeType === "five_day" && leaseInfo.overdueBalance !== undefined && leaseInfo.overdueBalance > 0 && (
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Total Overdue</dt>
                          <dd className="font-medium text-red-600">
                            ${formatMoney(leaseInfo.overdueBalance)}
                          </dd>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <dt className="text-gray-500">Lease Start</dt>
                        <dd className="text-gray-900">
                          {formatDate(leaseInfo.startDate)}
                        </dd>
                      </div>
                      {leaseInfo.endDate && (
                        <div className="flex justify-between">
                          <dt className="text-gray-500">Lease End</dt>
                          <dd className="text-gray-900">
                            {formatDate(leaseInfo.endDate)}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>
                )}
              </div>
            )}

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => {
                  setError("");
                  setStep(1);
                }}
                className="rounded-md border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => {
                  if (!selectedTenantId) {
                    setError("Please select a tenant.");
                    return;
                  }
                  if (!leaseInfo) {
                    setError(
                      "No lease information found for this tenant. A lease is required."
                    );
                    return;
                  }
                  setError("");
                  setStep(3);
                }}
                className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={!selectedTenantId || !leaseInfo}
              >
                Next
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Type-specific Fields */}
        {step === 3 && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Notice Details
            </h2>

            <div className="max-w-lg space-y-4">
              {noticeType === "five_day" && (
                <>
                  <div>
                    <label
                      htmlFor="amount-owed"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Amount Owed ($)
                    </label>
                    <input
                      id="amount-owed"
                      type="number"
                      step="0.01"
                      min="0"
                      value={amountOwed}
                      onChange={(e) => setAmountOwed(e.target.value)}
                      placeholder="0.00"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {leaseInfo && (
                      <p className="mt-1 text-xs text-gray-500">
                        Monthly rent: ${formatMoney(leaseInfo.monthlyRent)}
                      </p>
                    )}
                  </div>
                  <div>
                    <label
                      htmlFor="period-covered"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Period Covered
                    </label>
                    <input
                      id="period-covered"
                      type="text"
                      value={periodCovered}
                      onChange={(e) => setPeriodCovered(e.target.value)}
                      placeholder="e.g., January 2026"
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                  </div>
                </>
              )}

              {noticeType === "ten_day" && (
                <div>
                  <label
                    htmlFor="violation-description"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Violation Description
                  </label>
                  <textarea
                    id="violation-description"
                    value={violationDescription}
                    onChange={(e) => setViolationDescription(e.target.value)}
                    rows={5}
                    placeholder="Describe the lease violation(s) in detail..."
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Be specific about the lease terms that have been violated.
                  </p>
                </div>
              )}

              {noticeType === "thirty_day" && (
                <div>
                  <label
                    htmlFor="effective-date"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Effective Date
                  </label>
                  <input
                    id="effective-date"
                    type="date"
                    value={effectiveDate}
                    min={getMinEffectiveDate()}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    Must be at least 30 days from today (
                    {formatDate(getMinEffectiveDate())}).
                  </p>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-between">
              <button
                onClick={() => {
                  setError("");
                  setStep(2);
                }}
                className="rounded-md border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={() => {
                  setError("");
                  if (validateStep3()) {
                    setEditableContent(generatePreviewText());
                    setStep(4);
                  }
                }}
                className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Preview Notice
              </button>
            </div>
          </div>
        )}

        {/* Step 4: Preview */}
        {step === 4 && (
          <div>
            <h2 className="mb-4 text-lg font-semibold text-gray-900">
              Preview Notice
            </h2>

            {/* Summary Info */}
            <div className="mb-6 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-sm font-medium text-gray-500">
                Notice Summary
              </h3>
              <dl className="mt-3 grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="text-sm font-medium text-gray-500">Type</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {noticeType ? getNoticeTypeLabel(noticeType) : ""}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">Tenant</dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {(() => {
                      const t = getSelectedTenant();
                      return t ? `${t.firstName} ${t.lastName}` : "";
                    })()}
                  </dd>
                </div>
                <div>
                  <dt className="text-sm font-medium text-gray-500">
                    Property
                  </dt>
                  <dd className="mt-1 text-sm text-gray-900">
                    {leaseInfo?.property.name || ""}
                    {leaseInfo?.unitNumber
                      ? ` - Unit ${leaseInfo.unitNumber}`
                      : ""}
                  </dd>
                </div>
                {noticeType === "five_day" && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">
                      Amount Owed
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      ${amountOwed}
                    </dd>
                  </div>
                )}
                {noticeType === "thirty_day" && effectiveDate && (
                  <div>
                    <dt className="text-sm font-medium text-gray-500">
                      Effective Date
                    </dt>
                    <dd className="mt-1 text-sm text-gray-900">
                      {formatDate(effectiveDate)}
                    </dd>
                  </div>
                )}
              </dl>
            </div>

            {/* Editable Notice Content */}
            <div className="mb-6 rounded-lg border-2 border-gray-300 bg-white p-6 shadow-sm">
              <h3 className="mb-3 text-sm font-medium text-gray-900">
                Edit Notice Content
              </h3>
              <textarea
                value={editableContent}
                onChange={(e) => setEditableContent(e.target.value)}
                rows={20}
                className="w-full rounded-md border border-gray-300 px-3 py-2 font-mono text-sm leading-relaxed text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {rewriteError && (
                <div className="mt-2 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {rewriteError}
                </div>
              )}
              <div className="mt-2 flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => setEditableContent(generatePreviewText())}
                  className="text-sm text-gray-500 underline hover:text-gray-700"
                >
                  Reset to Template
                </button>
                <button
                  type="button"
                  disabled={rewriting}
                  onClick={async () => {
                    setRewriting(true);
                    setRewriteError("");
                    try {
                      const res = await fetch("/api/notices/ai-rewrite", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          content: editableContent,
                          noticeType: noticeType,
                          instructions: aiInstructions || undefined,
                        }),
                      });
                      const data = await res.json();
                      if (!res.ok) {
                        setRewriteError(data.error || "AI rewrite failed. Please try again.");
                      } else {
                        setEditableContent(data.rewrittenContent);
                      }
                    } catch {
                      setRewriteError("Network error. Please try again.");
                    } finally {
                      setRewriting(false);
                    }
                  }}
                  className="rounded-md border border-blue-300 bg-white px-3 py-1.5 text-sm font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-50"
                >
                  {rewriting ? "Rewriting..." : "AI Rewrite"}
                </button>
                <button
                  type="button"
                  onClick={() => setShowAiInstructions(!showAiInstructions)}
                  className="text-sm text-gray-400 hover:text-gray-600"
                >
                  {showAiInstructions ? "Hide instructions" : "Add instructions"}
                </button>
              </div>
              {showAiInstructions && (
                <input
                  type="text"
                  value={aiInstructions}
                  onChange={(e) => setAiInstructions(e.target.value)}
                  placeholder='e.g., "make more formal", "add late fee warning"'
                  className="mt-2 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                />
              )}
            </div>

            <div className="rounded-md bg-yellow-50 border border-yellow-200 p-4 text-sm text-yellow-800 mb-6">
              <p className="font-medium">Important</p>
              <p className="mt-1">
                Review the notice carefully before generating. Once created, the
                notice must be physically served to the tenant in accordance
                with Illinois law.
              </p>
            </div>

            <div className="flex justify-between">
              <button
                onClick={() => {
                  setError("");
                  setStep(3);
                }}
                className="rounded-md border border-gray-300 bg-white px-6 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Generating..." : "Generate Notice"}
              </button>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
