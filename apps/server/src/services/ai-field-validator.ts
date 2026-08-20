/**
 * AI-powered semantic validation for application field answers.
 *
 * Uses a configurable model (default: gpt-4o-mini) from the AI Validation
 * integration, falling back to the main OpenAI integration. Fail-open: if
 * the API call fails, the answer saves normally.
 *
 * Only runs for fields that don't already have programmatic validators
 * (SSN, email, phone, dates, income are validated by FIELD_VALIDATORS).
 */

import { resolveConfig } from "@tenant-ai/shared";

// Fields that already have programmatic validators — skip AI validation
const PROGRAMMATIC_FIELDS = new Set([
  "ssn",
  "email",
  "employerPhone",
  "dateOfBirth",
  "moveInDate",
  "monthlyIncome",
]);

const SYSTEM_PROMPT = `You are a data quality validator for a rental application.
You MUST respond with a JSON object: { "valid": true } or { "valid": false, "reason": "..." }

Rules:
- The answer has already been extracted by another AI. Focus on SEMANTIC completeness.
- Be LENIENT — only reject clearly incomplete or nonsensical answers.

Examples of INVALID answers:
- Full name with just first name ("John" without last name)
- Address missing city/state ("123 Main St" alone)
- Employer as single letter or "a place"
- Pet details as just "yes" (needs type/breed/size)
- Vehicle as just "car" (needs year/make/model)
- Rental history as "I rented before" (needs address/duration)
- Reference as just a name (needs phone/relationship)

Examples of VALID answers:
- "John Smith" for full name
- "123 Main St, Chicago IL" for address (even without zip)
- "Acme Corp" for employer
- "Golden retriever, 60 lbs" for pet details
- Any substantive answer for custom questions

The reason field should be a short, friendly message for the applicant.`;

/**
 * Determine if a field should go through AI validation.
 * Returns false for programmatically-validated fields and yes_no types.
 */
export function shouldAIValidate(fieldKey: string, questionType: string): boolean {
  if (PROGRAMMATIC_FIELDS.has(fieldKey)) return false;
  if (questionType === "yes_no") return false;
  return true;
}

/**
 * Validate a field answer using a lightweight AI call.
 * Returns { valid: true } if the answer passes or on any error (fail-open).
 */
export async function validateFieldWithAI(input: {
  fieldKey: string;
  value: string;
  questionText: string;
  questionType: string;
}): Promise<{ valid: boolean; reason?: string }> {
  // Skip fields that don't need AI validation
  if (!shouldAIValidate(input.fieldKey, input.questionType)) {
    return { valid: true };
  }

  try {
    const apiKey = await resolveConfig("ai_validation", "api_key")
      || await resolveConfig("openai", "api_key");
    if (!apiKey) {
      console.warn("[ai-field-validator] No API key configured, skipping validation");
      return { valid: true };
    }

    const model = await resolveConfig("ai_validation", "model", "gpt-4o-mini") || "gpt-4o-mini";

    const userMessage = `Question: "${input.questionText}"\nField: ${input.fieldKey}\nAnswer: "${input.value}"`;

    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
        max_tokens: 150,
      }),
      signal: AbortSignal.timeout(3_000),
    });

    if (!response.ok) {
      console.warn(`[ai-field-validator] API error: ${response.status}`);
      return { valid: true };
    }

    const data: any = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      console.warn("[ai-field-validator] No content in response");
      return { valid: true };
    }

    const parsed = JSON.parse(content);
    if (typeof parsed.valid === "boolean") {
      return { valid: parsed.valid, reason: parsed.reason };
    }

    console.warn("[ai-field-validator] Unexpected response format:", content);
    return { valid: true };
  } catch (err) {
    console.warn("[ai-field-validator] Validation failed, allowing save:", err instanceof Error ? err.message : String(err));
    return { valid: true };
  }
}
