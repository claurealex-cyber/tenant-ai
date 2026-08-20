import { prisma } from "../lib/prisma.js";
import {
  validateSSN,
  validatePhone,
  validateEmail,
  parseDateOfBirth,
  parseMoveInDate,
  parseIncome,
  encrypt,
  APPLICATION_RESUME_DAYS,
} from "@tenant-ai/shared";
import type { ValidationResult } from "@tenant-ai/shared";
import { validateFieldWithAI } from "../services/ai-field-validator.js";
import { sendNotification } from "../services/notifications.js";

// Standard fields that map to Application model columns
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

// Fields requiring PII encryption before storage
const ENCRYPTED_FIELDS = new Set(["ssn", "dateOfBirth"]);

// Map field keys to their validator
const FIELD_VALIDATORS: Record<
  string,
  (input: string) => ValidationResult
> = {
  ssn: validateSSN,
  email: validateEmail,
  employerPhone: validatePhone,
  dateOfBirth: parseDateOfBirth,
  moveInDate: parseMoveInDate,
  monthlyIncome: parseIncome,
};

/**
 * Validate and save a single application field.
 *
 * Returns { success: true } on success, or { success: false, error: string }
 * on validation failure (which should be relayed to the AI so it re-asks).
 */
export async function saveApplicationField(
  applicationId: string,
  fieldKey: string,
  value: string,
  questionContext?: { questionText: string; questionType: string },
): Promise<{ success: boolean; error?: string }> {
  // Validate the field if a validator exists
  const validator = FIELD_VALIDATORS[fieldKey];
  let processedValue: string = value;

  if (validator) {
    const result = validator(value);
    if (!result.valid) {
      return { success: false, error: result.error };
    }
    processedValue = result.value!;
  }

  // AI semantic validation (when enabled per-property)
  if (questionContext) {
    const aiResult = await validateFieldWithAI({
      fieldKey,
      value: processedValue,
      questionText: questionContext.questionText,
      questionType: questionContext.questionType,
    });
    if (!aiResult.valid) {
      return { success: false, error: aiResult.reason || "Could you provide more detail?" };
    }
  }

  // Handle the hasPets boolean conversion
  if (fieldKey === "hasPets") {
    const lower = value.toLowerCase().trim();
    const isYes =
      lower === "yes" ||
      lower === "y" ||
      lower === "true" ||
      lower.includes("yes");
    await prisma.application.update({
      where: { id: applicationId },
      data: { hasPets: isYes },
    });
    return { success: true };
  }

  // JSON fields — wrap free text into structured arrays for dashboard rendering
  const JSON_FIELDS = new Set(["vehicles", "rentalHistory", "references"]);
  if (JSON_FIELDS.has(fieldKey)) {
    let jsonValue: unknown[];
    if (fieldKey === "vehicles") {
      jsonValue = parseVehicleText(processedValue);
    } else {
      jsonValue = [{ description: processedValue }];
    }
    await prisma.application.update({
      where: { id: applicationId },
      data: { [fieldKey]: jsonValue as any },
    });
    return { success: true };
  }

  // Standard field → save to the model column
  if (STANDARD_FIELD_KEYS.has(fieldKey)) {
    const finalValue = ENCRYPTED_FIELDS.has(fieldKey)
      ? encrypt(processedValue)
      : processedValue;

    await prisma.application.update({
      where: { id: applicationId },
      data: { [fieldKey]: finalValue },
    });
    return { success: true };
  }

  // Custom field → save to customResponses JSON
  const application = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { customResponses: true },
  });

  const existing =
    (application?.customResponses as Record<string, string>) ?? {};
  existing[fieldKey] = processedValue;

  await prisma.application.update({
    where: { id: applicationId },
    data: { customResponses: existing },
  });

  return { success: true };
}

/**
 * Mark an application as completed.
 *
 * Returns { success: true } if all required fields are filled, or
 * { success: false, missingFields } if required fields are missing.
 */
export async function completeApplication(
  applicationId: string,
  summary: string,
): Promise<{ success: boolean; error?: string; missingFields?: string[] }> {
  // Look up the application to get propertyId
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
    select: { propertyId: true },
  });

  if (!app) {
    return { success: false, error: "Application not found" };
  }

  // Check required fields are filled
  const requiredQuestions = await prisma.question.findMany({
    where: { propertyId: app.propertyId, required: true },
    select: { fieldKey: true, text: true },
  });

  if (requiredQuestions.length > 0) {
    const filledFields = await getFilledFields(applicationId);
    const missingFields = requiredQuestions
      .filter((q) => !filledFields[q.fieldKey])
      .map((q) => q.fieldKey);

    if (missingFields.length > 0) {
      return {
        success: false,
        error: `Required fields not yet answered: ${missingFields.join(", ")}`,
        missingFields,
      };
    }
  }

  await prisma.application.update({
    where: { id: applicationId },
    data: {
      status: "completed",
      completedAt: new Date(),
      reviewNotes: summary,
    },
  });

  // Notify landlord (best-effort)
  try {
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: { property: { include: { user: true } } },
    });
    if (application) {
      const landlord = application.property.user;
      await sendNotification({
        type: "application_completed",
        recipientEmail: landlord.email,
        recipientName: landlord.name || landlord.email,
        subject: `New application completed for ${application.property.name}`,
        body: `A rental application for ${application.property.name} has been completed by ${application.fullName || "an applicant"}.\n\nLog in to your dashboard to review the application.`,
        metadata: { applicationId, propertyId: application.propertyId },
      });
    }
  } catch (notifyErr) {
    console.error("[application-builder] Notification error:", notifyErr);
  }

  return { success: true };
}

/**
 * Look up property info to answer a tenant question.
 */
export async function getPropertyInfo(
  propertyId: string,
): Promise<string> {
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: {
      name: true,
      address: true,
      description: true,
      amenities: true,
      petPolicy: true,
      tourSlots: {
        where: { isActive: true },
        select: { dayOfWeek: true, startTime: true, endTime: true, specificDate: true },
      },
      units: {
        where: { status: "vacant" },
        select: {
          unitNumber: true,
          bedrooms: true,
          bathrooms: true,
          sqft: true,
          monthlyRent: true,
          description: true,
          petPolicy: true,
          parkingInfo: true,
          utilitiesIncluded: true,
          laundry: true,
          availableDate: true,
        },
      },
    },
  });

  if (!property) {
    return "Property information is not available.";
  }

  const parts: string[] = [];
  parts.push(`${property.name} at ${property.address}`);
  if (property.description) {
    parts.push(property.description);
  }
  if (property.amenities.length > 0) {
    parts.push(`Amenities: ${property.amenities.join(", ")}`);
  }
  if (property.petPolicy) {
    parts.push(`Pet Policy: ${property.petPolicy}`);
  }

  // Tour availability summary
  if (property.tourSlots.length > 0) {
    const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const recurring = property.tourSlots
      .filter((s) => s.dayOfWeek !== null)
      .map((s) => `${dayNames[s.dayOfWeek!]} ${s.startTime}-${s.endTime}`);
    if (recurring.length > 0) {
      parts.push(`Tour Availability: ${recurring.join(", ")}`);
    }
  }

  if (property.units.length > 0) {
    parts.push(`Available units:`);
    for (const u of property.units) {
      const rent = `$${(u.monthlyRent / 100).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
      const details = [
        u.bedrooms ? `${u.bedrooms}BR` : null,
        u.bathrooms ? `${u.bathrooms}BA` : null,
        u.sqft ? `${u.sqft} sqft` : null,
      ]
        .filter(Boolean)
        .join("/");
      parts.push(
        `  Unit ${u.unitNumber}: ${rent}/mo${details ? ` (${details})` : ""}`,
      );
      // Extra unit details
      const extras = [
        u.description ? `Description: ${u.description}` : null,
        u.petPolicy ? `Pet Policy: ${u.petPolicy}` : null,
        u.parkingInfo ? `Parking: ${u.parkingInfo}` : null,
        u.utilitiesIncluded ? `Utilities: ${u.utilitiesIncluded}` : null,
        u.laundry ? `Laundry: ${u.laundry}` : null,
        u.availableDate ? `Available: ${u.availableDate.toLocaleDateString()}` : null,
      ].filter(Boolean);
      for (const extra of extras) {
        parts.push(`    ${extra}`);
      }
    }
  } else {
    parts.push("No vacant units listed at this time.");
  }

  return parts.join("\n");
}

/**
 * Find or create an in-progress application for resume.
 *
 * Looks for an existing in-progress application from the same caller phone
 * and property within APPLICATION_RESUME_DAYS. If found, returns it.
 * Otherwise, creates a new one.
 */
export async function findOrCreateApplication(
  propertyId: string,
  callerPhone: string,
  channel: "voice" | "sms" | "web",
): Promise<{ application: ApplicationData; isResume: boolean; hasDuplicate: boolean }> {
  const resumeCutoff = new Date();
  resumeCutoff.setDate(
    resumeCutoff.getDate() - APPLICATION_RESUME_DAYS,
  );

  // Check for existing in-progress application
  const existing = await prisma.application.findFirst({
    where: {
      propertyId,
      callerPhone,
      status: "in_progress",
      createdAt: { gte: resumeCutoff },
    },
    orderBy: { createdAt: "desc" },
  });

  if (existing) {
    return {
      application: toApplicationData(existing),
      isResume: true,
      hasDuplicate: false,
    };
  }

  // Check for duplicate completed applications (within 30 days)
  const completedCutoff = new Date();
  completedCutoff.setDate(completedCutoff.getDate() - 30);

  const recentCompleted = await prisma.application.findFirst({
    where: {
      propertyId,
      callerPhone,
      status: "completed",
      completedAt: { gte: completedCutoff },
    },
  });

  let hasDuplicate = !!recentCompleted;

  // Cross-channel duplicate check: also look up by email from prior applications
  if (!hasDuplicate) {
    const priorWithEmail = await prisma.application.findFirst({
      where: {
        propertyId,
        callerPhone,
        email: { not: null },
      },
      orderBy: { createdAt: "desc" },
      select: { email: true },
    });
    if (priorWithEmail?.email) {
      const emailDup = await prisma.application.findFirst({
        where: {
          propertyId,
          email: priorWithEmail.email,
          status: "completed",
          completedAt: { gte: completedCutoff },
        },
      });
      if (emailDup) hasDuplicate = true;
    }
  }

  // Create new application
  const app = await prisma.application.create({
    data: {
      propertyId,
      callerPhone,
      channel,
      status: "in_progress",
    },
  });

  return {
    application: toApplicationData(app),
    isResume: false,
    hasDuplicate,
  };
}

/**
 * Get all already-filled fields for an application (for prompt resume).
 * Decrypts PII fields for display in the prompt.
 */
export async function getFilledFields(
  applicationId: string,
): Promise<Record<string, string>> {
  const app = await prisma.application.findUnique({
    where: { id: applicationId },
  });

  if (!app) return {};

  const filled: Record<string, string> = {};

  // Standard text fields
  if (app.fullName) filled.fullName = app.fullName;
  if (app.email) filled.email = app.email;
  if (app.currentAddress) filled.currentAddress = app.currentAddress;
  if (app.monthlyIncome) filled.monthlyIncome = app.monthlyIncome;
  if (app.employer) filled.employer = app.employer;
  if (app.employerPhone) filled.employerPhone = app.employerPhone;
  if (app.moveInDate) filled.moveInDate = app.moveInDate;
  if (app.petDetails) filled.petDetails = app.petDetails;

  // Boolean field
  if (app.hasPets !== null) {
    filled.hasPets = app.hasPets ? "Yes" : "No";
  }

  // Encrypted fields — we include a placeholder for the prompt
  // (not the raw encrypted value, and not fully decrypted for safety in prompt)
  if (app.ssn) filled.ssn = "[provided]";
  if (app.dateOfBirth) filled.dateOfBirth = "[provided]";

  // JSON fields
  if (app.vehicles) filled.vehicles = "[provided]";
  if (app.rentalHistory) filled.rentalHistory = "[provided]";
  if (app.references) filled.references = "[provided]";

  // Custom responses
  const custom = app.customResponses as Record<string, string> | null;
  if (custom) {
    for (const [key, val] of Object.entries(custom)) {
      filled[key] = val;
    }
  }

  return filled;
}

// ── Internal types ──

export interface ApplicationData {
  id: string;
  propertyId: string;
  callerPhone: string | null;
  channel: string;
  status: string;
}

/**
 * Parse free-text vehicle description into a structured JSON array.
 * Handles "2020 Honda Civic (ABC123)" → [{ year, makeModel, licensePlate }]
 * Falls back to [{ description }] for unstructured text.
 */
function parseVehicleText(raw: string): unknown[] {
  const match = raw.match(/^(\d{4})\s+(.+?)\s*\(([^)]+)\)$/);
  if (match) {
    return [{ year: match[1], makeModel: match[2].trim(), licensePlate: match[3].trim() }];
  }
  return [{ description: raw }];
}

function toApplicationData(app: {
  id: string;
  propertyId: string;
  callerPhone: string | null;
  channel: string;
  status: string;
}): ApplicationData {
  return {
    id: app.id,
    propertyId: app.propertyId,
    callerPhone: app.callerPhone,
    channel: app.channel,
    status: app.status,
  };
}
