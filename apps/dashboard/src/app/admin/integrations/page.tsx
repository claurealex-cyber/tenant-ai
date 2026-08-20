"use client";

import { useState, useEffect, useCallback } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface FieldStatus {
  key: string;
  label: string;
  sensitive: boolean;
  required: boolean;
  placeholder: string | null;
  helpText: string | null;
  hasValue: boolean;
  source: "database" | "environment" | "none";
  updatedAt: string | null;
}

interface IntegrationStatus {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  testEndpoint: string | null;
  fields: FieldStatus[];
}

function StatusDot({ fields }: { fields: FieldStatus[] }) {
  const requiredFields = fields.filter((f) => f.required);
  const configuredRequired = requiredFields.filter((f) => f.hasValue);

  let color = "bg-gray-300";
  let label = "Not configured";

  if (configuredRequired.length === requiredFields.length && requiredFields.length > 0) {
    color = "bg-green-500";
    label = "Configured";
  } else if (configuredRequired.length > 0) {
    color = "bg-yellow-500";
    label = "Partially configured";
  } else if (requiredFields.length === 0) {
    // No required fields — show configured if any optional field is set
    const anyConfigured = fields.some((f) => f.hasValue);
    if (anyConfigured) {
      color = "bg-green-500";
      label = "Configured";
    }
  }

  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${color}`} />
      <span className="text-xs text-gray-500">{label}</span>
    </span>
  );
}

function CategoryIcon({ icon }: { icon: string }) {
  const colors: Record<string, string> = {
    phone: "bg-purple-100 text-purple-600",
    cpu: "bg-blue-100 text-blue-600",
    "credit-card": "bg-green-100 text-green-600",
    mail: "bg-orange-100 text-orange-600",
    cloud: "bg-cyan-100 text-cyan-600",
    bank: "bg-amber-100 text-amber-600",
    "shield-check": "bg-indigo-100 text-indigo-600",
  };

  const labels: Record<string, string> = {
    phone: "TEL",
    cpu: "AI",
    "credit-card": "PAY",
    mail: "MAIL",
    cloud: "S3",
    bank: "ACH",
    "shield-check": "VAL",
  };

  return (
    <div
      className={`flex h-10 w-10 items-center justify-center rounded-lg text-xs font-bold ${colors[icon] || "bg-gray-100 text-gray-600"}`}
    >
      {labels[icon] || "?"}
    </div>
  );
}

function IntegrationCard({
  integration,
  onSaved,
}: {
  integration: IntegrationStatus;
  onSaved: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    connected: boolean;
    message: string;
  } | null>(null);
  const [saveMessage, setSaveMessage] = useState("");
  const [showPassword, setShowPassword] = useState<Record<string, boolean>>({});

  function handleFieldChange(key: string, value: string) {
    setFieldValues((prev) => ({ ...prev, [key]: value }));
  }

  function handleClearField(key: string) {
    setFieldValues((prev) => ({ ...prev, [key]: "" }));
  }

  async function handleSave() {
    setSaving(true);
    setSaveMessage("");
    try {
      const values: Record<string, string | null> = {};
      for (const [key, val] of Object.entries(fieldValues)) {
        if (val === "") {
          values[key] = null; // Clear
        } else {
          values[key] = val;
        }
      }

      const res = await fetch("/api/admin/integrations", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          integrationId: integration.id,
          values,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setSaveMessage(`Saved ${data.fieldsUpdated} field(s) successfully`);
        setFieldValues({});
        onSaved();
      } else {
        const data = await res.json();
        setSaveMessage(data.error || "Failed to save");
      }
    } catch {
      setSaveMessage("Failed to save");
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    if (!integration.testEndpoint) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(integration.testEndpoint, { method: "POST" });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ connected: false, message: "Test request failed" });
    } finally {
      setTesting(false);
    }
  }

  const hasChanges = Object.keys(fieldValues).length > 0;

  return (
    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <button
        className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-gray-50"
        onClick={() => setExpanded(!expanded)}
      >
        <CategoryIcon icon={integration.icon} />
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-semibold text-gray-900">
              {integration.name}
            </h3>
            <StatusDot fields={integration.fields} />
          </div>
          <p className="mt-0.5 text-xs text-gray-500">
            {integration.description}
          </p>
        </div>
        <svg
          className={`h-5 w-5 text-gray-400 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="border-t border-gray-200 px-6 py-4">
          <div className="space-y-4">
            {integration.fields.map((field) => (
              <div key={field.key}>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-gray-700">
                    {field.label}
                    {field.required && (
                      <span className="ml-1 text-red-500">*</span>
                    )}
                  </label>
                  {field.hasValue && (
                    <span
                      className={`text-xs ${field.source === "database" ? "text-blue-500" : "text-gray-400"}`}
                    >
                      from {field.source}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex gap-2">
                  <div className="relative flex-1">
                    <input
                      type={
                        field.sensitive && !showPassword[field.key]
                          ? "password"
                          : "text"
                      }
                      value={
                        fieldValues[field.key] !== undefined
                          ? fieldValues[field.key]
                          : ""
                      }
                      onChange={(e) =>
                        handleFieldChange(field.key, e.target.value)
                      }
                      placeholder={
                        field.hasValue
                          ? "********** (unchanged)"
                          : field.placeholder || ""
                      }
                      className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    />
                    {field.sensitive && (
                      <button
                        type="button"
                        className="absolute inset-y-0 right-0 flex items-center pr-3 text-gray-400 hover:text-gray-600"
                        onClick={() =>
                          setShowPassword((prev) => ({
                            ...prev,
                            [field.key]: !prev[field.key],
                          }))
                        }
                      >
                        <svg
                          className="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      </button>
                    )}
                  </div>
                  {field.source === "database" && (
                    <button
                      type="button"
                      className="rounded-md border border-gray-300 px-3 py-2 text-xs text-gray-600 hover:bg-gray-50"
                      onClick={() => handleClearField(field.key)}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {field.helpText && (
                  <p className="mt-1 text-xs text-gray-400">
                    {field.helpText}
                  </p>
                )}
              </div>
            ))}
          </div>

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !hasChanges}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>

            {integration.testEndpoint && (
              <button
                onClick={handleTest}
                disabled={testing}
                className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              >
                {testing ? "Testing..." : "Test Connection"}
              </button>
            )}
          </div>

          {/* Feedback */}
          {saveMessage && (
            <p
              className={`mt-3 text-sm ${saveMessage.includes("success") ? "text-green-600" : "text-red-600"}`}
            >
              {saveMessage}
            </p>
          )}

          {testResult && (
            <div
              className={`mt-3 flex items-center gap-2 rounded-md p-3 text-sm ${
                testResult.connected
                  ? "bg-green-50 text-green-700"
                  : "bg-red-50 text-red-700"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${testResult.connected ? "bg-green-500" : "bg-red-500"}`}
              />
              {testResult.message}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdminIntegrationsPage() {
  const [integrations, setIntegrations] = useState<IntegrationStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadIntegrations = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/integrations");
      if (!res.ok) {
        setError("Failed to load integrations");
        setLoading(false);
        return;
      }
      const data = await res.json();
      setIntegrations(data.integrations || []);
    } catch {
      setError("Failed to load integrations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadIntegrations();
  }, [loadIntegrations]);

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Integrations</h1>
          <p className="mt-1 text-sm text-gray-500">
            Configure external service API keys and test connections.
          </p>
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
              <p className="mt-3 text-sm text-gray-500">
                Loading integrations...
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {integrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
                onSaved={loadIntegrations}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
