import * as vscode from "vscode";
import { getBridgeConfig } from "./config";
import type { OllamaClient } from "./ollamaClient";
import type { ChatCompletionPayload, OllamaModel, OpenAiMessage, OpenAiRole } from "./types";

type ChatInfo = vscode.LanguageModelChatInformation & {
  requestMultiplier?: number;
};

export class OllamaLanguageModelProvider implements vscode.LanguageModelChatProvider<ChatInfo> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private cachedModels: ChatInfo[] | undefined;

  public readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;

  public constructor(
    private readonly client: OllamaClient,
    private readonly output: vscode.OutputChannel
  ) {}

  public refresh(): void {
    this.cachedModels = undefined;
    this.changeEmitter.fire();
  }

  public async provideLanguageModelChatInformation(
    options: vscode.PrepareLanguageModelChatModelOptions,
    token: vscode.CancellationToken
  ): Promise<ChatInfo[]> {
    const config = getBridgeConfig();

    if (!config.enabled) {
      return [];
    }

    if (this.cachedModels) {
      return this.cachedModels;
    }

    try {
      const models = await this.client.listModels(token);
      this.cachedModels = models.map(toChatInfo);
      return this.cachedModels;
    } catch (error) {
      this.output.appendLine(`Failed to discover Ollama models: ${formatError(error)}`);

      if (!options.silent) {
        void vscode.window.showWarningMessage(
          "Ollama Copilot Bridge could not discover models. Check your API key and base URL, then run 'Ollama Copilot: Refresh Models'."
        );
      }

      if (config.defaultModel) {
        return [
          toChatInfo({
            id: config.defaultModel,
            name: config.defaultModel,
            family: inferFamily(config.defaultModel),
            version: "local",
            maxInputTokens: config.maxInputTokens,
            maxOutputTokens: config.maxOutputTokens,
            requestMultiplier: 1,
            supportsTools: true,
            supportsImages: false,
            detail: "Configured",
            tooltip: `${config.defaultModel} through ${config.baseUrl}`
          })
        ];
      }

      return [];
    }
  }

  public async provideLanguageModelChatResponse(
    model: ChatInfo,
    messages: readonly vscode.LanguageModelChatRequestMessage[],
    options: vscode.ProvideLanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const payload: ChatCompletionPayload = {
      ...filterModelOptions(options.modelOptions),
      model: model.id,
      ...convertToolOptions(options),
      messages: messages.map(convertMessage),
      stream: true
    };

    await this.client.streamChatCompletion(
      payload,
      (text) => progress.report(new vscode.LanguageModelTextPart(text)),
      token
    );
  }

  public async provideTokenCount(
    _model: ChatInfo,
    text: string | vscode.LanguageModelChatRequestMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    const value = typeof text === "string" ? text : messageContentToText(text.content);
    return Math.max(1, Math.ceil(value.length / 4));
  }
}

function toChatInfo(model: OllamaModel): ChatInfo {
  return {
    id: model.id,
    name: model.name,
    family: model.family,
    version: model.version,
    maxInputTokens: model.maxInputTokens,
    maxOutputTokens: model.maxOutputTokens,
    requestMultiplier: model.requestMultiplier,
    detail: model.detail,
    tooltip: model.tooltip,
    capabilities: {
      imageInput: model.supportsImages,
      toolCalling: model.supportsTools ? 128 : false
    }
  };
}

function convertToolOptions(
  options: vscode.ProvideLanguageModelChatResponseOptions
): Record<string, unknown> {
  if (!options.tools || options.tools.length === 0) {
    return {};
  }

  const tools = options.tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? {
        type: "object",
        properties: {}
      }
    }
  }));

  return {
    tools,
    tool_choice:
      options.toolMode === vscode.LanguageModelChatToolMode.Required
        ? "required"
        : "auto"
  };
}

function convertMessage(message: vscode.LanguageModelChatRequestMessage): OpenAiMessage {
  return {
    role: convertRole(message.role),
    content: messageContentToText(message.content),
    name: message.name
  };
}

function convertRole(role: vscode.LanguageModelChatMessageRole): OpenAiRole {
  if (role === vscode.LanguageModelChatMessageRole.Assistant) {
    return "assistant";
  }

  return "user";
}

function messageContentToText(content: readonly unknown[]): string {
  return content
    .map((part) => {
      if (part instanceof vscode.LanguageModelTextPart) {
        return part.value;
      }

      if (typeof part === "string") {
        return part;
      }

      if (part && typeof part === "object" && "value" in part) {
        const value = (part as { value?: unknown }).value;
        return typeof value === "string" ? value : "";
      }

      return "";
    })
    .join("");
}

function filterModelOptions(modelOptions: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!modelOptions) {
    return {};
  }

  const allowed = new Set([
    "temperature",
    "top_p",
    "top_k",
    "max_tokens",
    "presence_penalty",
    "frequency_penalty",
    "stop",
    "seed"
  ]);

  return Object.fromEntries(
    Object.entries(modelOptions).filter(([key, value]) => allowed.has(key) && value !== undefined)
  );
}

function inferFamily(id: string): string {
  const family = (id.split(":")[0] ?? id).replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase();
  return family || "ollama";
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
