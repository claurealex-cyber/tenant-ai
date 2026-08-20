import { SMS_MAX_CHARS, resolveConfig } from "@tenant-ai/shared";

interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
}

interface FunctionCall {
  id: string;
  name: string;
  arguments: string;
}

interface ChatResponse {
  content: string | null;
  functionCalls: FunctionCall[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assistantMessage?: any;
}

/**
 * Call OpenAI Chat Completions API for SMS conversations.
 */
export async function callChatAPI(
  systemPrompt: string,
  messages: ChatMessage[],
  tools: unknown[],
): Promise<ChatResponse> {
  const apiKey = await resolveConfig("openai", "api_key");
  if (!apiKey) {
    throw new Error("OpenAI API key not configured. Set it in Admin > Integrations or via OPENAI_API_KEY env var.");
  }

  const model = await resolveConfig("openai", "sms_model", "gpt-4o-mini") || "gpt-4o-mini";

  const chatMessages: any[] = [
    { role: "system", content: systemPrompt },
    ...messages.map((m) => {
      if (m.role === "tool" && m.tool_call_id) {
        return { role: "tool", content: m.content, tool_call_id: m.tool_call_id };
      }
      return { role: m.role, content: m.content };
    }),
  ];

  // Format tools for Chat API
  const chatTools = tools.map((t: any) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  const response = await fetch(
    "https://api.openai.com/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: chatMessages,
        tools: chatTools.length > 0 ? chatTools : undefined,
        tool_choice: "auto",
      }),
      signal: AbortSignal.timeout(25_000),
    },
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenAI API error: ${response.status} ${error}`);
  }

  const data: any = await response.json();
  const choice = data.choices?.[0];

  if (!choice) {
    throw new Error("No response from OpenAI");
  }

  const functionCalls: FunctionCall[] = [];

  if (choice.message?.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      if (tc.type === "function") {
        functionCalls.push({
          id: tc.id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        });
      }
    }
  }

  return {
    content: choice.message?.content ?? null,
    functionCalls,
    // Expose the raw assistant message so callers can append it for tool-call loops
    assistantMessage: choice.message,
  };
}

/**
 * Split a long SMS response at sentence boundaries.
 * Returns an array of message segments, each under SMS_MAX_CHARS.
 */
export function splitSmsResponse(text: string): string[] {
  if (text.length <= SMS_MAX_CHARS) {
    return [text];
  }

  const segments: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= SMS_MAX_CHARS) {
      segments.push(remaining);
      break;
    }

    // Find the last sentence boundary within the limit
    let splitIdx = -1;
    for (let i = SMS_MAX_CHARS - 1; i >= 0; i--) {
      if (
        remaining[i] === "." ||
        remaining[i] === "!" ||
        remaining[i] === "?"
      ) {
        splitIdx = i + 1;
        break;
      }
    }

    // If no sentence boundary found, split at last space
    if (splitIdx === -1) {
      for (let i = SMS_MAX_CHARS - 1; i >= 0; i--) {
        if (remaining[i] === " ") {
          splitIdx = i;
          break;
        }
      }
    }

    // If still no good split point, force split
    if (splitIdx === -1) {
      splitIdx = SMS_MAX_CHARS;
    }

    segments.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  return segments;
}
