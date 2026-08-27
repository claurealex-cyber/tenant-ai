import { prisma } from "../lib/prisma.js";
import {
  buildPrompt,
  buildTools,
  SMS_CONVERSATION_EXPIRY_HOURS,
  STANDARD_APPLICATION_FIELDS,
} from "@tenant-ai/shared";
import type { QuestionDefinition } from "@tenant-ai/shared";
import { callChatAPI, splitSmsResponse } from "../services/openai-chat.js";
import {
  saveApplicationField,
  completeApplication,
  getPropertyInfo,
  findOrCreateApplication,
  getFilledFields,
} from "./application-builder.js";
import {
  recordUsage,
  estimateSmsCostCents,
} from "../services/usage-tracking.js";
import {
  getAvailableSlots,
  bookTour,
} from "../services/tour-service.js";
import {
  createMaintenanceRequest,
  getMaintenanceRequestsForTenant,
} from "../services/maintenance-service.js";
import { handleSurveyIntake } from "./survey-intake.js";
import { getCallByPhone } from "../lib/call-registry.js";
import { sendUserText } from "../services/openai-realtime.js";

// Keywords for opt-out and help
const STOP_KEYWORDS = new Set(["stop", "unsubscribe", "cancel", "quit"]);
const START_KEYWORDS = new Set(["start", "subscribe", "resume"]);
const HELP_KEYWORDS = new Set(["help", "info"]);

export interface SmsResult {
  replies: string[];
  shouldRespond: boolean;
  /**
   * How the delivery seam should treat the replies:
   *  - "link": survey-link reply (subject to the relay per-tenant cooldown)
   *  - "confirmation": STOP/START/HELP confirmations (exempt from cooldown and
   *    the opt-out check — suppressing an opt-out confirmation is a compliance
   *    regression)
   *  - "ai": normal conversational reply (default)
   */
  replyKind?: "link" | "confirmation" | "ai";
}

/**
 * Handle an incoming SMS message.
 *
 * Returns an array of reply messages to send back, or empty if silenced.
 * Application creation is deferred until the AI calls start_application.
 */
export async function handleIncomingSms(
  callerPhone: string,
  twilioTo: string,
  messageBody: string,
): Promise<SmsResult> {
  const body = messageBody.trim();

  // Reject excessively long messages (Twilio max is ~1600 chars)
  if (body.length > 1600) {
    return {
      replies: ["Your message is too long. Please keep it under 1,600 characters."],
      shouldRespond: true,
    };
  }

  const bodyLower = body.toLowerCase();

  // Look up property by Twilio phone (include tour slots for multi-intent)
  const property = await prisma.property.findFirst({
    where: { twilioPhone: twilioTo, isActive: true },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      tourSlots: { where: { isActive: true } },
    },
  });

  if (!property) {
    return { replies: [], shouldRespond: false };
  }

  // Check if caller is a known tenant (for maintenance tools)
  const tenant = await prisma.tenant.findFirst({
    where: { phone: callerPhone, userId: property.userId },
    include: { leases: { where: { status: "active" }, take: 1 } },
  });
  const isTenant = !!tenant;
  const hasTourSlots = property.tourSlots.length > 0;

  // ── STOP keyword ──
  if (STOP_KEYWORDS.has(bodyLower)) {
    await prisma.smsOptOut.upsert({
      where: {
        phone_propertyId: {
          phone: callerPhone,
          propertyId: property.id,
        },
      },
      update: {},
      create: {
        phone: callerPhone,
        propertyId: property.id,
      },
    });

    // Reflect the opt-out onto any Zillow lead so the dashboard stops
    // offering (and the batch stops attempting) sends to this phone.
    await prisma.zillowLead
      .updateMany({
        where: { phone: callerPhone, status: { in: ["new", "invited"] } },
        data: { status: "opted_out" },
      })
      .catch(() => undefined);

    return {
      replies: [
        "You've been unsubscribed. You will no longer receive messages from this number. Reply START to re-subscribe.",
      ],
      shouldRespond: true,
      replyKind: "confirmation",
    };
  }

  // ── START keyword ──
  if (START_KEYWORDS.has(bodyLower)) {
    await prisma.smsOptOut.deleteMany({
      where: {
        phone: callerPhone,
        propertyId: property.id,
      },
    });

    return {
      replies: [
        "You've been re-subscribed. You will now receive messages from this number.",
      ],
      shouldRespond: true,
      replyKind: "confirmation",
    };
  }

  // ── Check opt-out ──
  const optedOut = await prisma.smsOptOut.findUnique({
    where: {
      phone_propertyId: {
        phone: callerPhone,
        propertyId: property.id,
      },
    },
  });

  if (optedOut) {
    // Silently ignore messages from opted-out numbers
    return { replies: [], shouldRespond: false };
  }

  // ── HELP keyword ──
  if (HELP_KEYWORDS.has(bodyLower)) {
    return {
      replies: [
        `This is the AI assistant for ${property.name}. You can ask about the property, schedule a tour, or apply for a rental. Reply STOP to opt out.`,
      ],
      shouldRespond: true,
      replyKind: "confirmation",
    };
  }

  // ── Mid-call text answer: the caller is on a live AI call with this number ──
  // Inject the text into the realtime session as a user message — the AI
  // acknowledges it ON THE CALL (no SMS reply needed, so 10DLC is irrelevant)
  // and saves it via save_application_field exactly like a spoken answer.
  const liveCall = getCallByPhone(callerPhone);
  if (liveCall && liveCall.propertyId === property.id && liveCall.openaiWs) {
    // Collapse newlines/control chars so a crafted text can't fake message
    // structure inside the realtime conversation; cap length for sanity.
    const clean = body.replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").slice(0, 500);
    sendUserText(
      liveCall.openaiWs,
      `[The applicant texted this answer instead of speaking]: ${clean}`,
    );
    liveCall.transcript.push({
      role: "user",
      content: `(texted) ${clean}`,
      timestamp: new Date(),
    });
    // Deliberately NOT persisted to SmsConversation (may contain PII like DOB);
    // the call transcript is its record, same as spoken answers.
    return { replies: [], shouldRespond: false };
  }

  // ── SMS-link intake: reply with a web survey link instead of the conversational apply ──
  // Known tenants bypass intake entirely — "my sink is leaking" must reach the
  // AI maintenance flow, never an application link.
  if (property.smsIntakeEnabled && !isTenant) {
    const result = await handleSurveyIntake(
      {
        id: property.id,
        userId: property.userId,
        name: property.name,
        intakeAutoReply: property.intakeAutoReply,
      },
      callerPhone,
      body,
    );
    // Persist the exchange so the dashboard Messages tab shows what tenants
    // actually said — zero visibility is not acceptable for a business line.
    await persistIntakeExchange(property.id, callerPhone, body, result.replies);
    return result;
  }

  // ── Normal message — process through AI ──

  // Find or create SMS conversation
  const expiresAt = new Date(
    Date.now() + SMS_CONVERSATION_EXPIRY_HOURS * 60 * 60 * 1000,
  );

  let conversation = await prisma.smsConversation.findUnique({
    where: {
      callerPhone_propertyId: {
        callerPhone,
        propertyId: property.id,
      },
    },
  });

  // Track applicationId mutably — may be set when AI calls start_application
  let applicationId: string | null = conversation?.applicationId ?? null;

  if (!conversation) {
    conversation = await prisma.smsConversation.create({
      data: {
        callerPhone,
        propertyId: property.id,
        applicationId: null, // Deferred — no application until AI calls start_application
        messages: [],
        expiresAt,
      },
    });
  } else {
    // Reset expiry on activity
    await prisma.smsConversation.update({
      where: { id: conversation.id },
      data: { expiresAt },
    });
  }

  // Build conversation history
  const existingMessages = (
    conversation.messages as Array<{
      role: string;
      content: string;
    }>
  ) || [];

  const isFirstMessage = existingMessages.length === 0;

  // Add user message to history
  const updatedMessages = [
    ...existingMessages,
    { role: "user", content: body },
  ];

  // Auto-seed standard questions if none exist (fallback for pre-existing properties)
  if (property.questions.length === 0) {
    await prisma.question.createMany({
      data: STANDARD_APPLICATION_FIELDS.map((q) => ({
        text: q.text,
        fieldKey: q.fieldKey,
        type: q.type,
        required: q.required,
        sortOrder: q.sortOrder,
        isStandard: true,
        propertyId: property.id,
      })),
    });
    const seeded = await prisma.question.findMany({
      where: { propertyId: property.id },
      orderBy: { sortOrder: "asc" },
    });
    property.questions = seeded;
  }

  // Build prompt
  const filledFields = applicationId
    ? await getFilledFields(applicationId)
    : {};
  const questions: QuestionDefinition[] = property.questions.map((q) => ({
    id: q.id,
    text: q.text,
    fieldKey: q.fieldKey,
    type: q.type as "text" | "yes_no" | "number" | "date",
    required: q.required,
    sortOrder: q.sortOrder,
    isStandard: q.isStandard,
  }));

  const systemPrompt = buildPrompt({
    property: {
      name: property.name,
      address: property.address,
      description: property.description,
      aiDisclosureText: property.aiDisclosureText,
      amenities: property.amenities,
      petPolicy: property.petPolicy,
      greetingMessage: property.greetingMessage,
      recordingEnabled: property.recordingEnabled ?? false,
    },
    questions,
    application:
      Object.keys(filledFields).length > 0
        ? { filledFields }
        : null,
    channel: "sms",
    isTenant,
    hasTourSlots,
  });

  const tools = buildTools({ isTenant, hasTourSlots });

  // Call OpenAI Chat API with tool-call feedback loop (max 5 iterations for multi-tool calls)
  const chatMessages: Array<{ role: string; content: string; tool_call_id?: string }> =
    updatedMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

  let replyText: string | null = null;
  const MAX_TOOL_LOOPS = 5;

  for (let loop = 0; loop < MAX_TOOL_LOOPS; loop++) {
    const response = await callChatAPI(
      systemPrompt,
      chatMessages as any,
      tools,
    );

    // If no function calls, use the content as final reply
    if (response.functionCalls.length === 0) {
      replyText = response.content;
      break;
    }

    // Append the assistant message (with tool_calls) to history so the API knows what was requested
    if (response.assistantMessage) {
      chatMessages.push(response.assistantMessage);
    }

    // Process each function call and feed results back
    for (const fc of response.functionCalls) {
      let result: string;
      try {
        const args = JSON.parse(fc.arguments);

        switch (fc.name) {
          case "start_application": {
            const { application, hasDuplicate } = await findOrCreateApplication(
              property.id, callerPhone, "sms",
            );
            applicationId = application.id;
            await prisma.smsConversation.update({
              where: { id: conversation!.id },
              data: { applicationId },
            });
            result = JSON.stringify({ success: true, hasDuplicate });
            break;
          }
          case "save_application_field": {
            if (!applicationId) {
              // Safety fallback: auto-create application
              const { application } = await findOrCreateApplication(
                property.id, callerPhone, "sms",
              );
              applicationId = application.id;
              await prisma.smsConversation.update({
                where: { id: conversation!.id },
                data: { applicationId },
              });
            }
            const question = property.answerValidation
              ? questions.find((q) => q.fieldKey === args.field_key)
              : undefined;
            const saveResult = await saveApplicationField(
              applicationId,
              args.field_key,
              args.value,
              question ? { questionText: question.text, questionType: question.type } : undefined,
            );
            result = JSON.stringify(saveResult);
            break;
          }
          case "complete_application": {
            if (!applicationId) {
              result = JSON.stringify({ error: "No application started" });
              break;
            }
            const completeResult = await completeApplication(applicationId, args.summary);
            result = JSON.stringify(completeResult);
            break;
          }
          case "get_property_info": {
            const info = await getPropertyInfo(property.id);
            result = JSON.stringify({ info });
            break;
          }
          case "check_tour_availability": {
            const slots = await getAvailableSlots(
              property.id,
              args.preferred_date ? new Date(args.preferred_date) : undefined,
            );
            result = JSON.stringify({ available_slots: slots });
            break;
          }
          case "schedule_tour": {
            const booking = await bookTour(
              property.id,
              args.name,
              args.phone || callerPhone,
              args.email || null,
              new Date(args.datetime),
              "sms",
            );
            result = JSON.stringify({ success: true, date: booking.date, name: booking.name });
            break;
          }
          case "submit_maintenance_request": {
            const tenantForMaint = await prisma.tenant.findFirst({
              where: { phone: callerPhone, userId: property.userId },
            });
            if (!tenantForMaint) {
              result = JSON.stringify({
                error: "Could not find your tenant account by phone number. Please contact your landlord or submit via the tenant portal.",
              });
              break;
            }
            const request = await createMaintenanceRequest(property.id, tenantForMaint.id, {
              title: args.title,
              description: args.description,
              category: args.category,
            });
            result = JSON.stringify({ success: true, id: request.id });
            break;
          }
          case "check_maintenance_status": {
            const tenantForStatus = await prisma.tenant.findFirst({
              where: { phone: callerPhone, userId: property.userId },
            });
            if (!tenantForStatus) {
              result = JSON.stringify({ error: "Could not find your tenant account." });
              break;
            }
            const requests = await getMaintenanceRequestsForTenant(tenantForStatus.id);
            result = JSON.stringify({
              requests: requests.map((r) => ({
                title: r.title,
                status: r.status,
                category: r.category,
                createdAt: r.createdAt,
              })),
            });
            break;
          }
          default:
            result = JSON.stringify({ error: `Unknown function: ${fc.name}` });
        }
      } catch (err) {
        console.warn(`SMS function call failed: ${fc.name}`, err);
        result = JSON.stringify({
          error: `Function failed: ${err instanceof Error ? err.message : String(err)}`,
        });
      }

      // Append tool result so the AI sees it on the next iteration
      chatMessages.push({
        role: "tool",
        content: result,
        tool_call_id: fc.id,
      });
    }

    // If this is the last iteration, use whatever content came back
    if (loop === MAX_TOOL_LOOPS - 1 && response.content) {
      replyText = response.content;
    }
  }

  replyText = replyText || "I'm sorry, I couldn't process that. Could you try again?";

  // Add opt-out notice on first message
  if (isFirstMessage) {
    replyText += "\n\nReply STOP at any time to opt out.";
  }

  // Split long responses
  const replies = splitSmsResponse(replyText);

  // Save messages to conversation (user + assistant)
  const finalMessages = [
    ...updatedMessages,
    { role: "assistant", content: replyText },
  ];

  await prisma.smsConversation.update({
    where: { id: conversation!.id },
    data: {
      messages: finalMessages,
      expiresAt,
    },
  });

  // Record usage for billing
  await recordUsage({
    userId: property.userId,
    propertyId: property.id,
    type: "sms",
    costCents: estimateSmsCostCents(),
    metadata: {
      callerPhone,
      applicationId,
    },
  });

  // replyKind "ai": over the relay this is cooldown-exempt and uses the AI
  // budget — before this, an unset kind mapped to "link" and got cooldown-
  // skipped for 60 min after the first reply.
  return { replies, shouldRespond: true, replyKind: "ai" };
}

/**
 * Append an intake-mode exchange to the SmsConversation so the Messages tab
 * shows it. Best-effort — a logging failure must not block the reply.
 */
async function persistIntakeExchange(
  propertyId: string,
  callerPhone: string,
  inbound: string,
  replies: string[],
): Promise<void> {
  try {
    const expiresAt = new Date(
      Date.now() + SMS_CONVERSATION_EXPIRY_HOURS * 60 * 60 * 1000,
    );
    const newMessages = [
      { role: "user", content: inbound },
      ...replies.map((r) => ({ role: "assistant", content: r })),
    ];
    const existing = await prisma.smsConversation.findUnique({
      where: { callerPhone_propertyId: { callerPhone, propertyId } },
    });
    if (existing) {
      const messages = [
        ...((existing.messages as Array<{ role: string; content: string }>) || []),
        ...newMessages,
      ];
      await prisma.smsConversation.update({
        where: { id: existing.id },
        data: { messages, expiresAt },
      });
    } else {
      await prisma.smsConversation.create({
        data: {
          callerPhone,
          propertyId,
          applicationId: null,
          messages: newMessages,
          expiresAt,
        },
      });
    }
  } catch (err) {
    console.warn("Failed to persist intake exchange:", err);
  }
}

/**
 * Clean up expired SMS conversations.
 * Called by the hourly BullMQ job.
 */
export async function cleanupExpiredConversations(): Promise<number> {
  const result = await prisma.smsConversation.deleteMany({
    where: {
      expiresAt: { lt: new Date() },
    },
  });

  return result.count;
}
