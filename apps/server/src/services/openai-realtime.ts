import WebSocket from "ws";
import type { TranscriptEntry } from "@tenant-ai/shared";

export interface OpenAISessionConfig {
  model: string;
  voice: string;
  instructions: string;
  tools: unknown[];
}

/**
 * Open a WebSocket connection to OpenAI Realtime API.
 */
export function connectToOpenAI(
  config: OpenAISessionConfig & { apiKey?: string },
  callbacks: {
    onAudioDelta: (base64Audio: string) => void;
    onTranscript: (entry: TranscriptEntry) => void;
    onFunctionCall: (
      name: string,
      callId: string,
      args: Record<string, string>,
    ) => void;
    onError: (error: Error) => void;
    onClose: (code: number, reason: string) => void;
  },
): WebSocket {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OpenAI API key not configured. Set it in Admin > Integrations or via OPENAI_API_KEY env var.");
  }

  // GA realtime API — the beta protocol ("OpenAI-Beta: realtime=v1" + flat
  // session shape) was retired by OpenAI (beta_api_shape_disabled) and GA-era
  // models (gpt-realtime*) reject it outright.
  const url = `wss://api.openai.com/v1/realtime?model=${config.model}`;
  const ws = new WebSocket(url, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
  });

  ws.on("open", () => {
    // Send session.update to configure the session (GA shape: audio config is
    // nested; g711 μ-law is "audio/pcmu"; voice lives under audio.output)
    const sessionUpdate = {
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            turn_detection: { type: "server_vad" },
            transcription: { model: "whisper-1" },
          },
          output: {
            format: { type: "audio/pcmu" },
            voice: config.voice,
          },
        },
        tools: config.tools,
        instructions: config.instructions,
      },
    };
    ws.send(JSON.stringify(sessionUpdate));

    // Trigger the AI to speak first (greet the caller immediately)
    ws.send(JSON.stringify({ type: "response.create" }));
  });

  ws.on("message", (data: Buffer) => {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case "response.output_audio.delta": // GA name
        case "response.audio.delta": // legacy name, kept as fallback
          if (event.delta) callbacks.onAudioDelta(event.delta);
          break;

        case "response.output_audio_transcript.done": // GA name
        case "response.audio_transcript.done": // legacy fallback
          callbacks.onTranscript({
            role: "ai",
            content: event.transcript,
            timestamp: new Date(),
          });
          break;

        case "conversation.item.input_audio_transcription.completed":
          callbacks.onTranscript({
            role: "user",
            content: event.transcript,
            timestamp: new Date(),
          });
          break;

        case "response.function_call_arguments.done":
          try {
            const args = JSON.parse(event.arguments);
            callbacks.onFunctionCall(event.name, event.call_id, args);
          } catch {
            callbacks.onError(
              new Error(
                `Failed to parse function call arguments: ${event.arguments}`,
              ),
            );
          }
          break;

        case "error":
          callbacks.onError(
            new Error(event.error?.message || "OpenAI error"),
          );
          break;
      }
    } catch (err) {
      callbacks.onError(
        err instanceof Error ? err : new Error(String(err)),
      );
    }
  });

  ws.on("error", (err) => {
    callbacks.onError(err);
  });

  ws.on("close", (code, reason) => {
    callbacks.onClose(code, reason.toString());
  });

  return ws;
}

/**
 * Send a function call result back to OpenAI.
 */
export function sendFunctionResult(
  ws: WebSocket,
  callId: string,
  output: string,
): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: callId,
        output,
      },
    }),
  );

  // Trigger a response after providing function output
  ws.send(JSON.stringify({ type: "response.create" }));
}

/**
 * Inject a system-level instruction into the conversation (e.g., wrap-up notice).
 */
export function sendSystemEvent(ws: WebSocket, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "system",
        content: [{ type: "input_text", text }],
      },
    }),
  );

  ws.send(JSON.stringify({ type: "response.create" }));
}

/**
 * Inject applicant-provided text (e.g. a mid-call SMS answer) into the
 * conversation as a user message. Silent no-op on a closed socket so the SMS
 * pipeline can never throw through a dead call.
 */
export function sendUserText(ws: WebSocket, text: string): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    }),
  );

  ws.send(JSON.stringify({ type: "response.create" }));
}

/**
 * Send audio from Twilio to OpenAI.
 */
export function sendAudioToOpenAI(
  ws: WebSocket,
  base64Audio: string,
): void {
  if (ws.readyState !== WebSocket.OPEN) return;

  ws.send(
    JSON.stringify({
      type: "input_audio_buffer.append",
      audio: base64Audio,
    }),
  );
}
