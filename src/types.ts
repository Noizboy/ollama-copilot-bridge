export type OpenAiRole = "system" | "user" | "assistant" | "tool";

export interface OpenAiToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export type OpenAiChatContent = string | OpenAiContentPart[] | null;

export type OpenAiContentPart =
  | {
      type: "text";
      text: string;
    }
  | {
      type: "image_url";
      image_url: {
        url: string;
      };
    };

export interface OpenAiChatMessage {
  role: Exclude<OpenAiRole, "tool">;
  content: OpenAiChatContent;
  name?: string;
  tool_calls?: OpenAiToolCall[];
}

export interface OpenAiToolMessage {
  role: "tool";
  content: string;
  tool_call_id: string;
  name?: string;
}

export type OpenAiMessage = OpenAiChatMessage | OpenAiToolMessage;

export interface ChatCompletionPayload {
  model?: string;
  messages?: OpenAiMessage[];
  stream?: boolean;
  [key: string]: unknown;
}

export interface OllamaModel {
  id: string;
  name: string;
  family: string;
  version: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  requestMultiplier: number;
  supportsTools: boolean;
  supportsImages: boolean;
  detail?: string;
  tooltip?: string;
}

export interface BridgeConfig {
  enabled: boolean;
  baseUrl: string;
  openaiCompatiblePath: string;
  openaiBaseUrl: string;
  defaultModel: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  requestTimeoutMs: number;
  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  visionModels: string[];
}

export interface SecretProvider {
  getApiKey(): Thenable<string | undefined>;
}
