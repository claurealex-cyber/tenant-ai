import { describe, it, expect } from "vitest";
import { buildPrompt, buildTools } from "../prompts.js";
import type { PromptBuilderInput, QuestionDefinition } from "../types.js";
import { SMS_TARGET_CHARS, DEFAULT_AI_DISCLOSURE } from "../constants.js";

const baseQuestions: QuestionDefinition[] = [
  {
    id: "q1",
    text: "What is your full name?",
    fieldKey: "fullName",
    type: "text",
    required: true,
    sortOrder: 0,
    isStandard: true,
  },
  {
    id: "q2",
    text: "What is your date of birth?",
    fieldKey: "dateOfBirth",
    type: "date",
    required: true,
    sortOrder: 1,
    isStandard: true,
  },
  {
    id: "q3",
    text: "What is your SSN?",
    fieldKey: "ssn",
    type: "text",
    required: true,
    sortOrder: 2,
    isStandard: true,
  },
  {
    id: "q4",
    text: "Do you have any pets?",
    fieldKey: "hasPets",
    type: "yes_no",
    required: false,
    sortOrder: 3,
    isStandard: true,
  },
  {
    id: "q5",
    text: "Do you have any felonies?",
    fieldKey: "felonies",
    type: "yes_no",
    required: true,
    sortOrder: 4,
    isStandard: false,
  },
];

const baseInput: PromptBuilderInput = {
  property: {
    name: "Sunset Apartments",
    address: "123 Main St, Chicago IL 60601",
    description: "Beautiful 2BR units with lake views",
    aiDisclosureText: null,
    amenities: ["Laundry", "Parking"],
  },
  questions: baseQuestions,
  application: null,
  channel: "voice",
};

describe("buildPrompt", () => {
  it("includes property name and address", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Sunset Apartments");
    expect(prompt).toContain("123 Main St, Chicago IL 60601");
  });

  it("uses default disclosure when aiDisclosureText is null", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain(DEFAULT_AI_DISCLOSURE);
  });

  it("uses custom disclosure when provided", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      property: {
        ...baseInput.property,
        aiDisclosureText: "Custom disclosure text here.",
      },
    };
    const prompt = buildPrompt(input);
    expect(prompt).toContain("Custom disclosure text here.");
    expect(prompt).not.toContain(DEFAULT_AI_DISCLOSURE);
  });

  it("includes property description", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Beautiful 2BR units with lake views");
  });

  it("includes amenities", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Laundry, Parking");
  });

  it("omits description when null", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      property: { ...baseInput.property, description: null },
    };
    const prompt = buildPrompt(input);
    expect(prompt).not.toContain("Description:");
  });

  it("omits amenities when empty", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      property: { ...baseInput.property, amenities: [] },
    };
    const prompt = buildPrompt(input);
    expect(prompt).not.toContain("Amenities:");
  });

  it("lists questions in sortOrder sequence", () => {
    const prompt = buildPrompt(baseInput);
    const nameIdx = prompt.indexOf("What is your full name?");
    const dobIdx = prompt.indexOf("What is your date of birth?");
    const ssnIdx = prompt.indexOf("What is your SSN?");
    const petsIdx = prompt.indexOf("Do you have any pets?");
    const feloniesIdx = prompt.indexOf("Do you have any felonies?");

    expect(nameIdx).toBeLessThan(dobIdx);
    expect(dobIdx).toBeLessThan(ssnIdx);
    expect(ssnIdx).toBeLessThan(petsIdx);
    expect(petsIdx).toBeLessThan(feloniesIdx);
  });

  it("labels required and optional questions", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("[field_key: fullName, type: text, required]");
    expect(prompt).toContain("[field_key: hasPets, type: yes_no, optional]");
  });

  it("includes custom questions after standard ones", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain(
      "[field_key: felonies, type: yes_no, required]",
    );
  });

  it("includes all rules", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Ask ONE question at a time");
    expect(prompt).toContain("save_application_field");
    expect(prompt).toContain("get_property_info");
    expect(prompt).toContain("complete_application");
  });

  // ── Resume logic ──

  it("includes ALREADY PROVIDED section when resuming", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      application: {
        filledFields: {
          fullName: "John Smith",
          dateOfBirth: "1990-03-05",
        },
      },
    };
    const prompt = buildPrompt(input);
    expect(prompt).toContain(
      "THE APPLICANT HAS ALREADY PROVIDED THE FOLLOWING INFORMATION:",
    );
    expect(prompt).toContain(
      "- What is your full name?: John Smith",
    );
    expect(prompt).toContain(
      "- What is your date of birth?: 1990-03-05",
    );
    expect(prompt).toContain("Do NOT re-ask these questions");
  });

  it("excludes filled fields from QUESTIONS TO ASK", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      application: {
        filledFields: {
          fullName: "John Smith",
          dateOfBirth: "1990-03-05",
        },
      },
    };
    const prompt = buildPrompt(input);

    // The remaining questions section should NOT contain fullName or dateOfBirth
    const questionsSection = prompt.split("APPLICATION QUESTIONS")[1];
    expect(questionsSection).not.toContain("field_key: fullName");
    expect(questionsSection).not.toContain("field_key: dateOfBirth");

    // But should contain the rest
    expect(questionsSection).toContain("field_key: ssn");
    expect(questionsSection).toContain("field_key: hasPets");
    expect(questionsSection).toContain("field_key: felonies");
  });

  it("numbers remaining questions starting from 1", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      application: {
        filledFields: { fullName: "John Smith" },
      },
    };
    const prompt = buildPrompt(input);
    const questionsSection = prompt.split("APPLICATION QUESTIONS")[1];
    expect(questionsSection).toContain("1. What is your date of birth?");
    expect(questionsSection).toContain("2. What is your SSN?");
  });

  it("no ALREADY PROVIDED section when application is null", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).not.toContain("ALREADY PROVIDED");
  });

  // ── Channel-specific ──

  it("includes SMS-specific rules for sms channel", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      channel: "sms",
    };
    const prompt = buildPrompt(input);
    expect(prompt).toContain(
      `Keep responses under ${SMS_TARGET_CHARS} characters`,
    );
    expect(prompt).toContain("Do not use markdown formatting");
  });

  it("does NOT include SMS rules for voice channel", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).not.toContain("Keep responses under");
    expect(prompt).not.toContain("markdown");
  });

  it("does NOT include SMS rules for web channel", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      channel: "web",
    };
    const prompt = buildPrompt(input);
    expect(prompt).not.toContain("Keep responses under");
  });

  // ── Edge cases ──

  it("handles empty questions array", () => {
    const input: PromptBuilderInput = {
      ...baseInput,
      questions: [],
    };
    const prompt = buildPrompt(input);
    expect(prompt).toContain("No application questions have been configured");
    expect(prompt).toContain("Sunset Apartments");
  });

  it("handles all fields already filled (resume with nothing left)", () => {
    const allFilled: Record<string, string> = {};
    for (const q of baseQuestions) {
      allFilled[q.fieldKey] = "answered";
    }
    const input: PromptBuilderInput = {
      ...baseInput,
      application: { filledFields: allFilled },
    };
    const prompt = buildPrompt(input);
    expect(prompt).toContain("ALREADY PROVIDED");
    expect(prompt).toContain("All questions have already been answered");
  });

  it("prompt stays reasonable length", () => {
    const prompt = buildPrompt(baseInput);
    // Should be well under 128k tokens (~500k chars)
    expect(prompt.length).toBeLessThan(10000);
  });

  // ── Multi-intent features ──

  it("includes caller routing conversation flow", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("CONVERSATION FLOW:");
    expect(prompt).toContain("Are you looking to apply for a rental unit, or are you already a tenant here?");
    expect(prompt).toContain("If they want to apply");
  });

  it("includes tour option when hasTourSlots is true", () => {
    const prompt = buildPrompt({ ...baseInput, hasTourSlots: true });
    expect(prompt).toContain("Schedule a tour");
    expect(prompt).toContain("check_tour_availability");
    expect(prompt).toContain("schedule_tour");
  });

  it("includes maintenance options when isTenant is true", () => {
    const prompt = buildPrompt({ ...baseInput, isTenant: true });
    expect(prompt).toContain("Report a maintenance issue");
    expect(prompt).toContain("submit_maintenance_request");
    expect(prompt).toContain("check_maintenance_status");
  });

  it("excludes tour options when hasTourSlots is false", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).not.toContain("Schedule a tour");
  });

  it("always includes maintenance options in prompt for tenant branch", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Report a maintenance issue");
    expect(prompt).toContain("submit_maintenance_request");
  });

  it("includes pet policy when set", () => {
    const prompt = buildPrompt({
      ...baseInput,
      property: { ...baseInput.property, petPolicy: "Cats only, $300 deposit" },
    });
    expect(prompt).toContain("Pet Policy: Cats only, $300 deposit");
  });
});

describe("buildTools", () => {
  it("returns 6 base tools (includes maintenance)", () => {
    const tools = buildTools();
    expect(tools).toHaveLength(6);
  });

  it("includes save_application_field tool", () => {
    const tools = buildTools();
    const save = tools.find((t) => t.name === "save_application_field");
    expect(save).toBeDefined();
    expect(save!.parameters.required).toContain("field_key");
    expect(save!.parameters.required).toContain("value");
  });

  it("includes complete_application tool", () => {
    const tools = buildTools();
    const complete = tools.find((t) => t.name === "complete_application");
    expect(complete).toBeDefined();
    expect(complete!.parameters.required).toContain("summary");
  });

  it("includes get_property_info tool", () => {
    const tools = buildTools();
    const info = tools.find((t) => t.name === "get_property_info");
    expect(info).toBeDefined();
    expect(info!.parameters.required).toContain("question");
  });

  it("all tools have type function", () => {
    const tools = buildTools();
    expect(tools.every((t) => t.type === "function")).toBe(true);
  });

  it("includes start_application tool", () => {
    const tools = buildTools();
    const start = tools.find((t) => t.name === "start_application");
    expect(start).toBeDefined();
  });

  it("includes tour tools when hasTourSlots is true", () => {
    const tools = buildTools({ hasTourSlots: true });
    expect(tools.find((t) => t.name === "check_tour_availability")).toBeDefined();
    expect(tools.find((t) => t.name === "schedule_tour")).toBeDefined();
  });

  it("excludes tour tools when hasTourSlots is false/undefined", () => {
    const tools = buildTools();
    expect(tools.find((t) => t.name === "check_tour_availability")).toBeUndefined();
    expect(tools.find((t) => t.name === "schedule_tour")).toBeUndefined();
  });

  it("always includes maintenance tools regardless of isTenant", () => {
    const tools = buildTools();
    expect(tools.find((t) => t.name === "submit_maintenance_request")).toBeDefined();
    expect(tools.find((t) => t.name === "check_maintenance_status")).toBeDefined();
  });

  it("returns 8 tools when hasTourSlots is true", () => {
    const tools = buildTools({ hasTourSlots: true });
    expect(tools).toHaveLength(8);
  });
});

describe("buildPrompt gap fixes", () => {
  it("tells AI application is not ready when questions are empty and nothing filled", () => {
    const prompt = buildPrompt({ ...baseInput, questions: [], application: null });
    expect(prompt).toContain("No application questions have been configured");
    expect(prompt).toContain("call back later");
  });

  it("tells AI to call complete_application when all questions are already answered", () => {
    const allFilled: Record<string, string> = {};
    for (const q of baseQuestions) allFilled[q.fieldKey] = "answered";
    const prompt = buildPrompt({
      ...baseInput,
      application: { filledFields: allFilled },
    });
    expect(prompt).toContain("All questions have already been answered");
    expect(prompt).toContain("complete_application");
  });

  it("includes skip guidance for optional questions in RULES section", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("skip");
    expect(prompt).toMatch(/Do NOT skip required/i);
  });

  it("includes answer correction guidance in RULES section", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("correct a previous answer");
    expect(prompt).toContain("save_application_field");
    expect(prompt).toContain("overwrite");
  });

  it("includes completion goodbye instruction in RULES section", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("complete_application");
    expect(prompt).toContain("thank");
    expect(prompt).toContain("goodbye");
  });

  it("includes duplicate application warning when hasDuplicate is true", () => {
    const prompt = buildPrompt({
      ...baseInput,
      application: { filledFields: {}, hasDuplicate: true },
    });
    expect(prompt).toContain("already has a completed application");
    expect(prompt).toContain("30 days");
  });

  it("does NOT include duplicate warning when hasDuplicate is false/undefined", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).not.toContain("already has a completed application");
  });

  // ── Answer read-back & confirmation ──

  it("includes answer confirmation rules with spell-out in prompt", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("spell it out completely to confirm before saving");
    expect(prompt).toContain("spell out each name letter by letter");
    expect(prompt).toContain("spell out every character");
    expect(prompt).toContain("Do NOT call save_application_field until the caller confirms");
  });

  it("skips confirmation for yes/no questions", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("yes/no questions: no confirmation needed");
  });

  it("includes voice-specific spelling rule for voice channel", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("spell out every answer letter by letter when confirming");
  });

  it("excludes voice spelling rule for SMS channel", () => {
    const prompt = buildPrompt({ ...baseInput, channel: "sms" });
    expect(prompt).not.toContain("spell out every answer letter by letter when confirming");
  });

  // ── Custom greeting ──

  it("uses custom greeting when greetingMessage is set", () => {
    const prompt = buildPrompt({
      ...baseInput,
      property: { ...baseInput.property, greetingMessage: "Welcome to Sunset!" },
    });
    expect(prompt).toContain('Greet the caller with this message: "Welcome to Sunset!"');
    expect(prompt).not.toContain("Greet the caller warmly and introduce yourself");
  });

  it("uses default greeting when greetingMessage is null", () => {
    const prompt = buildPrompt({
      ...baseInput,
      property: { ...baseInput.property, greetingMessage: null },
    });
    expect(prompt).toContain("Greet the caller warmly and introduce yourself");
    expect(prompt).not.toContain("Greet the caller with this message");
  });

  it("uses default greeting when greetingMessage is undefined", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Greet the caller warmly and introduce yourself");
  });

  // ── Recording disclosure ──

  it("appends recording disclosure when recordingEnabled is true", () => {
    const prompt = buildPrompt({
      ...baseInput,
      property: { ...baseInput.property, recordingEnabled: true, aiDisclosureText: "Hello, I am an AI." },
    });
    expect(prompt).toContain("Hello, I am an AI.");
    expect(prompt).toContain("This call may be recorded for quality purposes.");
  });

  it("does NOT duplicate recording text when disclosure already mentions recorded", () => {
    const prompt = buildPrompt({
      ...baseInput,
      property: {
        ...baseInput.property,
        recordingEnabled: true,
        aiDisclosureText: "This call is recorded for training.",
      },
    });
    expect(prompt).toContain("This call is recorded for training.");
    // Should NOT append the extra sentence since it already mentions "recorded"
    expect(prompt).not.toContain("This call may be recorded for quality purposes.");
  });

  it("does NOT append recording disclosure when recordingEnabled is false", () => {
    const prompt = buildPrompt({
      ...baseInput,
      property: { ...baseInput.property, recordingEnabled: false },
    });
    expect(prompt).not.toContain("This call may be recorded for quality purposes.");
  });
});

describe("caller intent routing", () => {
  it("asks identifying question when isTenant is false", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("Are you looking to apply for a rental unit, or are you already a tenant here?");
  });

  it("acknowledges known tenant when isTenant is true", () => {
    const prompt = buildPrompt({ ...baseInput, isTenant: true });
    expect(prompt).toContain("phone number is on file as a current tenant");
    expect(prompt).not.toContain("Are you looking to apply for a rental unit, or are you already a tenant here?");
  });

  it("directs applicants straight to application questions with MUST call tools", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("If they want to apply: You MUST call the start_application function immediately");
    expect(prompt).toContain("MUST call save_application_field");
    expect(prompt).toContain("MUST call complete_application");
  });

  it("lists tenant options when caller identifies as tenant", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("If they are a tenant: Let them know you can help with:");
    expect(prompt).toContain("Report a maintenance issue");
    expect(prompt).toContain("Check on an existing maintenance request");
    expect(prompt).toContain("submit_maintenance_request");
    expect(prompt).toContain("check_maintenance_status");
  });

  it("includes tenant verification error guidance in rules", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("cannot find their account");
    expect(prompt).toContain("tenant portal");
  });

  it("includes critical tool-calling emphasis in rules", () => {
    const prompt = buildPrompt(baseInput);
    expect(prompt).toContain("CRITICAL: You MUST use function calls to save application data");
    expect(prompt).toContain("only calling save_application_field persists answers");
    expect(prompt).toContain("MUST call start_application FIRST before asking any questions");
    expect(prompt).toContain("MUST call save_application_field with the field_key and value BEFORE asking the next question");
  });
});
