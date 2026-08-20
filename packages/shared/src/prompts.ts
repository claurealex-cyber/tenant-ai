import type { PromptBuilderInput, QuestionDefinition } from "./types.js";
import { DEFAULT_AI_DISCLOSURE, SMS_TARGET_CHARS } from "./constants.js";

/**
 * Build a system prompt for voice, SMS, or web AI sessions.
 *
 * The prompt includes property context, disclosure text, questions in sort
 * order, already-collected fields for resume, and channel-specific rules.
 * Supports multi-intent calls: Q&A, tour scheduling, applications, and maintenance.
 */
export function buildPrompt(input: PromptBuilderInput): string {
  const { property, questions, application, channel, isTenant, hasTourSlots } = input;

  let disclosure =
    property.aiDisclosureText || DEFAULT_AI_DISCLOSURE;

  // Append recording consent language when recording is enabled
  if (property.recordingEnabled && !disclosure.toLowerCase().includes("recorded")) {
    disclosure += " This call may be recorded for quality purposes.";
  }

  const sortedQuestions = [...questions].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );

  // Determine which fields are already filled (for resume)
  const filledFields = application?.filledFields ?? {};
  const filledKeys = new Set(Object.keys(filledFields));

  // Split into already-answered and remaining
  const remaining = sortedQuestions.filter((q) => !filledKeys.has(q.fieldKey));

  const sections: string[] = [];

  // ── Header ──
  sections.push(
    `You are a friendly AI assistant for ${property.name} at ${property.address}.`,
  );
  sections.push(disclosure);
  sections.push("");
  sections.push("You MUST speak in English at all times.");

  // ── Conversation flow — route by caller identity ──
  sections.push("");
  sections.push("CONVERSATION FLOW:");
  if (property.greetingMessage) {
    sections.push(
      "1. Greet the caller with this message: \"" + property.greetingMessage + "\"",
    );
  } else {
    sections.push(
      "1. Greet the caller warmly and introduce yourself as the AI assistant for " + property.name + ".",
    );
  }

  if (isTenant) {
    // Known tenant — skip the identifying question
    const tenantOptions: string[] = [
      "Ask questions about the property or their unit",
    ];
    if (hasTourSlots) {
      tenantOptions.push("Schedule a tour");
    }
    tenantOptions.push("Report a maintenance issue");
    tenantOptions.push("Check on an existing maintenance request");
    tenantOptions.push("Apply for a rental unit");

    sections.push(
      "2. The caller's phone number is on file as a current tenant. Welcome them back and let them know you can help with:",
    );
    tenantOptions.forEach((opt, i) => {
      sections.push(`   ${String.fromCharCode(97 + i)}. ${opt}`);
    });
    sections.push("   Then ask which they'd like help with.");

    sections.push("3. Based on their response:");
    sections.push("   - For property questions: Use get_property_info to answer.");
    if (hasTourSlots) {
      sections.push(
        "   - For tour scheduling: Use check_tour_availability to find open slots, confirm the details, then use schedule_tour to book.",
      );
    }
    sections.push(
      "   - For maintenance issues: Use submit_maintenance_request after collecting a title, description, and category.",
    );
    sections.push(
      "   - For maintenance status: Use check_maintenance_status to look up their open requests.",
    );
    sections.push(
      "   - For applying: You MUST call the start_application function first. Then ask the interview questions one at a time, calling save_application_field after each confirmed answer. When done, call complete_application.",
    );
  } else {
    // Unknown caller — ask the identifying question
    sections.push(
      "2. Ask the caller: \"Are you looking to apply for a rental unit, or are you already a tenant here?\"",
    );

    sections.push("3. Based on their response:");
    sections.push(
      "   - If they want to apply: You MUST call the start_application function immediately before asking any questions. Then ask the interview questions one at a time. After each answer is confirmed, you MUST call save_application_field to save it before moving to the next question. When all required questions are answered, you MUST call complete_application.",
    );

    // Tenant branch — list options and handling guidance
    const tenantBranchOptions: string[] = [
      "Ask questions about the property or their unit",
    ];
    if (hasTourSlots) {
      tenantBranchOptions.push("Schedule a tour");
    }
    tenantBranchOptions.push("Report a maintenance issue");
    tenantBranchOptions.push("Check on an existing maintenance request");

    sections.push("   - If they are a tenant: Let them know you can help with:");
    tenantBranchOptions.forEach((opt) => {
      sections.push(`     * ${opt}`);
    });
    sections.push("     Then ask which they'd like help with.");
    sections.push("     - For property questions: Use get_property_info.");
    if (hasTourSlots) {
      sections.push(
        "     - For tour scheduling: Use check_tour_availability, confirm, then schedule_tour.",
      );
    }
    sections.push(
      "     - For maintenance issues: Use submit_maintenance_request after collecting title, description, and category.",
    );
    sections.push(
      "     - For maintenance status: Use check_maintenance_status.",
    );

    sections.push(
      "   - If they just have a question about the property: Use get_property_info to answer — no need to identify first.",
    );
  }

  sections.push(
    "4. The caller can switch intents at any time (e.g., ask questions then decide to apply).",
  );
  sections.push(
    "5. When ending a call that was not an application, thank them warmly and say goodbye.",
  );

  // ── Property information ──
  sections.push("");
  sections.push("PROPERTY INFORMATION:");
  sections.push(`Name: ${property.name}`);
  sections.push(`Address: ${property.address}`);
  if (property.description) {
    sections.push(`Description: ${property.description}`);
  }
  if (property.amenities.length > 0) {
    sections.push(`Amenities: ${property.amenities.join(", ")}`);
  }
  if (property.petPolicy) {
    sections.push(`Pet Policy: ${property.petPolicy}`);
  }

  // ── Resume section (if we have filled fields) ──
  if (filledKeys.size > 0) {
    sections.push("");
    sections.push(
      "THE APPLICANT HAS ALREADY PROVIDED THE FOLLOWING INFORMATION:",
    );
    for (const q of sortedQuestions) {
      if (filledKeys.has(q.fieldKey)) {
        sections.push(`- ${q.text}: ${filledFields[q.fieldKey]}`);
      }
    }
    sections.push("");
    sections.push(
      "Do NOT re-ask these questions. Continue with the remaining questions below.",
    );
  }

  // ── Duplicate application warning ──
  if (application?.hasDuplicate) {
    sections.push("");
    sections.push(
      "NOTE: This applicant already has a completed application for this property within the last 30 days.",
    );
    sections.push(
      "Mention this to them at the start. If they want to continue with a new application, proceed normally.",
    );
  }

  // ── Questions to ask (shown when application is active or as reference) ──
  sections.push("");
  if (remaining.length === 0 && filledKeys.size === 0) {
    sections.push(
      "NOTE: No application questions have been configured for this property yet.",
    );
    sections.push(
      "If the caller wants to apply, apologize and let them know the application is not ready. Suggest they call back later.",
    );
  } else if (remaining.length === 0) {
    sections.push(
      "All questions have already been answered. Use complete_application to finish.",
    );
  } else {
    sections.push("APPLICATION QUESTIONS (ask these in order when the caller wants to apply):");
    remaining.forEach((q, i) => {
      const requiredTag = q.required ? "required" : "optional";
      sections.push(
        `${i + 1}. ${q.text} [field_key: ${q.fieldKey}, type: ${q.type}, ${requiredTag}]`,
      );
    });
  }

  // ── Rules ──
  sections.push("");
  sections.push("RULES:");
  sections.push(
    "- Be warm and professional. Keep responses concise.",
  );
  sections.push(
    "- If the caller asks about the property, use get_property_info to look up details.",
  );

  // Application-specific rules
  sections.push(
    "- CRITICAL: You MUST use function calls to save application data. The conversation alone does NOT save anything — only calling save_application_field persists answers. If you ask questions without calling the tools, ALL answers will be permanently lost.",
  );
  sections.push(
    "- When the caller wants to apply, you MUST call start_application FIRST before asking any questions.",
  );
  sections.push(
    "- Ask ONE question at a time. Wait up to 10 seconds for the caller to respond. If they are silent, gently repeat the question once. If still no response, move on to the next question.",
  );
  sections.push(
    "- If the answer seems incomplete or unclear, politely ask for clarification.",
  );
  sections.push(
    "- After the caller provides an answer, you MUST spell it out completely to confirm before saving:",
  );
  sections.push(
    "  * For names: spell out each name letter by letter (e.g., \"J-O-H-N S-M-I-T-H\").",
  );
  sections.push(
    "  * For emails: spell out every character (e.g., \"j-o-h-n dot s-m-i-t-h at g-m-a-i-l dot c-o-m\").",
  );
  sections.push(
    "  * For addresses: spell out the street name letter by letter and say the numbers clearly (e.g., \"1-2-3 M-A-I-N Street\").",
  );
  sections.push(
    "  * For SSN: read back each digit clearly, grouped as XXX-XX-XXXX.",
  );
  sections.push(
    "  * For phone numbers: read back each digit one by one.",
  );
  sections.push(
    "  * For dates: confirm the full date (e.g., \"March 15, 2025\").",
  );
  sections.push(
    "  * For income/numbers: confirm the interpreted amount (e.g., \"$5,000 per month\").",
  );
  sections.push(
    "  * For yes/no questions: no confirmation needed — save immediately.",
  );
  sections.push(
    "  * For long descriptive answers (pets, vehicles, history, references): briefly summarize what you heard and spell out any proper nouns or important details.",
  );
  sections.push(
    "- Do NOT call save_application_field until the caller confirms the value is correct. Wait up to 10 seconds for their confirmation. If they are silent, assume the value is correct and save it. If they say it's wrong, ask for the corrected value and confirm again.",
  );
  sections.push(
    "- After each confirmed answer, you MUST call save_application_field with the field_key and value BEFORE asking the next question.",
  );
  sections.push(
    "- When all required questions are answered, you MUST call complete_application.",
  );
  sections.push(
    "- If the applicant says they don't have information for an optional question (e.g., \"I don't have that\", \"skip\"), acknowledge it and move to the next question. Do NOT skip required questions — explain why they're needed.",
  );
  sections.push(
    "- If the applicant wants to correct a previous answer, use save_application_field with the corrected value. The system will overwrite the old answer.",
  );
  sections.push(
    "- After calling complete_application, thank the applicant warmly, let them know the landlord will review their application, and say goodbye. On voice calls, the call will end shortly after.",
  );

  // Tenant verification guidance
  sections.push(
    "- If the caller says they are a tenant but the system cannot find their account (maintenance tools return an error), let them know politely and suggest they contact their landlord or use the tenant portal. Offer to help them with other options like applying or asking questions.",
  );

  // ── Channel-specific rules ──
  if (channel === "sms") {
    sections.push(
      `- Keep responses under ${SMS_TARGET_CHARS} characters.`,
    );
    sections.push("- Do not use markdown formatting.");
  }

  if (channel === "voice") {
    sections.push(
      "- Always spell out every answer letter by letter when confirming with the caller. This is critical for accuracy over voice.",
      "- The applicant may also TEXT any answer to this same phone number while on the call, from the phone they are calling from. Early in the application (and again for hard-to-dictate answers like email addresses, exact dollar amounts, or dates), briefly mention: \"you can also text your answer to this number right now if that's easier.\"",
      "- When a message arrives prefixed with '[The applicant texted this answer instead of speaking]', treat it as the applicant's answer to the current (or clearly matching) question: acknowledge it naturally on the call (e.g. \"Got your text — thanks!\"), save it with save_application_field, and move on. Do not re-ask the question. There is no need to spell out texted answers letter by letter — texting is exact.",
      "- If a texted answer and a spoken answer conflict, the most recent one wins.",
    );
  }

  return sections.join("\n");
}

interface ToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/**
 * Build the OpenAI function tools array for voice and SMS sessions.
 * Conditionally includes tour and maintenance tools based on property/caller context.
 */
export function buildTools(options?: { isTenant?: boolean; hasTourSlots?: boolean }): ToolDefinition[] {
  const tools: ToolDefinition[] = [
    {
      type: "function",
      name: "get_property_info",
      description:
        "Look up property details to answer a caller's question about the property or units",
      parameters: {
        type: "object",
        properties: {
          question: {
            type: "string",
            description: "The caller's question about the property",
          },
        },
        required: ["question"],
      },
    },
    {
      type: "function",
      name: "start_application",
      description:
        "Start a rental application when the caller explicitly wants to apply. Call this BEFORE asking application questions.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    {
      type: "function",
      name: "save_application_field",
      description:
        "Save a tenant's answer to an application question after they provide it",
      parameters: {
        type: "object",
        properties: {
          field_key: {
            type: "string",
            description:
              "The field identifier (e.g. 'fullName', 'ssn', 'monthlyIncome')",
          },
          value: {
            type: "string",
            description:
              "The tenant's answer, extracted from their response",
          },
        },
        required: ["field_key", "value"],
      },
    },
    {
      type: "function",
      name: "complete_application",
      description:
        "Mark the application as complete after all required questions are answered",
      parameters: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description: "A 2-3 sentence summary of the applicant",
          },
        },
        required: ["summary"],
      },
    },
  ];

  // Tour tools — only if property has configured tour slots
  if (options?.hasTourSlots) {
    tools.push({
      type: "function",
      name: "check_tour_availability",
      description:
        "Check available tour time slots for the property. Optionally filter by a preferred date.",
      parameters: {
        type: "object",
        properties: {
          preferred_date: {
            type: "string",
            description:
              "Optional preferred date in ISO format (e.g. '2025-03-15'). If not provided, returns availability for the next 7 days.",
          },
        },
        required: [],
      },
    });
    tools.push({
      type: "function",
      name: "schedule_tour",
      description:
        "Book a tour at the property for the caller after confirming the date/time.",
      parameters: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "The name of the person booking the tour",
          },
          phone: {
            type: "string",
            description: "Phone number (optional, defaults to caller's phone)",
          },
          email: {
            type: "string",
            description: "Email address for confirmation (optional)",
          },
          datetime: {
            type: "string",
            description:
              "The chosen date and time in ISO format (e.g. '2025-03-15T10:00:00')",
          },
        },
        required: ["name", "datetime"],
      },
    });
  }

  // Maintenance tools — always available; handlers verify tenant status at execution time
  {
    tools.push({
      type: "function",
      name: "submit_maintenance_request",
      description:
        "Submit a maintenance request for the tenant's unit. Collect a brief title, detailed description, and category first.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Brief title of the issue (e.g. 'Leaking kitchen faucet')",
          },
          description: {
            type: "string",
            description: "Detailed description of the maintenance issue",
          },
          category: {
            type: "string",
            description:
              "Category: plumbing, electrical, appliance, hvac, pest, general, or other",
          },
        },
        required: ["title", "description"],
      },
    });
    tools.push({
      type: "function",
      name: "check_maintenance_status",
      description:
        "Look up the tenant's open maintenance requests and their current status.",
      parameters: {
        type: "object",
        properties: {},
        required: [],
      },
    });
  }

  return tools;
}
