"use client";

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import DashboardShell from "@/components/layout/DashboardShell";

interface StripeStatus {
  connected: boolean;
  accountId: string | null;
  onboardingComplete: boolean;
}

export default function SettingsPage() {
  const { data: session, update } = useSession();

  // Profile state
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phone, setPhone] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");

  // Change password state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState("");
  const [passwordError, setPasswordError] = useState("");

  // Stripe state
  const [stripeStatus, setStripeStatus] = useState<StripeStatus | null>(null);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [stripeError, setStripeError] = useState("");
  const [stripeConnecting, setStripeConnecting] = useState(false);

  // Pre-fill profile from session
  useEffect(() => {
    if (session?.user) {
      setName(session.user.name || "");
      setEmail(session.user.email || "");
    }
  }, [session]);

  // Fetch Stripe Connect status
  useEffect(() => {
    async function fetchStripeStatus() {
      setStripeLoading(true);
      setStripeError("");
      try {
        const res = await fetch("/api/stripe/connect");
        if (!res.ok) {
          setStripeError("Failed to load payment connection status.");
          return;
        }
        const data = await res.json();
        setStripeStatus(data);
      } catch {
        setStripeError("Failed to load payment connection status.");
      } finally {
        setStripeLoading(false);
      }
    }
    fetchStripeStatus();
  }, []);

  async function handleSaveProfile() {
    setProfileSaving(true);
    setProfileMessage("");
    setProfileError("");

    try {
      const res = await fetch("/api/auth/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, companyName, phone }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setProfileError(
          data.error ||
            "Unable to save profile. A profile update endpoint may not be available yet."
        );
        return;
      }

      setProfileMessage("Profile saved successfully.");
      await update();
    } catch {
      setProfileError(
        "Unable to save profile. A profile update endpoint may not be available yet."
      );
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword() {
    setPasswordSaving(true);
    setPasswordMessage("");
    setPasswordError("");

    if (newPassword !== confirmNewPassword) {
      setPasswordError("New passwords do not match.");
      setPasswordSaving(false);
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError("New password must be at least 8 characters.");
      setPasswordSaving(false);
      return;
    }

    try {
      const res = await fetch("/api/auth/change-password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          currentPassword,
          newPassword,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setPasswordError(data.error || "Failed to change password.");
        return;
      }

      setPasswordMessage("Password changed successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch {
      setPasswordError("Failed to change password.");
    } finally {
      setPasswordSaving(false);
    }
  }

  async function handleConnectStripe() {
    setStripeConnecting(true);
    setStripeError("");

    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: window.location.origin,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStripeError(data.error || "Failed to initiate Stripe connection.");
        return;
      }

      const data = await res.json();
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      } else {
        setStripeError("No onboarding URL returned.");
      }
    } catch {
      setStripeError("Failed to initiate Stripe connection.");
    } finally {
      setStripeConnecting(false);
    }
  }

  async function handleCompleteStripeSetup() {
    setStripeConnecting(true);
    setStripeError("");

    try {
      const res = await fetch("/api/stripe/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseUrl: window.location.origin,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setStripeError(data.error || "Failed to get setup link.");
        return;
      }

      const data = await res.json();
      if (data.onboardingUrl) {
        window.location.href = data.onboardingUrl;
      } else {
        setStripeError("No onboarding URL returned.");
      }
    } catch {
      setStripeError("Failed to get setup link.");
    } finally {
      setStripeConnecting(false);
    }
  }

  function truncateAccountId(accountId: string): string {
    if (accountId.length <= 12) return accountId;
    return `${accountId.slice(0, 8)}...${accountId.slice(-4)}`;
  }

  return (
    <DashboardShell>
      <div className="px-6 py-8 lg:px-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage your profile and payment settings.
          </p>
        </div>

        <div className="space-y-8">
          {/* Section 1: Profile */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Profile</h2>
              <p className="mt-1 text-sm text-gray-500">
                Your personal and company information.
              </p>
            </div>
            <div className="px-6 py-6">
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
                {/* Name */}
                <div>
                  <label
                    htmlFor="profile-name"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Name
                  </label>
                  <input
                    id="profile-name"
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Your name"
                  />
                </div>

                {/* Email (read-only) */}
                <div>
                  <label
                    htmlFor="profile-email"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Email
                  </label>
                  <input
                    id="profile-email"
                    type="email"
                    value={email}
                    disabled
                    className="mt-1 block w-full rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-500 shadow-sm cursor-not-allowed"
                  />
                  <p className="mt-1 text-xs text-gray-400">
                    Email cannot be changed.
                  </p>
                </div>

                {/* Company Name */}
                <div>
                  <label
                    htmlFor="profile-company"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Company Name
                  </label>
                  <input
                    id="profile-company"
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="Your company name"
                  />
                </div>

                {/* Phone */}
                <div>
                  <label
                    htmlFor="profile-phone"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Phone
                  </label>
                  <input
                    id="profile-phone"
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                    placeholder="(312) 123-4567"
                  />
                </div>
              </div>

              {/* Profile messages */}
              {profileMessage && (
                <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                  {profileMessage}
                </div>
              )}
              {profileError && (
                <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {profileError}
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={handleSaveProfile}
                  disabled={profileSaving}
                  className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {profileSaving ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Saving...
                    </>
                  ) : (
                    "Save Profile"
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Section 2: Change Password */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">Change Password</h2>
              <p className="mt-1 text-sm text-gray-500">
                Update your account password.
              </p>
            </div>
            <div className="px-6 py-6">
              <div className="max-w-md space-y-4">
                <div>
                  <label
                    htmlFor="current-password"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Current Password
                  </label>
                  <input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="new-password"
                    className="block text-sm font-medium text-gray-700"
                  >
                    New Password
                  </label>
                  <input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label
                    htmlFor="confirm-new-password"
                    className="block text-sm font-medium text-gray-700"
                  >
                    Confirm New Password
                  </label>
                  <input
                    id="confirm-new-password"
                    type="password"
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    className="mt-1 block w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                  />
                </div>
              </div>

              {passwordMessage && (
                <div className="mt-4 rounded-md bg-green-50 p-3 text-sm text-green-700">
                  {passwordMessage}
                </div>
              )}
              {passwordError && (
                <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {passwordError}
                </div>
              )}

              <div className="mt-6">
                <button
                  onClick={handleChangePassword}
                  disabled={passwordSaving || !currentPassword || !newPassword || !confirmNewPassword}
                  className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {passwordSaving ? (
                    <>
                      <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Changing...
                    </>
                  ) : (
                    "Change Password"
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Section 3: Stripe Connect */}
          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-200 px-6 py-4">
              <h2 className="text-lg font-semibold text-gray-900">
                Stripe Connect (Payments)
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Manage your payment processing connection.
              </p>
            </div>
            <div className="px-6 py-6">
              {stripeLoading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-blue-600 border-t-transparent" />
                    <p className="mt-3 text-sm text-gray-500">
                      Checking payment connection...
                    </p>
                  </div>
                </div>
              ) : stripeStatus && !stripeStatus.connected ? (
                /* Not Connected */
                <div>
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gray-100">
                      <svg
                        className="h-5 w-5 text-gray-400"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={1.5}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M2.25 8.25h19.5M2.25 9h19.5m-16.5 5.25h6m-6 2.25h3m-3.75 3h15a2.25 2.25 0 002.25-2.25V6.75A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25v10.5A2.25 2.25 0 004.5 19.5z"
                        />
                      </svg>
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-gray-900">
                        No payment account connected
                      </h3>
                      <p className="mt-1 text-sm text-gray-500">
                        Connect your Stripe account to receive rent payments
                        from tenants. Stripe handles all payment processing
                        securely.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6">
                    <button
                      onClick={handleConnectStripe}
                      disabled={stripeConnecting}
                      className="inline-flex items-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {stripeConnecting ? (
                        <>
                          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Connecting...
                        </>
                      ) : (
                        <>
                          <svg
                            className="mr-2 h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"
                            />
                          </svg>
                          Connect with Stripe
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : stripeStatus && stripeStatus.connected ? (
                /* Connected */
                <div>
                  <div className="flex items-start gap-4">
                    <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100">
                      <svg
                        className="h-5 w-5 text-green-600"
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
                    </div>
                    <div>
                      <h3 className="text-sm font-medium text-green-800">
                        Payments Connected
                      </h3>
                      {stripeStatus.accountId && (
                        <p className="mt-1 text-sm text-gray-500">
                          Account ID:{" "}
                          <span className="font-mono text-xs text-gray-600">
                            {truncateAccountId(stripeStatus.accountId)}
                          </span>
                        </p>
                      )}
                      {stripeStatus.onboardingComplete ? (
                        <p className="mt-2 text-sm text-green-600">
                          Your Stripe account is fully set up and ready to
                          receive payments.
                        </p>
                      ) : (
                        <div className="mt-2">
                          <p className="text-sm text-yellow-700">
                            Stripe onboarding is incomplete. Please complete the
                            setup to start receiving payments.
                          </p>
                          <button
                            onClick={handleCompleteStripeSetup}
                            disabled={stripeConnecting}
                            className="mt-3 inline-flex items-center rounded-md bg-yellow-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {stripeConnecting ? (
                              <>
                                <div className="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                Loading...
                              </>
                            ) : (
                              "Complete Setup"
                            )}
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : null}

              {stripeError && (
                <div className="mt-4 rounded-md bg-red-50 p-3 text-sm text-red-700">
                  {stripeError}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </DashboardShell>
  );
}
