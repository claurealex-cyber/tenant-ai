/**
 * Email utilities for dashboard.
 * sendEmail is shared across all packages; app-specific templates live here.
 */

export { sendEmail } from "@tenant-ai/shared";

export function buildPasswordResetEmail(resetUrl: string): string {
  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2>Password Reset Request</h2>
      <p>You requested a password reset. Click the link below to set a new password:</p>
      <p style="margin: 24px 0;">
        <a href="${resetUrl}" style="background: #2563eb; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">
          Reset Password
        </a>
      </p>
      <p style="color: #666; font-size: 14px;">
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email.
      </p>
    </div>
  `;
}
