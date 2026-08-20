"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";

type Step = 1 | 2 | 3;

interface PhoneOption {
  phoneNumber: string;
  friendlyName: string;
  locality: string;
  region: string;
}

interface Question {
  id: string;
  text: string;
  fieldKey: string;
  type: string;
  required: boolean;
  sortOrder: number;
  isStandard: boolean;
}

export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [propertyId, setPropertyId] = useState("");

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-2xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Set Up Your First Property
            </h1>
            <p className="mt-1 text-sm text-gray-500">
              Complete these 3 steps to get your AI ready to take calls.
            </p>
          </div>
          <button
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Sign out
          </button>
        </div>

        {/* Stepper */}
        <div className="mb-8 flex items-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-medium ${
                  s < step
                    ? "bg-green-500 text-white"
                    : s === step
                    ? "bg-blue-600 text-white"
                    : "bg-gray-200 text-gray-500"
                }`}
              >
                {s < step ? (
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                ) : (
                  s
                )}
              </div>
              <span
                className={`text-sm ${
                  s === step ? "font-medium text-gray-900" : "text-gray-500"
                }`}
              >
                {s === 1 ? "Property" : s === 2 ? "Phone Number" : "Questions"}
              </span>
              {s < 3 && (
                <div className={`mx-2 h-px w-8 ${s < step ? "bg-green-400" : "bg-gray-200"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Steps */}
        {step === 1 && (
          <Step1Property
            onComplete={(id) => {
              setPropertyId(id);
              setStep(2);
            }}
          />
        )}
        {step === 2 && (
          <Step2Phone
            propertyId={propertyId}
            onComplete={() => setStep(3)}
            onSkip={() => setStep(3)}
          />
        )}
        {step === 3 && (
          <Step3Questions
            propertyId={propertyId}
            onComplete={async () => {
              await fetch("/api/onboarding/complete", { method: "POST" });
              // Force page reload so middleware picks up onboarded=true
              window.location.href = "/";
            }}
          />
        )}
      </div>
    </div>
  );
}

// ── Step 1: Add Property ──

function Step1Property({
  onComplete,
}: {
  onComplete: (propertyId: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [unitCount, setUnitCount] = useState("");
  const [description, setDescription] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");

    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        address,
        unitCount: unitCount ? parseInt(unitCount, 10) : null,
        description: description || null,
      }),
    });

    const data = await res.json();

    if (res.ok) {
      onComplete(data.property.id);
    } else {
      setError(data.error || "Failed to create property");
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-4 text-lg font-semibold text-gray-900">
        Add Your First Property
      </h2>

      {error && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700">
            Property Name *
          </label>
          <input
            id="name"
            type="text"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Sunset Apartments"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="address" className="block text-sm font-medium text-gray-700">
            Address *
          </label>
          <input
            id="address"
            type="text"
            required
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="123 Main St, Chicago IL 60601"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="unitCount" className="block text-sm font-medium text-gray-700">
            Number of Units
          </label>
          <input
            id="unitCount"
            type="number"
            min="1"
            value={unitCount}
            onChange={(e) => setUnitCount(e.target.value)}
            placeholder="12"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div>
          <label htmlFor="description" className="block text-sm font-medium text-gray-700">
            Description
          </label>
          <textarea
            id="description"
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell tenants about this property..."
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? "Creating..." : "Next"}
          </button>
        </div>
      </form>
    </div>
  );
}

// ── Step 2: Phone Number ──

function Step2Phone({
  propertyId,
  onComplete,
  onSkip,
}: {
  propertyId: string;
  onComplete: () => void;
  onSkip: () => void;
}) {
  const [areaCode, setAreaCode] = useState("312");
  const [numbers, setNumbers] = useState<PhoneOption[]>([]);
  const [searching, setSearching] = useState(false);
  const [provisioning, setProvisioning] = useState(false);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  async function searchNumbers() {
    setSearching(true);
    setError("");
    setNumbers([]);
    setSelected("");

    const res = await fetch(
      `/api/twilio/available-numbers?areaCode=${areaCode}`
    );
    const data = await res.json();

    if (res.ok) {
      setNumbers(data.numbers || []);
      if (data.numbers?.length === 0) {
        setError("No numbers found for this area code. Try a different one.");
      }
    } else {
      setError(data.error || "Failed to search numbers");
    }

    setSearched(true);
    setSearching(false);
  }

  async function provisionNumber() {
    if (!selected) return;
    setProvisioning(true);
    setError("");

    const res = await fetch(`/api/properties/${propertyId}/phone`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phoneNumber: selected,
        phoneSid: `PN_${Date.now()}`, // Real Twilio would return a SID
      }),
    });

    const data = await res.json();

    if (res.ok) {
      onComplete();
    } else {
      setError(data.error || "Failed to provision number");
      setProvisioning(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold text-gray-900">
        Provision a Phone Number
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        Your AI assistant will answer calls and texts at this number.
      </p>

      {error && (
        <div className="mb-4 rounded bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Area code search */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700">
            Area Code
          </label>
          <input
            type="text"
            maxLength={3}
            value={areaCode}
            onChange={(e) => setAreaCode(e.target.value.replace(/\D/g, ""))}
            placeholder="312"
            className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            onClick={searchNumbers}
            disabled={searching || areaCode.length < 3}
            className="rounded-md bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50"
          >
            {searching ? "Searching..." : "Search"}
          </button>
        </div>
      </div>

      {/* Number list */}
      {numbers.length > 0 && (
        <div className="mt-4 space-y-2">
          {numbers.map((num) => (
            <button
              key={num.phoneNumber}
              onClick={() => setSelected(num.phoneNumber)}
              className={`flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left transition ${
                selected === num.phoneNumber
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
              }`}
            >
              <div
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 ${
                  selected === num.phoneNumber
                    ? "border-blue-500"
                    : "border-gray-300"
                }`}
              >
                {selected === num.phoneNumber && (
                  <div className="h-2.5 w-2.5 rounded-full bg-blue-500" />
                )}
              </div>
              <div>
                <p className="font-mono text-sm font-medium text-gray-900">
                  {num.friendlyName}
                </p>
                {num.locality && (
                  <p className="text-xs text-gray-500">
                    {num.locality}, {num.region}
                  </p>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 flex items-center justify-between">
        <button
          onClick={onSkip}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Skip for now
        </button>
        {selected ? (
          <button
            onClick={provisionNumber}
            disabled={provisioning}
            className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {provisioning ? "Provisioning..." : "Provision This Number"}
          </button>
        ) : searched ? (
          <span className="text-sm text-gray-400">Select a number above</span>
        ) : null}
      </div>
    </div>
  );
}

// ── Step 3: Questions ──

function Step3Questions({
  propertyId,
  onComplete,
}: {
  propertyId: string;
  onComplete: () => void;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [seeded, setSeeded] = useState(false);

  // Seed standard questions on mount if none exist
  useEffect(() => {
    (async () => {
      const res = await fetch(`/api/properties/${propertyId}/questions`);
      const data = await res.json();

      if (data.questions?.length > 0) {
        setQuestions(data.questions);
        setSeeded(true);
        setLoading(false);
        return;
      }

      // Seed standard questions
      const standardQuestions = [
        { text: "What is your full name?", fieldKey: "fullName", type: "text", required: true, isStandard: true },
        { text: "What is your date of birth?", fieldKey: "dateOfBirth", type: "date", required: true, isStandard: true },
        { text: "What is your Social Security Number?", fieldKey: "ssn", type: "text", required: true, isStandard: true },
        { text: "What is your email address?", fieldKey: "email", type: "text", required: true, isStandard: true },
        { text: "What is your current address?", fieldKey: "currentAddress", type: "text", required: true, isStandard: true },
        { text: "What is your monthly income?", fieldKey: "monthlyIncome", type: "number", required: true, isStandard: true },
        { text: "Who is your current employer?", fieldKey: "employer", type: "text", required: true, isStandard: true },
        { text: "What is your employer's phone number?", fieldKey: "employerPhone", type: "text", required: false, isStandard: true },
        { text: "When would you like to move in?", fieldKey: "moveInDate", type: "date", required: true, isStandard: true },
        { text: "Do you have any pets?", fieldKey: "hasPets", type: "yes_no", required: false, isStandard: true },
        { text: "Do you have any vehicles? If so, please describe them.", fieldKey: "vehicles", type: "text", required: false, isStandard: true },
      ];

      const created: Question[] = [];
      for (const q of standardQuestions) {
        const r = await fetch(`/api/properties/${propertyId}/questions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(q),
        });
        if (r.ok) {
          const d = await r.json();
          created.push(d.question);
        }
      }

      setQuestions(created);
      setSeeded(true);
      setLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleRequired(q: Question) {
    const res = await fetch(
      `/api/properties/${propertyId}/questions/${q.id}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ required: !q.required }),
      }
    );

    if (res.ok) {
      setQuestions((prev) =>
        prev.map((qq) =>
          qq.id === q.id ? { ...qq, required: !qq.required } : qq
        )
      );
    }
  }

  async function deleteQuestion(id: string) {
    const res = await fetch(
      `/api/properties/${propertyId}/questions/${id}`,
      { method: "DELETE" }
    );

    if (res.ok) {
      setQuestions((prev) => prev.filter((q) => q.id !== id));
    } else {
      const data = await res.json();
      alert(data.error || "Cannot delete this question");
    }
  }

  async function addQuestion(text: string, type: string, required: boolean) {
    const res = await fetch(`/api/properties/${propertyId}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, type, required }),
    });

    if (res.ok) {
      const data = await res.json();
      setQuestions((prev) => [...prev, data.question]);
      setShowAdd(false);
    }
  }

  if (loading && !seeded) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
        <p className="text-center text-gray-500">Setting up questions...</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-lg font-semibold text-gray-900">
        Customize Questions
      </h2>
      <p className="mb-4 text-sm text-gray-500">
        These questions will be asked during the application process. You can
        toggle required, edit, or add custom questions.
      </p>

      {/* Question list */}
      <div className="space-y-2">
        {questions.map((q, i) => (
          <div
            key={q.id}
            className="flex items-center gap-3 rounded border border-gray-100 bg-gray-50 px-4 py-3"
          >
            <span className="w-6 text-center text-sm text-gray-400">
              {i + 1}
            </span>
            <div className="flex-1">
              <p className="text-sm text-gray-800">{q.text}</p>
            </div>
            <span className="rounded bg-white px-2 py-0.5 text-xs text-gray-500 border border-gray-200">
              {q.type}
            </span>
            <button
              onClick={() => toggleRequired(q)}
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                q.required
                  ? "bg-red-50 text-red-600"
                  : "bg-gray-100 text-gray-400"
              }`}
            >
              {q.required ? "Required" : "Optional"}
            </button>
            {!q.isStandard && (
              <button
                onClick={() => deleteQuestion(q.id)}
                className="text-xs text-red-400 hover:text-red-600"
              >
                Remove
              </button>
            )}
          </div>
        ))}
      </div>

      {/* Add custom question */}
      {showAdd ? (
        <AddQuestionInline
          onAdd={addQuestion}
          onCancel={() => setShowAdd(false)}
        />
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          + Add Custom Question
        </button>
      )}

      {/* Complete */}
      <div className="mt-6 flex justify-end">
        <button
          onClick={onComplete}
          disabled={saving}
          className="rounded-md bg-blue-600 px-6 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Finishing..." : "Finish Setup"}
        </button>
      </div>
    </div>
  );
}

function AddQuestionInline({
  onAdd,
  onCancel,
}: {
  onAdd: (text: string, type: string, required: boolean) => void;
  onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [type, setType] = useState("text");
  const [required, setRequired] = useState(true);

  return (
    <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-4">
      <div className="space-y-3">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Enter your question..."
          className="block w-full rounded border border-gray-300 px-3 py-2 text-sm"
          autoFocus
        />
        <div className="flex items-center gap-4">
          <select
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1.5 text-sm"
          >
            <option value="text">Text</option>
            <option value="yes_no">Yes/No</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </select>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="checkbox"
              checked={required}
              onChange={(e) => setRequired(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Required
          </label>
          <div className="flex-1" />
          <button
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100"
          >
            Cancel
          </button>
          <button
            onClick={() => text.trim() && onAdd(text, type, required)}
            disabled={!text.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
