import { prisma } from "../lib/prisma.js";
import {
  resolveConfig,
  buildQaPrompt,
  SMS_MAX_CHARS,
} from "@tenant-ai/shared";
import { callChatAPI } from "../services/openai-chat.js";
import { buildPropertyFacts } from "../services/property-facts.js";
import type { SmsResult } from "./sms-handler.js";

export interface IntakeQaContext {
  property: { id: string; userId: string; name: string; aiDisclosureText?: string | null };
  callerPhone: string;
  inboundMessage: string;
  /** The application link to nudge with (from the survey toggle). */
  link: string;
}

const FALLBACK_REPLY =
  "Thanks for your message! Someone from the team will get back to you shortly.";

type Msg = { role: string; content: string };

/** Trim to a single SMS: one message, cut at the last sentence/space before the cap. */
export function toSingleSms(text: string, maxLen: number = SMS_MAX_CHARS): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= maxLen) return t;
  const slice = t.slice(0, maxLen);
  const lastStop = Math.max(slice.lastIndexOf(". "), slice.lastIndexOf("! "), slice.lastIndexOf("? "));
  if (lastStop > maxLen * 0.5) return slice.slice(0, lastStop + 1).trim();
  const lastSpace = slice.lastIndexOf(" ");
  return (lastSpace > 0 ? slice.slice(0, lastSpace) : slice).trim();
}

async function conversationMessages(propertyId: string, phone: string): Promise<Msg[]> {
  const conv = await prisma.smsConversation.findUnique({
    where: { callerPhone_propertyId: { callerPhone: phone, propertyId } },
    select: { messages: true },
  });
  return ((conv?.messages as Msg[] | null) ?? []).filter((m) => m && m.role && typeof m.content === "string");
}

/**
 * Answer a prospect's question in Link + Q&A mode, from the property's own data.
 *
 * - Per-phone daily cap is delivery-independent: it counts prior assistant
 *   messages in the (≤24h) SmsConversation, which is populated regardless of
 *   how replies are delivered. One over-cap "team will follow up" note, then
 *   silence.
 * - Exactly ONE SMS per answer (never split into several relay sends).
 * - The application link is nudged on the first answer of a conversation with
 *   no link yet, then every 3rd answer, or when they ask how to apply.
 * - The opt-out line rides only the first answer of the conversation.
 * - OpenAI unavailable → one canned fallback (not repeated back-to-back).
 */
export async function handleIntakeQa(ctx: IntakeQaContext): Promise<SmsResult> {
  const history = await conversationMessages(ctx.property.id, ctx.callerPhone);
  const assistantMsgs = history.filter((m) => m.role === "assistant");
  const priorAssistant = assistantMsgs.length;

  const perPhoneCap = parseInt((await resolveConfig("sms_relay", "qa_daily_cap_per_phone")) || "8", 10);
  if (priorAssistant > perPhoneCap) {
    return { replies: [], shouldRespond: false }; // already over cap — stay silent
  }
  if (priorAssistant === perPhoneCap) {
    return {
      replies: ["Thanks! To keep things easy, the team will follow up with you directly from here."],
      shouldRespond: true,
      replyKind: "ai",
    };
  }

  const { facts, hasAnyFacts } = await buildPropertyFacts(ctx.property.id);
  const systemPrompt = buildQaPrompt({
    propertyName: ctx.property.name,
    facts,
    hasAnyFacts,
    applyUrl: ctx.link,
    disclosure: ctx.property.aiDisclosureText ?? null,
  });

  // Cap the inbound before it reaches the model: a 5,000-char SMS bomb should
  // not blow up tokens or smuggle a wall of injected instructions.
  const inbound = ctx.inboundMessage.slice(0, 500);
  const chatHistory: Msg[] = [
    ...history.slice(-12),
    { role: "user", content: inbound },
  ];

  let answer: string;
  try {
    const res = await callChatAPI(systemPrompt, chatHistory as any, []); // NO tools in Q&A
    answer = (res.content || "").trim();
    if (!answer) throw new Error("empty completion");
  } catch (err) {
    console.warn(`[intake-qa] AI unavailable, canned fallback: ${err instanceof Error ? err.message : String(err)}`);
    // Don't repeat the fallback back-to-back.
    const lastAssistant = assistantMsgs.at(-1)?.content ?? "";
    if (lastAssistant.startsWith(FALLBACK_REPLY.slice(0, 20))) {
      return { replies: [], shouldRespond: false };
    }
    return { replies: [FALLBACK_REPLY], shouldRespond: true, replyKind: "ai" };
  }

  // Assemble suffixes FIRST, then truncate the answer to what's left, so the
  // whole thing is exactly one SMS (<= SMS_MAX_CHARS). STOP line and nudge are
  // never chopped by truncation.
  const historyHasLink = assistantMsgs.some((m) => /https?:\/\//.test(m.content));
  const wantsApply = /\bapply\b|\bapplication\b/i.test(inbound);
  const nudge =
    (!historyHasLink && priorAssistant === 0) || wantsApply || (priorAssistant > 0 && priorAssistant % 3 === 0);

  const stopSuffix = priorAssistant === 0 ? "\nText STOP to opt out." : "";
  const nudgeSuffix = nudge && !answer.includes(ctx.link) ? ` You can apply here: ${ctx.link}` : "";
  const reserved = stopSuffix.length + nudgeSuffix.length;

  const body = toSingleSms(answer, Math.max(80, SMS_MAX_CHARS - reserved));
  const reply = `${body}${nudgeSuffix}${stopSuffix}`;

  return { replies: [reply], shouldRespond: true, replyKind: "ai" };
}
