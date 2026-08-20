"use client";

import { useEffect, useState, FormEvent, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

/* ── Types ───────────────────────────────────────────────────── */

interface PropertyQuestion {
  id: string;
  text: string;
  fieldKey: string;
  type: string;
  required: boolean;
}

interface Property {
  id: string;
  name: string;
  address: string;
  twilioPhone: string | null;
  questions: PropertyQuestion[];
}

interface VehicleInfo {
  make: string;
  model: string;
  year: string;
  licensePlate: string;
}

const STANDARD_FIELD_KEYS = new Set([
  "fullName",
  "dateOfBirth",
  "ssn",
  "email",
  "currentAddress",
  "monthlyIncome",
  "employer",
  "employerPhone",
  "moveInDate",
  "hasPets",
  "petDetails",
  "vehicles",
  "rentalHistory",
  "references",
]);

const TOTAL_STEPS = 4;

/* ── Helpers ─────────────────────────────────────────────────── */

function formatPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length === 11 && cleaned.startsWith("1")) {
    return `(${cleaned.slice(1, 4)}) ${cleaned.slice(4, 7)}-${cleaned.slice(7)}`;
  }
  if (cleaned.length === 10) {
    return `(${cleaned.slice(0, 3)}) ${cleaned.slice(3, 6)}-${cleaned.slice(6)}`;
  }
  return phone;
}

function formatSsnDisplay(digits: string): string {
  if (digits.length <= 3) return digits;
  if (digits.length <= 5) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 9)}`;
}

/* ── Spinner ─────────────────────────────────────────────────── */

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

/* ── Error Alert ─────────────────────────────────────────────── */

function ErrorAlert({ message }: { message: string }) {
  return (
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
      {message}
    </div>
  );
}

/* ── Progress Bar ────────────────────────────────────────────── */

function ProgressBar({ currentStep }: { currentStep: number }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-gray-700">
          Step {currentStep} of {TOTAL_STEPS}
        </span>
        <span className="text-sm text-gray-500">
          {currentStep === 1 && "Personal Information"}
          {currentStep === 2 && "Employment & Income"}
          {currentStep === 3 && "Housing & Additional"}
          {currentStep === 4 && "Review & Submit"}
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-gray-200">
        <div
          className="h-2 rounded-full bg-blue-600 transition-all duration-300"
          style={{ width: `${(currentStep / TOTAL_STEPS) * 100}%` }}
        />
      </div>
      {/* Step dots */}
      <div className="mt-3 flex justify-between">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((step) => (
          <div key={step} className="flex flex-col items-center">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium transition-colors ${
                step < currentStep
                  ? "bg-blue-600 text-white"
                  : step === currentStep
                    ? "bg-blue-600 text-white ring-4 ring-blue-100"
                    : "bg-gray-200 text-gray-500"
              }`}
            >
              {step < currentStep ? (
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2.5}
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M4.5 12.75l6 6 9-13.5"
                  />
                </svg>
              ) : (
                step
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────────── */

export default function MultiStepApplyPage() {
  const params = useParams();
  const propertyId = params.id as string;

  /* State: data loading */
  const [property, setProperty] = useState<Property | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  /* State: form navigation */
  const [step, setStep] = useState(1);
  const [stepError, setStepError] = useState<string | null>(null);

  /* State: submission */
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  /* State: Turnstile CAPTCHA */
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

  /* State: SMS survey invite (set when arriving from a texted link) */
  const [inviteToken, setInviteToken] = useState<string | null>(null);

  /* Step 1: Personal Information */
  const [fullName, setFullName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [ssnDigits, setSsnDigits] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");

  /* When arriving from a texted survey link (?invite=…), capture the token and
     prefill the phone number from the invite. */
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("invite");
    if (!t) return;
    // Only treat the token as an invite if it validates; otherwise fall back to a
    // normal web application so a stale/bad ?invite= param can't block submission.
    fetch(`/api/survey/${encodeURIComponent(t)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.valid) {
          setInviteToken(t);
          if (d.phone) setPhone(formatPhone(d.phone));
        }
      })
      .catch(() => {});
  }, []);

  /* Step 2: Employment & Income */
  const [employer, setEmployer] = useState("");
  const [employerPhone, setEmployerPhone] = useState("");
  const [monthlyIncome, setMonthlyIncome] = useState("");

  /* Step 3: Housing & Additional */
  const [currentAddress, setCurrentAddress] = useState("");
  const [moveInDate, setMoveInDate] = useState("");
  const [hasPets, setHasPets] = useState(false);
  const [petDetails, setPetDetails] = useState("");
  const [vehicle, setVehicle] = useState<VehicleInfo>({
    make: "",
    model: "",
    year: "",
    licensePlate: "",
  });
  const [rentalHistory, setRentalHistory] = useState("");
  const [references, setReferences] = useState("");

  /* Step 4: Custom Questions */
  const [customResponses, setCustomResponses] = useState<
    Record<string, string>
  >({});

  /* Derived: custom (non-standard) questions */
  const customQuestions =
    property?.questions.filter((q) => !STANDARD_FIELD_KEYS.has(q.fieldKey)) ??
    [];

  /* ── Turnstile widget ─────────────────────────────────────── */

  useEffect(() => {
    if (!turnstileSiteKey || step !== TOTAL_STEPS) return;

    // Load the Turnstile script once
    const existingScript = document.querySelector(
      'script[src="https://challenges.cloudflare.com/turnstile/v0/api.js"]'
    );
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
      script.async = true;
      document.head.appendChild(script);
      script.onload = () => renderWidget();
    } else {
      renderWidget();
    }

    function renderWidget() {
      const container = document.getElementById("turnstile-widget");
      if (container && (window as any).turnstile) {
        container.innerHTML = "";
        (window as any).turnstile.render(container, {
          sitekey: turnstileSiteKey,
          callback: (token: string) => setTurnstileToken(token),
        });
      }
    }
  }, [turnstileSiteKey, step]);

  /* ── Fetch property on mount ───────────────────────────────── */

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/properties/${propertyId}`);
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error || "Property not found");
        }
        const data = await res.json();
        setProperty(data.property);
      } catch (err) {
        setLoadError(
          err instanceof Error ? err.message : "Failed to load property"
        );
      } finally {
        setLoading(false);
      }
    }
    if (propertyId) load();
  }, [propertyId]);

  /* ── SSN input handler ─────────────────────────────────────── */

  function handleSsnChange(raw: string) {
    const digits = raw.replace(/\D/g, "").slice(0, 9);
    setSsnDigits(digits);
  }

  /* ── Step validation ───────────────────────────────────────── */

  const validateStep = useCallback(
    (s: number): string | null => {
      switch (s) {
        case 1: {
          if (!fullName.trim()) return "Full Name is required.";
          if (!dateOfBirth) return "Date of Birth is required.";
          if (ssnDigits.length !== 9)
            return "SSN must be 9 digits (XXX-XX-XXXX).";
          if (!email.trim()) return "Email is required.";
          if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
            return "Please enter a valid email address.";
          if (!phone.trim()) return "Phone number is required.";
          {
            const phoneDigits = phone.replace(/\D/g, "");
            if (phoneDigits.length < 10 || phoneDigits.length > 11)
              return "Phone number must be 10 digits (e.g., (312) 123-4567).";
          }
          return null;
        }
        case 2:
          // All fields optional in step 2
          return null;
        case 3:
          // All fields optional in step 3
          return null;
        case 4:
          for (const q of customQuestions) {
            if (q.required && !customResponses[q.fieldKey]?.trim()) {
              return `${q.text} is required.`;
            }
          }
          return null;
        default:
          return null;
      }
    },
    [fullName, dateOfBirth, ssnDigits, email, phone, customQuestions, customResponses]
  );

  /* ── Navigation ────────────────────────────────────────────── */

  function goNext() {
    setStepError(null);
    const err = validateStep(step);
    if (err) {
      setStepError(err);
      return;
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setStepError(null);
    setStep((s) => Math.max(s - 1, 1));
  }

  /* ── Submit ────────────────────────────────────────────────── */

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);

    // Build vehicle string if any info provided
    const vehicleParts = [vehicle.year, vehicle.make, vehicle.model]
      .filter(Boolean)
      .join(" ");
    const vehicleStr = vehicle.licensePlate
      ? `${vehicleParts} (${vehicle.licensePlate})`.trim()
      : vehicleParts;

    const payload: Record<string, unknown> = {
      propertyId,
      ...(turnstileToken ? { turnstileToken } : {}),
      ...(inviteToken ? { token: inviteToken } : {}),
      fullName: fullName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      dateOfBirth,
      ssn: ssnDigits,
      currentAddress: currentAddress.trim() || undefined,
      monthlyIncome: monthlyIncome.trim() || undefined,
      employer: employer.trim() || undefined,
      employerPhone: employerPhone.trim() || undefined,
      moveInDate: moveInDate || undefined,
      hasPets,
      petDetails: hasPets ? petDetails.trim() || undefined : undefined,
      vehicles: vehicleStr || undefined,
      rentalHistory: rentalHistory.trim() || undefined,
      references: references.trim() || undefined,
    };

    // Merge custom responses
    for (const [key, value] of Object.entries(customResponses)) {
      if (value.trim()) {
        payload[key] = value.trim();
      }
    }

    try {
      const res = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to submit application.");
      }

      setSubmitted(true);
    } catch (err) {
      setSubmitError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Loading state ─────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
        <div className="flex items-center gap-3 text-gray-500">
          <Spinner size="h-5 w-5" />
          <span className="text-sm">Loading application...</span>
        </div>
      </div>
    );
  }

  /* ── Load error state ──────────────────────────────────────── */

  if (loadError || !property) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
            <svg
              className="h-8 w-8 text-red-600"
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
          <h2 className="mt-4 text-xl font-bold text-gray-900">
            Property Not Found
          </h2>
          <p className="mt-2 text-gray-500">
            {loadError || "The property you are looking for could not be found."}
          </p>
          <Link href="/" className="btn-primary mt-6 inline-block">
            Back to Properties
          </Link>
        </div>
      </div>
    );
  }

  /* ── Success state ─────────────────────────────────────────── */

  if (submitted) {
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
          Thank you! Your application has been submitted.
        </h2>
        <p className="mt-3 max-w-md text-center text-gray-500">
          The property manager will review your application and get back to you
          soon. You will receive a confirmation at{" "}
          <span className="font-medium text-gray-700">{email}</span>.
        </p>
        <Link href="/" className="btn-primary mt-8">
          Back to Properties
        </Link>
      </div>
    );
  }

  /* ── Form ──────────────────────────────────────────────────── */

  return (
    <div className="flex min-h-[80vh] items-center justify-center px-4 py-12">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-2">
          <h1 className="text-2xl font-bold text-gray-900">
            Rental Application
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Applying for{" "}
            <span className="font-medium text-gray-700">{property.name}</span>
            {" "}at {property.address}
          </p>
        </div>

        {/* Phone option */}
        {property.twilioPhone && (
          <div className="mt-4 mb-6 flex items-center gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-100">
              <svg
                className="h-4 w-4 text-blue-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z"
                />
              </svg>
            </div>
            <p className="text-sm text-blue-700">
              Prefer to apply by phone? Call or text{" "}
              <a
                href={`tel:${property.twilioPhone}`}
                className="font-bold underline"
              >
                {formatPhone(property.twilioPhone)}
              </a>
            </p>
          </div>
        )}

        {/* Progress */}
        <ProgressBar currentStep={step} />

        {/* Step error */}
        {stepError && <ErrorAlert message={stepError} />}
        {submitError && <ErrorAlert message={submitError} />}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          {/* ── Step 1: Personal Information ─────────────────── */}
          {step === 1 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">
                Personal Information
              </h2>

              {/* Full Name */}
              <div>
                <label
                  htmlFor="fullName"
                  className="block text-sm font-medium text-gray-700"
                >
                  Full Name <span className="text-red-500">*</span>
                </label>
                <input
                  id="fullName"
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="John Doe"
                />
              </div>

              {/* Date of Birth */}
              <div>
                <label
                  htmlFor="dob"
                  className="block text-sm font-medium text-gray-700"
                >
                  Date of Birth <span className="text-red-500">*</span>
                </label>
                <input
                  id="dob"
                  type="date"
                  required
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                  className="input-field mt-1.5"
                />
              </div>

              {/* SSN */}
              <div>
                <label
                  htmlFor="ssn"
                  className="block text-sm font-medium text-gray-700"
                >
                  Social Security Number <span className="text-red-500">*</span>
                </label>
                <input
                  id="ssn"
                  type="text"
                  inputMode="numeric"
                  required
                  value={formatSsnDisplay(ssnDigits)}
                  onChange={(e) => handleSsnChange(e.target.value)}
                  className="input-field mt-1.5 font-mono tracking-wider"
                  placeholder="___-__-____"
                  maxLength={11}
                />
                <p className="mt-1 text-xs text-gray-400">
                  Format: XXX-XX-XXXX
                </p>
              </div>

              {/* Email */}
              <div>
                <label
                  htmlFor="email"
                  className="block text-sm font-medium text-gray-700"
                >
                  Email <span className="text-red-500">*</span>
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="you@example.com"
                />
              </div>

              {/* Phone */}
              <div>
                <label
                  htmlFor="phone"
                  className="block text-sm font-medium text-gray-700"
                >
                  Phone <span className="text-red-500">*</span>
                </label>
                <input
                  id="phone"
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="(312) 123-4567"
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Employment & Income ──────────────────── */}
          {step === 2 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">
                Employment & Income
              </h2>

              {/* Employer Name */}
              <div>
                <label
                  htmlFor="employer"
                  className="block text-sm font-medium text-gray-700"
                >
                  Employer Name
                </label>
                <input
                  id="employer"
                  type="text"
                  value={employer}
                  onChange={(e) => setEmployer(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="Company name"
                />
              </div>

              {/* Employer Phone */}
              <div>
                <label
                  htmlFor="employerPhone"
                  className="block text-sm font-medium text-gray-700"
                >
                  Employer Phone
                </label>
                <input
                  id="employerPhone"
                  type="tel"
                  value={employerPhone}
                  onChange={(e) => setEmployerPhone(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="(312) 555-0100"
                />
              </div>

              {/* Monthly Income */}
              <div>
                <label
                  htmlFor="monthlyIncome"
                  className="block text-sm font-medium text-gray-700"
                >
                  Monthly Income
                </label>
                <input
                  id="monthlyIncome"
                  type="text"
                  value={monthlyIncome}
                  onChange={(e) => setMonthlyIncome(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="$5,000"
                />
              </div>
            </div>
          )}

          {/* ── Step 3: Housing & Additional ─────────────────── */}
          {step === 3 && (
            <div className="space-y-5">
              <h2 className="text-lg font-semibold text-gray-900">
                Housing & Additional
              </h2>

              {/* Current Address */}
              <div>
                <label
                  htmlFor="currentAddress"
                  className="block text-sm font-medium text-gray-700"
                >
                  Current Address
                </label>
                <input
                  id="currentAddress"
                  type="text"
                  value={currentAddress}
                  onChange={(e) => setCurrentAddress(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="123 Main St, City, State ZIP"
                />
              </div>

              {/* Move-in Date */}
              <div>
                <label
                  htmlFor="moveInDate"
                  className="block text-sm font-medium text-gray-700"
                >
                  Desired Move-in Date
                </label>
                <input
                  id="moveInDate"
                  type="date"
                  value={moveInDate}
                  onChange={(e) => setMoveInDate(e.target.value)}
                  className="input-field mt-1.5"
                />
              </div>

              {/* Has Pets */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Do you have pets?
                </label>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setHasPets(true)}
                    className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      hasPets
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHasPets(false);
                      setPetDetails("");
                    }}
                    className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                      !hasPets
                        ? "border-blue-600 bg-blue-50 text-blue-700"
                        : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>

              {/* Pet Details */}
              {hasPets && (
                <div>
                  <label
                    htmlFor="petDetails"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Pet Details
                  </label>
                  <textarea
                    id="petDetails"
                    rows={3}
                    value={petDetails}
                    onChange={(e) => setPetDetails(e.target.value)}
                    className="input-field mt-1.5"
                    placeholder="Type, breed, size, number of pets..."
                  />
                </div>
              )}

              {/* Vehicle Info */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-3">
                  Vehicle Information{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <input
                      type="text"
                      value={vehicle.make}
                      onChange={(e) =>
                        setVehicle((v) => ({ ...v, make: e.target.value }))
                      }
                      className="input-field"
                      placeholder="Make"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={vehicle.model}
                      onChange={(e) =>
                        setVehicle((v) => ({ ...v, model: e.target.value }))
                      }
                      className="input-field"
                      placeholder="Model"
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={vehicle.year}
                      onChange={(e) =>
                        setVehicle((v) => ({ ...v, year: e.target.value }))
                      }
                      className="input-field"
                      placeholder="Year"
                      maxLength={4}
                    />
                  </div>
                  <div>
                    <input
                      type="text"
                      value={vehicle.licensePlate}
                      onChange={(e) =>
                        setVehicle((v) => ({
                          ...v,
                          licensePlate: e.target.value,
                        }))
                      }
                      className="input-field"
                      placeholder="License Plate"
                    />
                  </div>
                </div>
              </div>

              {/* Rental History */}
              <div>
                <label
                  htmlFor="rentalHistory"
                  className="block text-sm font-medium text-gray-700"
                >
                  Rental History{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="rentalHistory"
                  rows={3}
                  value={rentalHistory}
                  onChange={(e) => setRentalHistory(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="Previous addresses, landlord names, how long you lived there"
                />
              </div>

              {/* References */}
              <div>
                <label
                  htmlFor="references"
                  className="block text-sm font-medium text-gray-700"
                >
                  References{" "}
                  <span className="text-gray-400 font-normal">(optional)</span>
                </label>
                <textarea
                  id="references"
                  rows={3}
                  value={references}
                  onChange={(e) => setReferences(e.target.value)}
                  className="input-field mt-1.5"
                  placeholder="Name, phone, relationship"
                />
              </div>
            </div>
          )}

          {/* ── Step 4: Custom Questions + Review ────────────── */}
          {step === 4 && (
            <div className="space-y-6">
              {/* Custom Questions */}
              {customQuestions.length > 0 && (
                <div className="space-y-5">
                  <h2 className="text-lg font-semibold text-gray-900">
                    Additional Questions
                  </h2>
                  {customQuestions.map((q) => (
                    <div key={q.id}>
                      <label
                        htmlFor={`custom-${q.fieldKey}`}
                        className="block text-sm font-medium text-gray-700"
                      >
                        {q.text}
                        {q.required && (
                          <span className="text-red-500"> *</span>
                        )}
                      </label>
                      {q.type === "yes_no" ? (
                        <div className="mt-1.5 flex gap-4">
                          <button
                            type="button"
                            onClick={() =>
                              setCustomResponses((prev) => ({
                                ...prev,
                                [q.fieldKey]: "yes",
                              }))
                            }
                            className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                              customResponses[q.fieldKey] === "yes"
                                ? "border-blue-600 bg-blue-50 text-blue-700"
                                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                            }`}
                          >
                            Yes
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setCustomResponses((prev) => ({
                                ...prev,
                                [q.fieldKey]: "no",
                              }))
                            }
                            className={`flex-1 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-colors ${
                              customResponses[q.fieldKey] === "no"
                                ? "border-blue-600 bg-blue-50 text-blue-700"
                                : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
                            }`}
                          >
                            No
                          </button>
                        </div>
                      ) : (
                        <input
                          id={`custom-${q.fieldKey}`}
                          type={q.type === "number" ? "number" : q.type === "date" ? "date" : "text"}
                          required={q.required}
                          value={customResponses[q.fieldKey] || ""}
                          onChange={(e) =>
                            setCustomResponses((prev) => ({
                              ...prev,
                              [q.fieldKey]: e.target.value,
                            }))
                          }
                          className="input-field mt-1.5"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Review Summary */}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">
                  Review Your Application
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  Please review the information below before submitting.
                </p>

                <div className="mt-4 space-y-4">
                  {/* Personal Information */}
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Personal Information
                      </h3>
                      <button
                        type="button"
                        onClick={() => setStep(1)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-sm">
                      <ReviewRow label="Full Name" value={fullName} />
                      <ReviewRow label="Date of Birth" value={dateOfBirth} />
                      <ReviewRow
                        label="SSN"
                        value={
                          ssnDigits.length === 9
                            ? `***-**-${ssnDigits.slice(5)}`
                            : "Not provided"
                        }
                      />
                      <ReviewRow label="Email" value={email} />
                      <ReviewRow label="Phone" value={phone} />
                    </dl>
                  </div>

                  {/* Employment & Income */}
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Employment & Income
                      </h3>
                      <button
                        type="button"
                        onClick={() => setStep(2)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-sm">
                      <ReviewRow
                        label="Employer"
                        value={employer || "Not provided"}
                      />
                      <ReviewRow
                        label="Employer Phone"
                        value={employerPhone || "Not provided"}
                      />
                      <ReviewRow
                        label="Monthly Income"
                        value={monthlyIncome || "Not provided"}
                      />
                    </dl>
                  </div>

                  {/* Housing & Additional */}
                  <div className="rounded-lg border border-gray-200 p-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold text-gray-900">
                        Housing & Additional
                      </h3>
                      <button
                        type="button"
                        onClick={() => setStep(3)}
                        className="text-xs font-medium text-blue-600 hover:text-blue-700"
                      >
                        Edit
                      </button>
                    </div>
                    <dl className="grid grid-cols-1 gap-2 text-sm">
                      <ReviewRow
                        label="Current Address"
                        value={currentAddress || "Not provided"}
                      />
                      <ReviewRow
                        label="Move-in Date"
                        value={moveInDate || "Not provided"}
                      />
                      <ReviewRow
                        label="Pets"
                        value={
                          hasPets
                            ? petDetails || "Yes"
                            : "No"
                        }
                      />
                      <ReviewRow
                        label="Vehicle"
                        value={
                          vehicle.make || vehicle.model
                            ? [vehicle.year, vehicle.make, vehicle.model]
                                .filter(Boolean)
                                .join(" ") +
                              (vehicle.licensePlate
                                ? ` (${vehicle.licensePlate})`
                                : "")
                            : "Not provided"
                        }
                      />
                      <ReviewRow
                        label="Rental History"
                        value={rentalHistory.trim() || "Not provided"}
                      />
                      <ReviewRow
                        label="References"
                        value={references.trim() || "Not provided"}
                      />
                    </dl>
                  </div>

                  {/* Custom Responses */}
                  {customQuestions.length > 0 && (
                    <div className="rounded-lg border border-gray-200 p-4">
                      <h3 className="text-sm font-semibold text-gray-900 mb-3">
                        Additional Questions
                      </h3>
                      <dl className="grid grid-cols-1 gap-2 text-sm">
                        {customQuestions.map((q) => (
                          <ReviewRow
                            key={q.id}
                            label={q.text}
                            value={customResponses[q.fieldKey] || "Not answered"}
                          />
                        ))}
                      </dl>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── Turnstile CAPTCHA ─────────────────────────────── */}
          {step === TOTAL_STEPS && turnstileSiteKey && (
            <div className="flex justify-center">
              <div id="turnstile-widget" />
            </div>
          )}

          {/* ── Navigation Buttons ───────────────────────────── */}
          <div className="flex gap-3 border-t border-gray-200 pt-6">
            {step > 1 && (
              <button
                type="button"
                onClick={goBack}
                className="flex-1 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
              >
                Previous
              </button>
            )}

            {step < TOTAL_STEPS && (
              <button
                type="button"
                onClick={goNext}
                className="btn-primary flex-1"
              >
                Next
              </button>
            )}

            {step === TOTAL_STEPS && (
              <button
                type="submit"
                disabled={submitting}
                className="btn-primary flex-1"
              >
                {submitting ? (
                  <span className="flex items-center justify-center gap-2">
                    <Spinner />
                    Submitting...
                  </span>
                ) : (
                  "Submit Application"
                )}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── Review Row Component ────────────────────────────────────── */

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-gray-500">{label}</dt>
      <dd className="font-medium text-gray-900 text-right">{value}</dd>
    </div>
  );
}
