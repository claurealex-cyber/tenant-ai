// ──────────────── Application Field Types ────────────────

export interface ApplicationField {
  fieldKey: string;
  value: string;
}

export interface RentalHistoryEntry {
  address: string;
  landlord?: string;
  phone?: string;
  duration?: string;
  reasonForLeaving?: string;
}

export interface ReferenceEntry {
  name: string;
  phone: string;
  relationship?: string;
}

export interface VehicleEntry {
  make: string;
  model: string;
  year?: string;
  licensePlate?: string;
}

// ──────────────── AI Tool Call Types ────────────────

export interface SaveApplicationFieldParams {
  field_key: string;
  value: string;
}

export interface CompleteApplicationParams {
  summary: string;
}

export interface GetPropertyInfoParams {
  question: string;
}

// ──────────────── Channel Types ────────────────

export type ApplicationChannel = "voice" | "sms" | "web";

export type ApplicationStatus =
  | "in_progress"
  | "completed"
  | "reviewed"
  | "rejected";

export type NoticeType = "five_day" | "ten_day" | "thirty_day";

export type NoticeReason =
  | "non_payment"
  | "lease_violation"
  | "termination";

export type ServiceMethod =
  | "personal"
  | "substitute"
  | "certified_mail";

export type PaymentMethod = "ach" | "card" | "cash" | "check";

export type PaymentStatus =
  | "pending"
  | "completed"
  | "failed"
  | "refunded";

export type PaymentType =
  | "rent"
  | "late_fee"
  | "security_deposit"
  | "other";

export type LeaseType = "fixed" | "month_to_month";

export type LeaseStatus = "active" | "expired" | "terminated";

export type UnitStatus = "vacant" | "occupied" | "maintenance";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "suspended";

export type UsageRecordType =
  | "voice_call"
  | "sms"
  | "web_app"
  | "website_visit";

export type InvoiceStatus =
  | "draft"
  | "finalized"
  | "paid"
  | "failed";

// ──────────────── Transcript Types ────────────────

export interface TranscriptEntry {
  role: "ai" | "user" | "system";
  content: string;
  timestamp: Date;
}

// ──────────────── Token Usage ────────────────

export interface TokenUsage {
  inputAudio?: number;
  outputAudio?: number;
  inputText?: number;
  outputText?: number;
}

// ──────────────── Question Types ────────────────

export type QuestionType = "text" | "yes_no" | "number" | "date";

export interface QuestionDefinition {
  id: string;
  text: string;
  fieldKey: string;
  type: QuestionType;
  required: boolean;
  sortOrder: number;
  isStandard: boolean;
}

// ──────────────── Prompt Builder Input ────────────────

export interface PromptBuilderInput {
  property: {
    name: string;
    address: string;
    description?: string | null;
    aiDisclosureText?: string | null;
    amenities: string[];
    petPolicy?: string | null;
    greetingMessage?: string | null;
    recordingEnabled?: boolean;
  };
  questions: QuestionDefinition[];
  application?: {
    filledFields: Record<string, string>;
    hasDuplicate?: boolean;
  } | null;
  channel: ApplicationChannel;
  isTenant?: boolean;
  hasTourSlots?: boolean;
  /** Voice only: the AI may text the application link (caller_link != off). */
  callerLink?: boolean;
  /** Voice only: "link" = do not collect the application by voice, text the link. */
  voiceIntake?: "phone" | "link";
  /** Voice + link intake: the exact opening line the AI greets with. */
  voiceGreeting?: string | null;
}

// ──────────────── Validation Result ────────────────

export interface ValidationResult {
  valid: boolean;
  value?: string;
  error?: string;
}

// ──────────────── Deposit Deduction ────────────────

export interface DepositDeduction {
  description: string;
  amount: number;
}
