export type OpenAiRole = "system" | "user" | "assistant" | "tool";

export interface OpenAiMessage {
  role: OpenAiRole;
  content: string;
  name?: string;
}

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
}

export interface SecretProvider {
  getApiKey(): Thenable<string | undefined>;
}
