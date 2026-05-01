import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseToolArguments, readOpenAiStream, type OpenAiStreamPart } from "../src/openAiStream";

describe("OpenAI-compatible stream parser", () => {
  it("streams text deltas", async () => {
    const parts = await collectParts([
      sse({ choices: [{ delta: { content: "Hel" } }] }),
      sse({ choices: [{ delta: { content: "lo" }, finish_reason: "stop" }] }),
      "data: [DONE]\n\n"
    ]);

    assert.deepEqual(parts, [
      { type: "text", value: "Hel" },
      { type: "text", value: "lo" }
    ]);
  });

  it("accumulates streamed tool call arguments", async () => {
    const parts = await collectParts([
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_123",
                  type: "function",
                  function: {
                    name: "run_terminal_command",
                    arguments: "{\"command\":\"npm"
                  }
                }
              ]
            }
          }
        ]
      }),
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: " test\"}"
                  }
                }
              ]
            },
            finish_reason: "tool_calls"
          }
        ]
      })
    ]);

    assert.deepEqual(parts, [
      {
        type: "toolCall",
        value: {
          callId: "call_123",
          name: "run_terminal_command",
          input: { command: "npm test" }
        }
      }
    ]);
  });

  it("accepts full tool calls in a message payload", async () => {
    const parts = await collectParts([
      sse({
        choices: [
          {
            message: {
              tool_calls: [
                {
                  id: "call_456",
                  type: "function",
                  function: {
                    name: "open_terminal",
                    arguments: "{\"cwd\":\"C:/repo\"}"
                  }
                }
              ]
            },
            finish_reason: "tool_calls"
          }
        ]
      })
    ]);

    assert.deepEqual(parts, [
      {
        type: "toolCall",
        value: {
          callId: "call_456",
          name: "open_terminal",
          input: { cwd: "C:/repo" }
        }
      }
    ]);
  });

  it("keeps malformed tool arguments as raw text", () => {
    assert.deepEqual(parseToolArguments("{oops"), { rawArguments: "{oops" });
  });
});

async function collectParts(chunks: string[]): Promise<OpenAiStreamPart[]> {
  const parts: OpenAiStreamPart[] = [];
  await readOpenAiStream(textStream(chunks), (part) => parts.push(part));
  return parts;
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function textStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }

      controller.close();
    }
  });
}
