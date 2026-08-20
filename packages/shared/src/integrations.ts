export interface IntegrationFieldDef {
  key: string;
  label: string;
  envVar: string;
  sensitive: boolean;
  required: boolean;
  placeholder?: string;
  helpText?: string;
}

export interface IntegrationDef {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: "ai" | "communication" | "payment" | "storage" | "banking";
  fields: IntegrationFieldDef[];
  testEndpoint?: string;
}

export const INTEGRATION_REGISTRY: IntegrationDef[] = [
  {
    id: "twilio",
    name: "Twilio",
    description: "Voice and SMS for AI phone calls and text-based applications",
    icon: "phone",
    category: "communication",
    fields: [
      {
        key: "account_sid",
        label: "Account SID",
        envVar: "TWILIO_ACCOUNT_SID",
        sensitive: false,
        required: true,
        placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
      },
      {
        key: "auth_token",
        label: "Auth Token",
        envVar: "TWILIO_AUTH_TOKEN",
        sensitive: true,
        required: true,
      },
      {
        key: "public_url",
        label: "Public Webhook URL",
        envVar: "PUBLIC_URL",
        sensitive: false,
        required: true,
        placeholder: "https://your-server.example.com",
        helpText:
          "The publicly accessible URL where Twilio sends webhooks",
      },
    ],
    testEndpoint: "/api/admin/integrations/twilio/test",
  },
  {
    id: "telnyx",
    name: "Telnyx",
    description:
      "Voice and SMS via Telnyx TeXML and Messaging — alternative to Twilio",
    icon: "phone",
    category: "communication",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        envVar: "TELNYX_API_KEY",
        sensitive: true,
        required: true,
        placeholder: "KEY...",
      },
      {
        key: "account_sid",
        label: "TeXML Account SID",
        envVar: "TELNYX_ACCOUNT_SID",
        sensitive: false,
        required: true,
        helpText:
          "Account ID shown on TeXML applications — needed for call recording",
      },
      {
        key: "public_key",
        label: "Webhook Public Key",
        envVar: "TELNYX_PUBLIC_KEY",
        sensitive: false,
        required: true,
        helpText:
          "Base64 Ed25519 key from portal.telnyx.com → Account Settings → Public Key, used to verify webhook signatures",
      },
    ],
    testEndpoint: "/api/admin/integrations/telnyx/test",
  },
  {
    id: "sms_relay",
    name: "SMS Relay",
    description:
      "Temporary outbound SMS via the Mac's Messages app until 10DLC registration approves",
    icon: "phone",
    category: "communication",
    fields: [
      {
        key: "enabled",
        label: "Relay Enabled",
        envVar: "SMS_RELAY_ENABLED",
        sensitive: false,
        required: false,
        placeholder: "false",
        helpText:
          "true/false. When on, tenant-facing texts go out via the Messages relay instead of Telnyx. Changes take up to 60s to reach the running server.",
      },
      {
        key: "survey_base_url",
        label: "Survey Base URL",
        envVar: "SMS_RELAY_SURVEY_BASE_URL",
        sensitive: false,
        required: true,
        helpText:
          "Public base URL for survey links (the tunnel domain). Must be finalized before sending live links — links embed this URL at mint time.",
      },
      {
        key: "forward_to",
        label: "Forward-To Number",
        envVar: "SMS_RELAY_FORWARD_TO",
        sensitive: false,
        required: true,
        placeholder: "+17735621795",
        helpText: "E.164 number that receives survey response summaries.",
      },
      {
        key: "relay_from",
        label: "Relay-From Number",
        envVar: "SMS_RELAY_FROM",
        sensitive: false,
        required: false,
        placeholder: "+17084158984",
        helpText:
          "The personal number tenants will see (display only — actual sender is the Mac's Messages account).",
      },
      {
        key: "cooldown_minutes",
        label: "Per-Tenant Cooldown (min)",
        envVar: "SMS_RELAY_COOLDOWN_MIN",
        sensitive: false,
        required: false,
        placeholder: "60",
      },
      {
        key: "hourly_cap",
        label: "Hourly Send Cap",
        envVar: "SMS_RELAY_HOURLY_CAP",
        sensitive: false,
        required: false,
        placeholder: "5",
      },
      {
        key: "daily_cap",
        label: "Daily Send Cap",
        envVar: "SMS_RELAY_DAILY_CAP",
        sensitive: false,
        required: false,
        placeholder: "25",
      },
      {
        key: "forward_detail",
        label: "Forward Detail Level",
        envVar: "SMS_RELAY_FORWARD_DETAIL",
        sensitive: false,
        required: false,
        placeholder: "minimal",
        helpText:
          "minimal (name, phone, bedrooms) or full (adds income, employer, email — more PII over SMS).",
      },
      {
        key: "internal_secret",
        label: "Internal API Secret",
        envVar: "SMS_RELAY_INTERNAL_SECRET",
        sensitive: true,
        required: true,
        helpText:
          "Shared secret for the dashboard-to-server relay-test call. Generate with: openssl rand -hex 32",
      },
      {
        key: "owner_view_token",
        label: "Owner View Token",
        envVar: "SMS_RELAY_OWNER_VIEW_TOKEN",
        sensitive: true,
        required: false,
        helpText:
          "Secret token for the read-only applications page at /owner/<token> on the public URL. Anyone with the link can view applicant details (never DOB) — treat it like a password.",
      },
    ],
  },
  {
    id: "openai",
    name: "OpenAI",
    description:
      "AI conversation engine for voice and SMS applications",
    icon: "cpu",
    category: "ai",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        envVar: "OPENAI_API_KEY",
        sensitive: true,
        required: true,
        placeholder: "sk-...",
      },
      {
        key: "sms_model",
        label: "SMS Model",
        envVar: "OPENAI_SMS_MODEL",
        sensitive: false,
        required: false,
        placeholder: "gpt-4o-mini",
      },
      {
        key: "default_model",
        label: "Voice Model",
        envVar: "OPENAI_DEFAULT_MODEL",
        sensitive: false,
        required: false,
        placeholder: "gpt-4o-realtime-preview",
      },
    ],
    testEndpoint: "/api/admin/integrations/openai/test",
  },
  {
    id: "ai_validation",
    name: "AI Validation",
    description:
      "Secondary AI for validating application answer completeness",
    icon: "shield-check",
    category: "ai",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        envVar: "AI_VALIDATION_API_KEY",
        sensitive: true,
        required: false,
        placeholder: "sk-...",
        helpText:
          "OpenAI API key for answer validation. Falls back to main OpenAI key if not set.",
      },
      {
        key: "model",
        label: "Model",
        envVar: "AI_VALIDATION_MODEL",
        sensitive: false,
        required: false,
        placeholder: "gpt-4o-mini",
        helpText: "Model to use for validation (default: gpt-4o-mini)",
      },
    ],
    testEndpoint: "/api/admin/integrations/ai-validation/test",
  },
  {
    id: "stripe",
    name: "Stripe",
    description:
      "Billing and payment processing for subscriptions and rent payments",
    icon: "credit-card",
    category: "payment",
    fields: [
      {
        key: "secret_key",
        label: "Secret Key",
        envVar: "STRIPE_SECRET_KEY",
        sensitive: true,
        required: true,
        placeholder: "sk_...",
      },
      {
        key: "publishable_key",
        label: "Publishable Key",
        envVar: "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
        sensitive: false,
        required: true,
        placeholder: "pk_...",
      },
      {
        key: "webhook_secret",
        label: "Webhook Secret",
        envVar: "STRIPE_WEBHOOK_SECRET",
        sensitive: true,
        required: false,
        placeholder: "whsec_...",
      },
      {
        key: "connect_client_id",
        label: "Connect Client ID",
        envVar: "STRIPE_CONNECT_CLIENT_ID",
        sensitive: false,
        required: false,
        placeholder: "ca_...",
      },
    ],
    testEndpoint: "/api/admin/integrations/stripe/test",
  },
  {
    id: "sendgrid",
    name: "SendGrid",
    description:
      "Transactional email for notifications, password resets, and receipts",
    icon: "mail",
    category: "communication",
    fields: [
      {
        key: "api_key",
        label: "API Key",
        envVar: "SENDGRID_API_KEY",
        sensitive: true,
        required: true,
        placeholder: "SG....",
      },
      {
        key: "from_email",
        label: "From Email",
        envVar: "EMAIL_FROM",
        sensitive: false,
        required: true,
        placeholder: "noreply@yourdomain.com",
      },
    ],
    testEndpoint: "/api/admin/integrations/sendgrid/test",
  },
  {
    id: "s3",
    name: "S3 / MinIO",
    description:
      "File storage for property photos, lease documents, and receipts",
    icon: "cloud",
    category: "storage",
    fields: [
      {
        key: "bucket",
        label: "Bucket Name",
        envVar: "S3_BUCKET",
        sensitive: false,
        required: true,
        placeholder: "tenant-ai-uploads",
      },
      {
        key: "region",
        label: "Region",
        envVar: "S3_REGION",
        sensitive: false,
        required: true,
        placeholder: "us-east-1",
      },
      {
        key: "endpoint",
        label: "Endpoint",
        envVar: "S3_ENDPOINT",
        sensitive: false,
        required: false,
        placeholder: "http://localhost:9000",
        helpText:
          "Leave blank for AWS S3, set for MinIO or other S3-compatible services",
      },
      {
        key: "access_key_id",
        label: "Access Key ID",
        envVar: "AWS_ACCESS_KEY_ID",
        sensitive: true,
        required: true,
      },
      {
        key: "secret_access_key",
        label: "Secret Access Key",
        envVar: "AWS_SECRET_ACCESS_KEY",
        sensitive: true,
        required: true,
      },
    ],
    testEndpoint: "/api/admin/integrations/s3/test",
  },
  {
    id: "plaid",
    name: "Plaid",
    description: "Bank account linking for ACH rent payments",
    icon: "bank",
    category: "banking",
    fields: [
      {
        key: "client_id",
        label: "Client ID",
        envVar: "PLAID_CLIENT_ID",
        sensitive: false,
        required: true,
      },
      {
        key: "secret",
        label: "Secret",
        envVar: "PLAID_SECRET",
        sensitive: true,
        required: true,
      },
      {
        key: "env",
        label: "Environment",
        envVar: "PLAID_ENV",
        sensitive: false,
        required: true,
        placeholder: "sandbox",
      },
    ],
    testEndpoint: "/api/admin/integrations/plaid/test",
  },
];

export function configDbKey(
  integrationId: string,
  fieldKey: string
): string {
  return `${integrationId}.${fieldKey}`;
}
