import type { QuestionType } from "./types.js";

// ──────────────── Standard Application Fields ────────────────

export interface StandardField {
  fieldKey: string;
  text: string;
  type: QuestionType;
  required: boolean;
  sortOrder: number;
}

export const STANDARD_APPLICATION_FIELDS: StandardField[] = [
  { fieldKey: "email", text: "What is your email address?", type: "text", required: true, sortOrder: 1 },
  { fieldKey: "fullName", text: "What is your full name?", type: "text", required: true, sortOrder: 2 },
  { fieldKey: "contact_phone", text: "What is the best phone number to reach you?", type: "text", required: true, sortOrder: 3 },
  { fieldKey: "dateOfBirth", text: "What is your date of birth?", type: "date", required: true, sortOrder: 4 },
  { fieldKey: "bedrooms_needed", text: "How many bedrooms do you need?", type: "number", required: true, sortOrder: 5 },
  { fieldKey: "household_size", text: "How many people will be living in the apartment?", type: "number", required: true, sortOrder: 6 },
  { fieldKey: "employer", text: "Where do you work?", type: "text", required: true, sortOrder: 7 },
  { fieldKey: "employment_start_date", text: "What date did your employment start?", type: "date", required: true, sortOrder: 8 },
  { fieldKey: "employed_one_year", text: "Have you been employed at your current job for at least one year?", type: "yes_no", required: true, sortOrder: 9 },
  { fieldKey: "monthlyIncome", text: "What is your gross monthly income?", type: "number", required: true, sortOrder: 10 },
  { fieldKey: "time_at_current_address", text: "How long have you been living at your current address?", type: "text", required: true, sortOrder: 11 },
];

// ──────────────── OpenAI Models ────────────────

export const OPENAI_REALTIME_MODELS = [
  "gpt-4o-mini-realtime-preview",
  "gpt-4o-realtime-preview",
] as const;

export const OPENAI_VOICES = [
  "alloy",
  "echo",
  "fable",
  "onyx",
  "nova",
  "shimmer",
] as const;

// ──────────────── App Defaults ────────────────

export const DEFAULT_AI_MODEL = "gpt-4o-mini-realtime-preview";
export const DEFAULT_VOICE = "alloy";
export const DEFAULT_MAX_CALL_MINUTES = 15;
export const DEFAULT_AI_DISCLOSURE =
  "This call is assisted by AI and may be recorded for quality purposes.";

export const SMS_MAX_CHARS = 480;
export const SMS_TARGET_CHARS = 300;

export const APPLICATION_RESUME_DAYS = 7;
export const SMS_CONVERSATION_EXPIRY_HOURS = 24;

export const MAX_PHOTOS_PER_PROPERTY = 20;
export const MAX_PHOTO_SIZE_MB = 10;
