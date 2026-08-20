/**
 * Illinois housing law constants and helpers.
 *
 * References:
 *  - Late fees: Cook County RTLO (Residential Tenant Landlord Ordinance)
 *  - Security deposits: 765 ILCS 710, 765 ILCS 715/1
 *  - Notices: 735 ILCS 5/9-207 (30-day), 735 ILCS 5/9-209 (5-day), 735 ILCS 5/9-210 (10-day)
 *  - Electronic payment: IL HB 4206
 */

// ── Grace Period ──

/** Illinois minimum grace period for late fees (days). */
export const IL_GRACE_PERIOD_MIN = 5;

// ── Notice Periods ──

export const NOTICE_PERIODS = {
  five_day: 5,
  ten_day: 10,
  thirty_day: 30,
} as const;

// ── Security Deposit ──

/**
 * Statewide threshold: landlords with 25+ units must pay interest on deposits.
 * 765 ILCS 715
 */
export const IL_DEPOSIT_INTEREST_UNIT_THRESHOLD = 25;

/**
 * Cook County (CRLTO) threshold: landlords with 6+ units in Cook County must
 * pay interest on deposits.
 */
export const COOK_COUNTY_DEPOSIT_INTEREST_UNIT_THRESHOLD = 6;

/** Days within which landlord must provide deposit receipt after receiving deposit. */
export const DEPOSIT_RECEIPT_DEADLINE_DAYS = 10;

/** Days after move-out to send itemized statement of deductions. */
export const DEPOSIT_STATEMENT_DEADLINE_DAYS = 30;

/** Days after move-out to return security deposit. */
export const DEPOSIT_RETURN_DEADLINE_DAYS = 45;

// ── Cook County Late Fee Cap ──

/**
 * Cook County RTLO late fee cap:
 *  - $10 for the first $1,000 of monthly rent
 *  - 5% on rent exceeding $1,000
 *
 * @param monthlyRentCents Monthly rent in cents
 * @returns Maximum late fee in cents
 */
export function getCookCountyLateFeeMax(monthlyRentCents: number): number {
  const baseCap = 1000; // $10.00 in cents
  const thresholdCents = 100_000; // $1,000.00 in cents
  const overageRate = 0.05;

  if (monthlyRentCents <= thresholdCents) {
    return baseCap;
  }

  const overageCents = monthlyRentCents - thresholdCents;
  return baseCap + Math.round(overageCents * overageRate);
}

// ── Cook County Security Deposit Cap ──

/**
 * Cook County RTLO security deposit cap: 1.5x monthly rent.
 *
 * @param monthlyRentCents Monthly rent in cents
 * @returns Maximum security deposit in cents
 */
export function getCookCountyDepositMax(monthlyRentCents: number): number {
  return Math.round(monthlyRentCents * 1.5);
}

// ── Cook County Zip Code Detection ──

/**
 * Complete list of Cook County, Illinois zip codes.
 * Includes City of Chicago and all Cook County suburbs.
 */
const COOK_COUNTY_ZIPS = new Set([
  // City of Chicago
  "60601", "60602", "60603", "60604", "60605", "60606", "60607", "60608",
  "60609", "60610", "60611", "60612", "60613", "60614", "60615", "60616",
  "60617", "60618", "60619", "60620", "60621", "60622", "60623", "60624",
  "60625", "60626", "60628", "60629", "60630", "60631", "60632", "60633",
  "60634", "60636", "60637", "60638", "60639", "60640", "60641", "60642",
  "60643", "60644", "60645", "60646", "60647", "60649", "60651", "60652",
  "60653", "60654", "60655", "60656", "60657", "60659", "60660", "60661",
  "60664", "60666", "60668", "60669", "60670", "60673", "60674", "60675",
  "60677", "60678", "60680", "60681", "60682", "60684", "60685", "60686",
  "60687", "60688", "60689", "60690", "60691", "60693", "60694", "60695",
  "60696", "60697", "60699",

  // Cook County suburbs
  "60018", "60019", "60029", "60043", "60053", "60056", "60062", "60065",
  "60067", "60068", "60070", "60074", "60076", "60077", "60078", "60082",
  "60090", "60091", "60093", "60104", "60107", "60130", "60131", "60141",
  "60153", "60154", "60155", "60160", "60161", "60162", "60163", "60164",
  "60165", "60168", "60171", "60176", "60193", "60301", "60302", "60303",
  "60304", "60305", "60402", "60406", "60409", "60411", "60415", "60419",
  "60422", "60425", "60426", "60428", "60429", "60430", "60438", "60443",
  "60445", "60452", "60453", "60454", "60455", "60456", "60457", "60458",
  "60459", "60461", "60462", "60463", "60464", "60465", "60466", "60467",
  "60469", "60471", "60472", "60473", "60475", "60476", "60477", "60478",
  "60480", "60482", "60501", "60513", "60521", "60525", "60526", "60534",
  "60546", "60558", "60706", "60707", "60712", "60714", "60803", "60804",
  "60805", "60827",
]);

/**
 * Check if a zip code is in Cook County, Illinois.
 *
 * @param zipCode 5-digit zip code string
 * @returns true if the zip is within Cook County
 */
export function isCookCounty(zipCode: string): boolean {
  // Normalize: take first 5 digits
  const zip5 = zipCode.replace(/\D/g, "").slice(0, 5);
  return COOK_COUNTY_ZIPS.has(zip5);
}

/**
 * Extract zip code from an address string.
 * Looks for a 5-digit (or 5+4) zip code pattern.
 */
export function extractZipCode(address: string): string | null {
  const match = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  return match ? match[1] : null;
}

/**
 * Check if an address is in Cook County based on its zip code.
 *
 * @param address Full address string
 * @returns true if Cook County, false if not, null if zip not found
 */
export function isAddressInCookCounty(address: string): boolean | null {
  const zip = extractZipCode(address);
  if (!zip) return null;
  return isCookCounty(zip);
}

// ── Deposit Interest ──

/**
 * Calculate annual interest on a security deposit.
 *
 * @param depositCents Security deposit amount in cents
 * @param annualRate Annual interest rate (e.g., 0.01 for 1%)
 * @returns Interest amount in cents
 */
export function calculateDepositInterest(
  depositCents: number,
  annualRate: number
): number {
  return Math.round(depositCents * annualRate);
}

/**
 * Determine if a landlord must pay deposit interest.
 *
 * @param totalUnits Total units across all properties
 * @param cookCountyUnits Units in Cook County properties
 * @returns true if deposit interest is required
 */
export function mustPayDepositInterest(
  totalUnits: number,
  cookCountyUnits: number
): boolean {
  // Cook County: 6+ units triggers interest requirement
  if (cookCountyUnits >= COOK_COUNTY_DEPOSIT_INTEREST_UNIT_THRESHOLD) {
    return true;
  }
  // Statewide: 25+ units triggers interest requirement
  if (totalUnits >= IL_DEPOSIT_INTEREST_UNIT_THRESHOLD) {
    return true;
  }
  return false;
}
