import WebSocket from "ws";
import { resolveConfig } from "@tenant-ai/shared";
import { prisma } from "../lib/prisma.js";
import {
  addCall,
  getCall,
  removeCall,
  type ActiveCall,
} from "../lib/call-registry.js";
import {
  connectToOpenAI,
  sendFunctionResult,
  sendAudioToOpenAI,
  sendSystemEvent,
} from "../services/openai-realtime.js";
import {
  saveApplicationField,
  completeApplication,
  getPropertyInfo,
  findOrCreateApplication,
  getFilledFields,
} from "./application-builder.js";
import { buildPrompt, buildTools, STANDARD_APPLICATION_FIELDS } from "@tenant-ai/shared";
import type { QuestionDefinition } from "@tenant-ai/shared";
import {
  recordUsage,
  estimateVoiceCallCostCents,
} from "../services/usage-tracking.js";
import {
  getAvailableSlots,
  bookTour,
} from "../services/tour-service.js";
import {
  createMaintenanceRequest,
  getMaintenanceRequestsForTenant,
} from "../services/maintenance-service.js";
import { forwardSurveySummary } from "../services/survey-forward.js";

const MAX_CONCURRENT = parseInt(
  process.env.MAX_CONCURRENT_CALLS || "10",
  10,
);

const PROACTIVE_RECONNECT_MINUTES = 45;
const WRAPUP_BUFFER_MINUTES = 3;
const MONITOR_INTERVAL_MS = 30_000;
const MAX_RECONNECTS = 5;

// Track monitoring intervals per stream so we can clear on call end
const callMonitors = new Map<string, ReturnType<typeof setInterval>>();

/**
 * Redact PII patterns (SSNs) from transcript entries before storage.
 */
export function redactTranscriptPII(
  transcript: { role: string; content: string; timestamp: Date }[],
): { role: string; content: string; timestamp: Date }[] {
  return transcript.map((entry) => ({
    ...entry,
    content: entry.content
      .replace(/\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g, "***-**-****")
      .replace(/\b\d{9}\b/g, "***-**-****"),
  }));
}

/**
 * Dispatch a function call from the AI to the appropriate handler.
 * Shared between initial setup and reconnect.
 */
async function dispatchFunctionCall(
  name: string,
  args: Record<string, string>,
  call: ActiveCall,
  propertyId: string,
  callerPhone: string,
  callLogId: string,
): Promise<string> {
  switch (name) {
    case "start_application": {
      const { application, hasDuplicate } = await findOrCreateApplication(
        propertyId,
        callerPhone,
        "voice",
      );
      call.applicationId = application.id;
      await prisma.application.update({
        where: { id: application.id },
        data: { callLogId },
      });
      return JSON.stringify({ success: true, hasDuplicate });
    }

    case "save_application_field": {
      if (!call.applicationId) {
        // Safety fallback: auto-create application if AI skipped start_application
        const { application } = await findOrCreateApplication(propertyId, callerPhone, "voice");
        call.applicationId = application.id;
        await prisma.application.update({ where: { id: application.id }, data: { callLogId } });
      }
      const question = call.answerValidation
        ? call.questions.find((q) => q.fieldKey === args.field_key)
        : undefined;
      const result = await saveApplicationField(
        call.applicationId,
        args.field_key,
        args.value,
        question ? { questionText: question.text, questionType: question.type } : undefined,
      );
      return result.success
        ? JSON.stringify({ success: true })
        : JSON.stringify({ success: false, error: result.error });
    }

    case "complete_application": {
      if (!call.applicationId) {
        return JSON.stringify({ error: "No application has been started." });
      }
      const completeResult = await completeApplication(
        call.applicationId,
        args.summary,
      );
      // Same owner forwarding as the web survey: summary SMS + owner-page
      // link via the relay ledger (retried by the sweep; forwardedAt-guarded).
      forwardSurveySummary(call.applicationId).catch((err) => {
        console.error("Voice application forward failed:", err);
      });
      return JSON.stringify(completeResult);
    }

    case "get_property_info": {
      const info = await getPropertyInfo(propertyId);
      return JSON.stringify({ info });
    }

    case "check_tour_availability": {
      const slots = await getAvailableSlots(
        propertyId,
        args.preferred_date ? new Date(args.preferred_date) : undefined,
      );
      return JSON.stringify({ available_slots: slots });
    }

    case "schedule_tour": {
      const booking = await bookTour(
        propertyId,
        args.name,
        args.phone || callerPhone,
        args.email || null,
        new Date(args.datetime),
        "voice",
      );
      return JSON.stringify({ success: true, date: booking.date, name: booking.name });
    }

    case "submit_maintenance_request": {
      const propOwner = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { userId: true },
      });
      if (!propOwner) {
        return JSON.stringify({ error: "Property not found." });
      }
      const tenant = await prisma.tenant.findFirst({
        where: { phone: callerPhone, userId: propOwner.userId },
      });
      if (!tenant) {
        return JSON.stringify({
          error: "Could not find your tenant account by phone number. Please contact your landlord or submit via the tenant portal.",
        });
      }
      const request = await createMaintenanceRequest(propertyId, tenant.id, {
        title: args.title,
        description: args.description,
        category: args.category,
      });
      return JSON.stringify({ success: true, id: request.id });
    }

    case "check_maintenance_status": {
      const propOwner2 = await prisma.property.findUnique({
        where: { id: propertyId },
        select: { userId: true },
      });
      if (!propOwner2) {
        return JSON.stringify({ error: "Property not found." });
      }
      const tenant2 = await prisma.tenant.findFirst({
        where: { phone: callerPhone, userId: propOwner2.userId },
      });
      if (!tenant2) {
        return JSON.stringify({ error: "Could not find your tenant account." });
      }
      const requests = await getMaintenanceRequestsForTenant(tenant2.id);
      return JSON.stringify({
        requests: requests.map((r) => ({
          title: r.title,
          status: r.status,
          category: r.category,
          createdAt: r.createdAt,
        })),
      });
    }

    default:
      return JSON.stringify({ error: `Unknown function: ${name}` });
  }
}

/**
 * Handle a new Twilio Media Stream WebSocket connection.
 *
 * This bridges audio between the caller (via Twilio) and the AI
 * (via OpenAI Realtime). It also handles function calls from the AI.
 * Application creation is deferred until the caller explicitly wants to apply.
 */
export async function handleMediaStream(
  twilioWs: WebSocket,
  callSid: string,
  callerPhone: string,
  propertyId: string,
  bufferedMessages?: Buffer[],
): Promise<void> {
  // Look up property + questions + tour slots
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    include: {
      questions: { orderBy: { sortOrder: "asc" } },
      tourSlots: { where: { isActive: true } },
    },
  });

  if (!property) {
    twilioWs.close();
    return;
  }

  // Check if caller is a known tenant (for maintenance tools)
  const tenant = await prisma.tenant.findFirst({
    where: { phone: callerPhone, userId: property.userId },
    include: { leases: { where: { status: "active" }, take: 1 } },
  });
  const isTenant = !!tenant;
  const hasTourSlots = property.tourSlots.length > 0;

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
        propertyId,
      })),
    });
    const seeded = await prisma.question.findMany({
      where: { propertyId },
      orderBy: { sortOrder: "asc" },
    });
    property.questions = seeded;
  }

  // Build the system prompt — no application context initially (deferred)
  const questions: QuestionDefinition[] = property.questions.map((q) => ({
    id: q.id,
    text: q.text,
    fieldKey: q.fieldKey,
    type: q.type as "text" | "yes_no" | "number" | "date",
    required: q.required,
    sortOrder: q.sortOrder,
    isStandard: q.isStandard,
  }));

  const instructions = buildPrompt({
    property: {
      name: property.name,
      address: property.address,
      description: property.description,
      aiDisclosureText: property.aiDisclosureText,
      amenities: property.amenities,
      petPolicy: property.petPolicy,
      greetingMessage: property.greetingMessage,
      recordingEnabled: property.recordingEnabled,
    },
    questions,
    application: null, // Deferred — no application until caller says they want to apply
    channel: "voice",
    isTenant,
    hasTourSlots,
  });

  const tools = buildTools({ isTenant, hasTourSlots });

  // Create call log
  const callLog = await prisma.callLog.create({
    data: {
      propertyId,
      callerPhone,
      channel: "voice",
      direction: "inbound",
      twilioSid: callSid,
      transcript: [],
    },
  });

  let streamSid = "";

  // Resolve OpenAI API key from DB/env once for this call
  const openaiApiKey = await resolveConfig("openai", "api_key") || undefined;

  // We set up the call entry after we get the streamSid from Twilio
  const setupOpenAI = () => {
    const openaiWs = connectToOpenAI(
      {
        model: property.aiModel,
        voice: property.voiceName,
        instructions,
        tools,
        apiKey: openaiApiKey,
      },
      {
        onAudioDelta: (base64Audio) => {
          // Forward AI audio to Twilio
          if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
            twilioWs.send(
              JSON.stringify({
                event: "media",
                streamSid,
                media: { payload: base64Audio },
              }),
            );
          }
        },
        onTranscript: (entry) => {
          const call = getCall(streamSid);
          if (call) {
            call.transcript.push(entry);
          }
        },
        onFunctionCall: async (name, callId, args) => {
          console.log(`[function-call] ${streamSid}: ${name}(${JSON.stringify(args)})`);
          const call = getCall(streamSid);
          if (!call?.openaiWs) return;

          let output: string;
          try {
            output = await dispatchFunctionCall(
              name, args, call, propertyId, callerPhone, callLog.id,
            );
          } catch (err) {
            output = JSON.stringify({
              error: `Function failed: ${err instanceof Error ? err.message : String(err)}`,
            });
          }

          console.log(`[function-result] ${streamSid}: ${name} → ${output.substring(0, 200)}`);
          sendFunctionResult(call.openaiWs, callId, output);
        },
        onError: (error) => {
          console.error("OpenAI error:", error.message);
        },
        onClose: (code, reason) => {
          console.log(
            `OpenAI WS closed: code=${code} reason=${reason}`,
          );
          // Attempt reconnection
          reconnectOpenAI(streamSid, property, questions);
        },
      },
    );

    return openaiWs;
  };

  // Listen for Twilio WS messages
  twilioWs.on("message", async (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.event) {
        case "connected":
          // Initial connection from Twilio
          break;

        case "start":
          // Stream started — we now have the stream id. Twilio calls it
          // start.streamSid; Telnyx TeXML has used top-level stream_id.
          streamSid =
            msg.start?.streamSid || msg.stream_id || msg.start?.stream_id || callSid;
          const openaiWs = setupOpenAI();

          const callEntry: ActiveCall = {
            callSid,
            streamSid,
            twilioWs,
            openaiWs,
            applicationId: null, // Deferred until start_application is called
            propertyId,
            callerPhone,
            callLogId: callLog.id,
            isTenant,
            hasTourSlots,
            questions,
            answerValidation: property.answerValidation,
            transcript: [],
            startTime: new Date(),
            reconnectCount: 0,
          };

          addCall(streamSid, callEntry);

          // Start call duration monitoring
          const monitor = setInterval(() => {
            const c = getCall(streamSid);
            if (!c) {
              clearInterval(monitor);
              callMonitors.delete(streamSid);
              return;
            }
            // Hard limit — end the call
            if (isCallExpired(c, property.maxCallMinutes)) {
              console.log(`[monitor] Call ${streamSid} expired (>${property.maxCallMinutes}m). Closing.`);
              if (c.twilioWs.readyState === WebSocket.OPEN) c.twilioWs.close();
              return;
            }
            // Wrap-up notice — ask AI to start concluding
            if (shouldWrapUp(c, property.maxCallMinutes) && c.openaiWs) {
              sendSystemEvent(
                c.openaiWs,
                "The call is approaching its time limit. Please wrap up the conversation politely and let the caller know you need to end soon.",
              );
            }
            // Proactive reconnect — close OpenAI WS to trigger reconnect
            if (shouldProactiveReconnect(c) && c.openaiWs && c.openaiWs.readyState === WebSocket.OPEN) {
              console.log(`[monitor] Proactive reconnect for ${streamSid} at ${PROACTIVE_RECONNECT_MINUTES}m.`);
              c.openaiWs.close();
            }
          }, MONITOR_INTERVAL_MS);
          callMonitors.set(streamSid, monitor);
          break;

        case "media":
          // Forward caller audio to OpenAI
          const call = getCall(streamSid);
          if (call?.openaiWs) {
            sendAudioToOpenAI(call.openaiWs, msg.media.payload);
          }
          break;

        case "stop":
          // Call ended — clean up
          await handleCallEnd(streamSid, callLog.id);
          break;
      }
    } catch (err) {
      console.error("Error processing Twilio message:", err);
    }
  });

  twilioWs.on("close", async () => {
    await handleCallEnd(streamSid, callLog.id);
  });

  twilioWs.on("error", (err) => {
    console.error("Twilio WS error:", err.message);
  });

  // Replay any buffered messages (from route-level interception)
  if (bufferedMessages) {
    for (const buf of bufferedMessages) {
      twilioWs.emit("message", buf);
    }
  }
}

/**
 * Handle call cleanup when call ends.
 */
async function handleCallEnd(
  streamSid: string,
  callLogId: string,
): Promise<void> {
  const call = getCall(streamSid);
  if (!call) return;

  // Clear monitoring interval
  const monitor = callMonitors.get(streamSid);
  if (monitor) {
    clearInterval(monitor);
    callMonitors.delete(streamSid);
  }

  // Close OpenAI WS
  if (
    call.openaiWs &&
    call.openaiWs.readyState !== WebSocket.CLOSED
  ) {
    call.openaiWs.close();
  }

  // Calculate duration
  const duration = Math.round(
    (Date.now() - call.startTime.getTime()) / 1000,
  );

  // Estimate cost
  const costCents = estimateVoiceCallCostCents(duration);

  // Redact PII (SSNs) from transcript before storage
  const redactedTranscript = redactTranscriptPII(call.transcript);

  // Auto-generate call summary for non-application calls
  let summary: string | undefined;
  if (!call.applicationId && call.transcript.length > 0) {
    const aiMessages = call.transcript.filter((t) => t.role === "ai");
    const firstAi = aiMessages[0]?.content || "";
    const exchangeCount = call.transcript.length;
    summary = `Call with ${exchangeCount} exchanges. ${firstAi.substring(0, 150)}${firstAi.length > 150 ? "..." : ""}`;
  }

  // Save transcript, duration, and cost to call log
  await prisma.callLog.update({
    where: { id: callLogId },
    data: {
      transcript: redactedTranscript.map((t) => ({
        role: t.role,
        content: t.content,
        timestamp: t.timestamp.toISOString(),
      })),
      duration,
      reconnectCount: call.reconnectCount,
      estimatedCostCents: costCents,
      endedAt: new Date(),
      ...(summary ? { summary } : {}),
    },
  });

  // Record usage for billing
  const property = await prisma.property.findUnique({
    where: { id: call.propertyId },
    select: { userId: true },
  });

  if (property) {
    await recordUsage({
      userId: property.userId,
      propertyId: call.propertyId,
      type: "voice_call",
      costCents,
      durationSeconds: duration,
      metadata: {
        callSid: call.callSid,
        callLogId,
        reconnectCount: call.reconnectCount,
      },
    });
  }

  removeCall(streamSid);
}

/**
 * Attempt to reconnect OpenAI when the WS drops.
 * Rebuilds the session with already-collected fields so the AI resumes.
 * Reads applicationId from the call registry (not a parameter) to avoid stale closures.
 */
async function reconnectOpenAI(
  streamSid: string,
  property: {
    aiModel: string;
    voiceName: string;
    name: string;
    address: string;
    description: string | null;
    aiDisclosureText: string | null;
    amenities: string[];
    petPolicy: string | null;
    greetingMessage: string | null;
    recordingEnabled: boolean;
  },
  questions: QuestionDefinition[],
): Promise<void> {
  const call = getCall(streamSid);
  if (!call) return;

  // Don't reconnect if Twilio WS is also closed
  if (call.twilioWs.readyState !== WebSocket.OPEN) return;

  call.reconnectCount++;

  if (call.reconnectCount > MAX_RECONNECTS) {
    console.warn(
      `[reconnect] Max reconnects (${MAX_RECONNECTS}) exceeded for ${streamSid}. Ending call.`,
    );
    if (call.twilioWs.readyState === WebSocket.OPEN) call.twilioWs.close();
    return;
  }

  // Get current filled fields for the updated prompt (if application exists)
  const filledFields = call.applicationId
    ? await getFilledFields(call.applicationId)
    : {};

  const resumeInstructions = buildPrompt({
    property: {
      name: property.name,
      address: property.address,
      description: property.description,
      aiDisclosureText: property.aiDisclosureText,
      amenities: property.amenities,
      petPolicy: property.petPolicy,
      greetingMessage: property.greetingMessage,
      recordingEnabled: property.recordingEnabled,
    },
    questions,
    application:
      Object.keys(filledFields).length > 0
        ? { filledFields }
        : null,
    channel: "voice",
    isTenant: call.isTenant,
    hasTourSlots: call.hasTourSlots,
  });

  const tools = buildTools({ isTenant: call.isTenant, hasTourSlots: call.hasTourSlots });

  const reconnectApiKey = await resolveConfig("openai", "api_key") || undefined;

  const newOpenaiWs = connectToOpenAI(
    {
      model: property.aiModel,
      voice: property.voiceName,
      instructions: resumeInstructions,
      tools,
      apiKey: reconnectApiKey,
    },
    {
      onAudioDelta: (base64Audio) => {
        if (call.twilioWs.readyState === WebSocket.OPEN && streamSid) {
          call.twilioWs.send(
            JSON.stringify({
              event: "media",
              streamSid,
              media: { payload: base64Audio },
            }),
          );
        }
      },
      onTranscript: (entry) => {
        call.transcript.push(entry);
      },
      onFunctionCall: async (name, callId, args) => {
        console.log(`[function-call][reconnect] ${streamSid}: ${name}(${JSON.stringify(args)})`);
        const currentCall = getCall(streamSid);
        if (!currentCall?.openaiWs) return;

        let output: string;
        try {
          output = await dispatchFunctionCall(
            name, args, currentCall,
            currentCall.propertyId,
            currentCall.callerPhone,
            currentCall.callLogId,
          );
        } catch (err) {
          output = JSON.stringify({
            error: `Function failed: ${err instanceof Error ? err.message : String(err)}`,
          });
        }
        console.log(`[function-result][reconnect] ${streamSid}: ${name} → ${output.substring(0, 200)}`);
        if (currentCall.openaiWs) sendFunctionResult(currentCall.openaiWs, callId, output);
      },
      onError: (error) => {
        console.error("OpenAI reconnect error:", error.message);
      },
      onClose: (code, reason) => {
        console.log(
          `OpenAI reconnected WS closed: code=${code} reason=${reason}`,
        );
        reconnectOpenAI(streamSid, property, questions);
      },
    },
  );

  call.openaiWs = newOpenaiWs;
}

/**
 * Get the elapsed call duration in minutes.
 */
export function getCallDurationMinutes(call: ActiveCall): number {
  return (Date.now() - call.startTime.getTime()) / (1000 * 60);
}

/**
 * Check if a call should start wrapping up (maxCallMinutes - buffer).
 */
export function shouldWrapUp(
  call: ActiveCall,
  maxCallMinutes: number,
): boolean {
  const elapsed = getCallDurationMinutes(call);
  return elapsed >= maxCallMinutes - WRAPUP_BUFFER_MINUTES;
}

/**
 * Check if a call has exceeded its maximum duration.
 */
export function isCallExpired(
  call: ActiveCall,
  maxCallMinutes: number,
): boolean {
  const elapsed = getCallDurationMinutes(call);
  return elapsed >= maxCallMinutes;
}

/**
 * Check if a call should proactively reconnect (at 45 min).
 */
export function shouldProactiveReconnect(call: ActiveCall): boolean {
  const elapsed = getCallDurationMinutes(call);
  return elapsed >= PROACTIVE_RECONNECT_MINUTES;
}

export { MAX_CONCURRENT, MAX_RECONNECTS, PROACTIVE_RECONNECT_MINUTES, WRAPUP_BUFFER_MINUTES };
