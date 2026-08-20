"use client";

import { useState, useEffect } from "react";
import DashboardShell from "@/components/layout/DashboardShell";

interface WebsiteConfig {
  id: string;
  subdomain: string | null;
  companyName: string;
  primaryColor: string;
  logoUrl: string | null;
  heroImageUrl: string | null;
  aboutText: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
}

export default function WebsitePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [configExists, setConfigExists] = useState(false);

  // Form fields
  const [form, setForm] = useState({
    subdomain: "",
    companyName: "",
    primaryColor: "#2563eb",
    logoUrl: "",
    heroImageUrl: "",
    aboutText: "",
    contactEmail: "",
    contactPhone: "",
  });
  const updateField = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  // Fetch existing config on mount
  useEffect(() => {
    async function fetchConfig() {
      setLoading(true);
      setError("");
      try {
        const res = await fetch("/api/website-config");
        if (!res.ok) {
          setError("Failed to load website configuration.");
          return;
        }
        const data = await res.json();
        if (data.config) {
          const c: WebsiteConfig = data.config;
          setConfigExists(true);
          setForm({
            subdomain: c.subdomain || "",
            companyName: c.companyName || "",
            primaryColor: c.primaryColor || "#2563eb",
            logoUrl: c.logoUrl || "",
            heroImageUrl: c.heroImageUrl || "",
            aboutText: c.aboutText || "",
            contactEmail: c.contactEmail || "",
            contactPhone: c.contactPhone || "",
          });
        }
      } catch {
        setError("Failed to load website configuration.");
      } finally {
        setLoading(false);
      }
    }
    fetchConfig();
  }, []);

  async function handleSave() {
    setSaving(true);
    setError("");
    setSuccessMessage("");

    if (!form.companyName.trim()) {
      setError("Company name is required.");
      setSaving(false);
      return;
    }

    const payload = {
      subdomain: form.subdomain.trim() || null,
      companyName: form.companyName.trim(),
      primaryColor: form.primaryColor,
      logoUrl: form.logoUrl.trim() || null,
      heroImageUrl: form.heroImageUrl.trim() || null,
      aboutText: form.aboutText.trim() || null,
      contactEmail: form.contactEmail.trim() || null,
      contactPhone: form.contactPhone.trim() || null,
    };

    try {
      const method = configExists ? "PUT" : "POST";
      const res = await fetch("/api/website-config", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || "Failed to save website configuration.");
        return;
      }

      const data = await res.json();
      if (data.config) {
        setConfigExists(true);
        setForm({
          subdomain: data.config.subdomain || "",
          companyName: data.config.companyName || "",
          primaryColor: data.config.primaryColor || "#2563eb",
          logoUrl: data.config.logoUrl || "",
          heroImageUrl: data.config.heroImageUrl || "",
          aboutText: data.config.aboutText || "",
          contactEmail: data.config.contactEmail || "",
          contactPhone: data.config.contactPhone || "",
        });
      }

      setSuccessMessage("Website configuration saved successfully.");

      // Auto-dismiss success message after 4 seconds
      setTimeout(() => setSuccessMessage(""), 4000);
    } catch {
      setError("Failed to save website configuration.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">
            Website Configuration
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Customize your tenant-facing website appearance and information.
          </p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-center">
              <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
              <p className="mt-3 text-sm text-gray-500">
                Loading configuration...
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Toast messages */}
            {successMessage && (
              <div className="rounded-md bg-green-50 border border-green-200 p-4 text-sm text-green-700">
                <div className="flex items-center gap-2">
                  <svg
                    className="h-4 w-4 text-green-500 flex-shrink-0"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4.5 12.75l6 6 9-13.5"
                    />
                  </svg>
                  {successMessage}
                </div>
              </div>
            )}
            {error && (
              <div className="rounded-md bg-red-50 border border-red-200 p-4 text-sm text-red-700">
                {error}
              </div>
            )}

            {/* Preview Link */}
            {form.subdomain && (
              <div className="rounded-md bg-blue-50 border border-blue-200 px-4 py-3">
                <p className="text-sm text-blue-800">
                  Preview your website at{" "}
                  <a
                    href={`https://${form.subdomain}.tenantai.com`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium underline hover:text-blue-900"
                  >
                    {form.subdomain}.tenantai.com
                  </a>
                </p>
              </div>
            )}

            {/* Form */}
            <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
              <div className="border-b border-gray-200 px-6 py-4">
                <h2 className="text-lg font-semibold text-gray-900">
                  Website Details
                </h2>
              </div>
              <div className="px-6 py-6">
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                  {/* Subdomain */}
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="ws-subdomain"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Subdomain
                    </label>
                    <div className="mt-1 flex rounded-md shadow-sm">
                      <input
                        id="ws-subdomain"
                        type="text"
                        value={form.subdomain}
                        onChange={(e) =>
                          updateField(
                            "subdomain",
                            e.target.value
                              .toLowerCase()
                              .replace(/[^a-z0-9-]/g, "")
                          )
                        }
                        className="block w-full rounded-l-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                        placeholder="your-company"
                      />
                      <span className="inline-flex items-center rounded-r-md border border-l-0 border-gray-300 bg-gray-50 px-3 text-sm text-gray-500">
                        .tenantai.com
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {form.subdomain
                        ? `Your website will be available at ${form.subdomain}.tenantai.com`
                        : "Choose a subdomain for your tenant website."}
                    </p>
                  </div>

                  {/* Company Name */}
                  <div>
                    <label
                      htmlFor="ws-company"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Company Name{" "}
                      <span className="text-red-500">*</span>
                    </label>
                    <input
                      id="ws-company"
                      type="text"
                      value={form.companyName}
                      onChange={(e) => updateField("companyName", e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Acme Properties"
                      required
                    />
                  </div>

                  {/* Primary Color */}
                  <div>
                    <label
                      htmlFor="ws-color"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Primary Color
                    </label>
                    <div className="mt-1 flex items-center gap-3">
                      <input
                        id="ws-color"
                        type="color"
                        value={form.primaryColor}
                        onChange={(e) => updateField("primaryColor", e.target.value)}
                        className="h-10 w-14 cursor-pointer rounded-md border border-gray-300 p-0.5"
                      />
                      <div className="flex items-center gap-2">
                        <div
                          className="h-8 w-8 rounded-md border border-gray-200 shadow-sm"
                          style={{ backgroundColor: form.primaryColor }}
                        />
                        <span className="text-sm font-mono text-gray-500">
                          {form.primaryColor}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Logo URL */}
                  <div>
                    <label
                      htmlFor="ws-logo"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Logo URL
                    </label>
                    <input
                      id="ws-logo"
                      type="text"
                      value={form.logoUrl}
                      onChange={(e) => updateField("logoUrl", e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="https://example.com/logo.png"
                    />
                  </div>

                  {/* Hero Image URL */}
                  <div>
                    <label
                      htmlFor="ws-hero"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Hero Image URL
                    </label>
                    <input
                      id="ws-hero"
                      type="text"
                      value={form.heroImageUrl}
                      onChange={(e) => updateField("heroImageUrl", e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="https://example.com/hero.jpg"
                    />
                  </div>

                  {/* About Text */}
                  <div className="sm:col-span-2">
                    <label
                      htmlFor="ws-about"
                      className="block text-sm font-medium text-gray-700"
                    >
                      About Text
                    </label>
                    <textarea
                      id="ws-about"
                      value={form.aboutText}
                      onChange={(e) => updateField("aboutText", e.target.value)}
                      rows={4}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="Tell prospective tenants about your company and available properties..."
                    />
                  </div>

                  {/* Contact Email */}
                  <div>
                    <label
                      htmlFor="ws-contact-email"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Contact Email
                    </label>
                    <input
                      id="ws-contact-email"
                      type="email"
                      value={form.contactEmail}
                      onChange={(e) => updateField("contactEmail", e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="info@example.com"
                    />
                  </div>

                  {/* Contact Phone */}
                  <div>
                    <label
                      htmlFor="ws-contact-phone"
                      className="block text-sm font-medium text-gray-700"
                    >
                      Contact Phone
                    </label>
                    <input
                      id="ws-contact-phone"
                      type="text"
                      value={form.contactPhone}
                      onChange={(e) => updateField("contactPhone", e.target.value)}
                      className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="(555) 123-4567"
                    />
                  </div>
                </div>

                {/* Live Preview Card */}
                <div className="mt-6">
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Live Preview
                  </label>
                  <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
                    <div
                      className="rounded-lg overflow-hidden shadow-sm"
                      style={{ maxWidth: 360 }}
                    >
                      {/* Preview Header */}
                      <div
                        className="px-4 py-3 flex items-center gap-3"
                        style={{ backgroundColor: form.primaryColor }}
                      >
                        {form.logoUrl ? (
                          <img
                            src={form.logoUrl}
                            alt="Logo preview"
                            className="h-8 w-8 rounded-full object-cover bg-white"
                            onError={(e) => {
                              (e.target as HTMLImageElement).style.display = "none";
                            }}
                          />
                        ) : (
                          <div className="h-8 w-8 rounded-full bg-white/30 flex items-center justify-center">
                            <span className="text-white text-xs font-bold">
                              {form.companyName ? form.companyName.charAt(0).toUpperCase() : "?"}
                            </span>
                          </div>
                        )}
                        <span className="text-white font-semibold text-sm truncate">
                          {form.companyName || "Company Name"}
                        </span>
                      </div>
                      {/* Preview Body */}
                      <div className="bg-white px-4 py-4">
                        <div className="h-2 w-3/4 rounded bg-gray-200 mb-2" />
                        <div className="h-2 w-1/2 rounded bg-gray-200 mb-3" />
                        <div
                          className="inline-block rounded-md px-3 py-1 text-xs font-medium text-white"
                          style={{ backgroundColor: form.primaryColor }}
                        >
                          Apply Now
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Save button */}
                <div className="mt-8 flex items-center justify-between border-t border-gray-200 pt-6">
                  <p className="text-xs text-gray-400">
                    {configExists
                      ? "Update your website configuration."
                      : "Save to publish your website for the first time."}
                  </p>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="inline-flex items-center rounded-md bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving ? (
                      <>
                        <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Saving...
                      </>
                    ) : (
                      "Save"
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </DashboardShell>
  );
}
