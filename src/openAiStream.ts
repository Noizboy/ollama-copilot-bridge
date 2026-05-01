export interface BridgeToolCall {
  callId: string;
  name: string;
  input: object;
}

export type OpenAiStreamPart =
  | {
      type: "text";
      value: string;
    }
  | {
      type: "toolCall";
      value: BridgeToolCall;
    };

interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
}

interface ToolCallDraft {
  index: number;
  id?: string;
  name?: string;
  argumentsText: string;
  emitted: boolean;
}

type StreamPartHandler = (part: OpenAiStreamPart) => void;

export async function readOpenAiStream(
  body: ReadableStream<Uint8Array>,
  onPart: StreamPartHandler,
  token?: CancellationTokenLike
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const accumulator = new ToolCallAccumulator();
  let buffer = "";

  try {
    while (true) {
      if (token?.isCancellationRequested) {
        await reader.cancel();
        return;
      }

      const { value, done } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      buffer = drainServerSentEvents(buffer, accumulator, onPart);
    }

    buffer += decoder.decode();
    drainServerSentEvents(`${buffer}\n\n`, accumulator, onPart);
    accumulator.flush(onPart);
  } finally {
    reader.releaseLock();
  }
}

export function parseToolArguments(argumentsText: string): object {
  const trimmed = argumentsText.trim();
  if (!trimmed) {
    return {};
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object") {
      return parsed;
    }

    return { value: parsed };
  } catch {
    return { rawArguments: argumentsText };
  }
}

function drainServerSentEvents(
  buffer: string,
  accumulator: ToolCallAccumulator,
  onPart: StreamPartHandler
): string {
  let boundary = buffer.indexOf("\n\n");

  while (boundary >= 0) {
    const event = buffer.slice(0, boundary);
    buffer = buffer.slice(boundary + 2);
    handleServerSentEvent(event, accumulator, onPart);
    boundary = buffer.indexOf("\n\n");
  }

  return buffer;
}

function handleServerSentEvent(
  event: string,
  accumulator: ToolCallAccumulator,
  onPart: StreamPartHandler
): void {
  const dataLines = event
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice("data:".length).trim());

  for (const data of dataLines) {
    if (!data) {
      continue;
    }

    if (data === "[DONE]") {
      accumulator.flush(onPart);
      continue;
    }

    try {
      const parsed = JSON.parse(data) as unknown;
      handleParsedPayload(parsed, accumulator, onPart);
    } catch {
      // Ignore malformed keepalive chunks.
    }
  }
}

function handleParsedPayload(
  payload: unknown,
  accumulator: ToolCallAccumulator,
  onPart: StreamPartHandler
): void {
  const record = asRecord(payload);
  if (!record) {
    return;
  }

  const choices = asArray(record.choices);
  if (choices) {
    for (const choiceValue of choices) {
      const choice = asRecord(choiceValue);
      if (!choice) {
        continue;
      }

      const delta = asRecord(choice.delta) ?? asRecord(choice.message);
      if (delta) {
        reportText(delta.content, onPart);
        accumulator.add(delta.tool_calls);
      }

      reportText(choice.text, onPart);

      if (choice.finish_reason) {
        accumulator.flush(onPart);
      }
    }

    return;
  }

  const message = asRecord(record.message);
  if (message) {
    reportText(message.content, onPart);
    accumulator.add(message.tool_calls);
  }

  accumulator.add(record.tool_calls);
  reportText(record.response, onPart);
}

class ToolCallAccumulator {
  private readonly drafts = new Map<number, ToolCallDraft>();

  public add(value: unknown): void {
    const toolCalls = asArray(value);
    if (!toolCalls) {
      return;
    }

    for (let fallbackIndex = 0; fallbackIndex < toolCalls.length; fallbackIndex += 1) {
      const chunk = asRecord(toolCalls[fallbackIndex]);
      if (!chunk) {
        continue;
      }

      const index = numberValue(chunk.index) ?? fallbackIndex;
      const draft = this.drafts.get(index) ?? {
        index,
        argumentsText: "",
        emitted: false
      };

      draft.id = stringValue(chunk.id) ?? draft.id;

      const functionChunk = asRecord(chunk.function);
      const name = stringValue(functionChunk?.name);
      if (name) {
        draft.name = draft.name && draft.name !== name ? `${draft.name}${name}` : name;
      }

      const argumentsText = argumentValue(functionChunk?.arguments);
      if (argumentsText) {
        draft.argumentsText += argumentsText;
      }

      this.drafts.set(index, draft);
    }
  }

  public flush(onPart: StreamPartHandler): void {
    const drafts = [...this.drafts.values()].sort((a, b) => a.index - b.index);

    for (const draft of drafts) {
      if (draft.emitted || !draft.name) {
        continue;
      }

      draft.emitted = true;
      onPart({
        type: "toolCall",
        value: {
          callId: draft.id ?? `call_${draft.index}`,
          name: draft.name,
          input: parseToolArguments(draft.argumentsText)
        }
      });
    }
  }
}

function reportText(value: unknown, onPart: StreamPartHandler): void {
  if (typeof value === "string" && value.length > 0) {
    onPart({ type: "text", value });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function argumentValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (value === undefined || value === null) {
    return undefined;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}
