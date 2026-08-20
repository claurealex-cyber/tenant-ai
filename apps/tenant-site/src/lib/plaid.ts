/**
 * Plaid helpers for bank account linking.
 *
 * Uses resolveConfig() to read Plaid credentials from DB or env vars,
 * following the same pattern as dashboard's stripe-connect.ts.
 */

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";

async function getPlaidClient(): Promise<PlaidApi | null> {
  const { resolveConfig } = await import("@tenant-ai/shared");
  const clientId = await resolveConfig("plaid", "client_id");
  const secret = await resolveConfig("plaid", "secret");
  const env = await resolveConfig("plaid", "env", "sandbox");

  if (!clientId || !secret) return null;

  const plaidEnv =
    env === "production"
      ? PlaidEnvironments.production
      : env === "development"
        ? PlaidEnvironments.development
        : PlaidEnvironments.sandbox;

  const config = new Configuration({
    basePath: plaidEnv,
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });

  return new PlaidApi(config);
}

/**
 * Create a Plaid Link token for the frontend to open the Link widget.
 */
export async function createLinkToken(
  tenantId: string
): Promise<string | null> {
  const client = await getPlaidClient();
  if (!client) return null;

  const response = await client.linkTokenCreate({
    user: { client_user_id: tenantId },
    client_name: "Tenant AI",
    products: [Products.Auth],
    country_codes: [CountryCode.Us],
    language: "en",
  });

  return response.data.link_token;
}

/**
 * Exchange a Plaid public token for an access token.
 */
export async function exchangePublicToken(
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
  const client = await getPlaidClient();
  if (!client) throw new Error("Plaid is not configured");

  const response = await client.itemPublicTokenExchange({
    public_token: publicToken,
  });

  return {
    accessToken: response.data.access_token,
    itemId: response.data.item_id,
  };
}

/**
 * Create a Stripe bank account token via Plaid's processor integration.
 */
export async function createProcessorToken(
  accessToken: string,
  accountId: string
): Promise<string> {
  const client = await getPlaidClient();
  if (!client) throw new Error("Plaid is not configured");

  const response = await client.processorStripeBankAccountTokenCreate({
    access_token: accessToken,
    account_id: accountId,
  });

  return response.data.stripe_bank_account_token;
}

/**
 * Get bank account info (bank name + last 4 digits) for display.
 */
export async function getAccountInfo(
  accessToken: string,
  accountId: string
): Promise<{ bankName: string; last4: string }> {
  const client = await getPlaidClient();
  if (!client) throw new Error("Plaid is not configured");

  const authResponse = await client.authGet({ access_token: accessToken });

  const account = authResponse.data.accounts.find((a) => a.account_id === accountId);
  if (!account) throw new Error("Account not found");

  const last4 = account.mask || account.account_id.slice(-4);

  // Get institution name
  let bankName = "Bank Account";
  const item = authResponse.data.item;
  if (item.institution_id) {
    try {
      const instResponse = await client.institutionsGetById({
        institution_id: item.institution_id,
        country_codes: [CountryCode.Us],
      });
      bankName = instResponse.data.institution.name;
    } catch {
      // Fall back to generic name
    }
  }

  return { bankName, last4 };
}

/**
 * Remove a Plaid item (unlink bank account).
 */
export async function removePlaidItem(accessToken: string): Promise<void> {
  const client = await getPlaidClient();
  if (!client) throw new Error("Plaid is not configured");

  await client.itemRemove({ access_token: accessToken });
}
