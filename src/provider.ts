import * as vscode from "vscode";
import { getBridgeConfig } from "./config";
import { buildContextUsageSnapshot, type ContextUsageSnapshot } from "./contextUsage";
import type { OllamaClient } from "./ollamaClient";
import type {
  ChatCompletionPayload,
  OllamaModel,
  OpenAiChatContent,
  OpenAiContentPart,
  OpenAiMessage,
  OpenAiRole,
  OpenAiToolCall
} from "./types";

type ChatInfo = vscode.LanguageModelChatInformation & {
  requestMultiplier?: number;
};

export class OllamaLanguageModelProvider implements vscode.LanguageModelChatProvider<ChatInfo> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  private readonly contextUsageEmitter = new vscode.EventEmitter<ContextUsageSnapshot>();
  private cachedModels: ChatInfo[] | undefined;

  public readonly onDidChangeLanguageModelChatInformation = this.changeEmitter.event;
  public readonly onDidUpdateContextUsage = this.contextUsageEmitter.event;

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
    const inputText = messages.map((message) => messageContentToText(message.content)).join("\n");
    let outputText = "";
    const hasImages = messages.some((message) => hasImageParts(message.content));

    if (hasImages && !model.capabilities.imageInput) {
      throw vscode.LanguageModelError.Blocked(
        `${model.name} does not support image input. Select an Ollama Bridge model with vision capability before attaching images.`
      );
    }

    this.output.appendLine(
      `Chat request model: ${model.name} (${model.id}); tools=${options.tools?.length ?? 0}; toolMode=${String(options.toolMode)}`
    );

    this.contextUsageEmitter.fire(
      buildContextUsageSnapshot({
        modelId: model.id,
        modelName: model.name,
        maxInputTokens: model.maxInputTokens,
        maxOutputTokens: model.maxOutputTokens,
        requestMultiplier: model.requestMultiplier,
        inputText
      })
    );

    const payload: ChatCompletionPayload = {
      ...filterModelOptions(options.modelOptions),
      model: model.id,
      ...convertToolOptions(options),
      messages: messages.flatMap(convertMessage),
      stream: true
    };

    await this.client.streamChatCompletion(
      payload,
      (part) => {
        if (part.type === "text") {
          outputText += part.value;
          progress.report(new vscode.LanguageModelTextPart(part.value));
          return;
        }

        progress.report(
          new vscode.LanguageModelToolCallPart(part.value.callId, part.value.name, part.value.input)
        );
      },
      token
    );

    this.contextUsageEmitter.fire(
      buildContextUsageSnapshot({
        modelId: model.id,
        modelName: model.name,
        maxInputTokens: model.maxInputTokens,
        maxOutputTokens: model.maxOutputTokens,
        requestMultiplier: model.requestMultiplier,
        inputText,
        outputText
      })
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

function convertMessage(message: vscode.LanguageModelChatRequestMessage): OpenAiMessage[] {
  const content = messageContentToOpenAiContent(message.content, false);
  const text = openAiContentToText(content);
  const toolCalls = message.content.filter(isToolCallPart);
  const toolResults = message.content.filter(isToolResultPart);

  if (toolResults.length > 0) {
    const resultMessages = toolResults.map((part) => ({
      role: "tool" as const,
      content: toolResultContentToText(part.content),
      tool_call_id: part.callId,
      name: message.name
    }));

    return text.length > 0
      ? [
          {
            role: "user",
            content,
            name: message.name
          },
          ...resultMessages
        ]
      : resultMessages;
  }

  if (toolCalls.length > 0) {
    return [
      {
        role: "assistant",
        content: text.length > 0 ? text : null,
        name: message.name,
        tool_calls: toolCalls.map(toOpenAiToolCall)
      }
    ];
  }

  return [
    {
      role: convertRole(message.role),
      content,
      name: message.name
    }
  ];
}

function convertRole(role: vscode.LanguageModelChatMessageRole): Exclude<OpenAiRole, "tool"> {
  if (role === vscode.LanguageModelChatMessageRole.Assistant) {
    return "assistant";
  }

  return "user";
}

function messageContentToText(content: readonly unknown[], includeToolResults = true): string {
  return content
    .map((part) => {
      if (part instanceof vscode.LanguageModelTextPart) {
        return part.value;
      }

      if (includeToolResults && isToolResultPart(part)) {
        return toolResultContentToText(part.content);
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

function messageContentToOpenAiContent(
  content: readonly unknown[],
  includeToolResults = true
): OpenAiChatContent {
  const parts = content.flatMap((part): OpenAiContentPart[] => {
    if (part instanceof vscode.LanguageModelTextPart) {
      return part.value ? [{ type: "text", text: part.value }] : [];
    }

    if (includeToolResults && isToolResultPart(part)) {
      const text = toolResultContentToText(part.content);
      return text ? [{ type: "text", text }] : [];
    }

    if (isImageDataPart(part)) {
      return [
        {
          type: "image_url",
          image_url: {
            url: toDataUrl(part)
          }
        }
      ];
    }

    if (typeof part === "string") {
      return part ? [{ type: "text", text: part }] : [];
    }

    if (part && typeof part === "object" && "value" in part) {
      const value = (part as { value?: unknown }).value;
      return typeof value === "string" && value ? [{ type: "text", text: value }] : [];
    }

    return [];
  });

  if (parts.length === 0) {
    return "";
  }

  if (parts.every((part) => part.type === "text")) {
    return parts.map((part) => part.text).join("");
  }

  return parts;
}

function openAiContentToText(content: OpenAiChatContent): string {
  if (typeof content === "string") {
    return content;
  }

  if (!content) {
    return "";
  }

  return content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function toolResultContentToText(content: readonly unknown[]): string {
  return content.map(contentPartToText).filter(Boolean).join("\n");
}

function contentPartToText(part: unknown): string {
  if (part instanceof vscode.LanguageModelTextPart) {
    return part.value;
  }

  if (typeof part === "string") {
    return part;
  }

  if (part && typeof part === "object" && "value" in part) {
    const value = (part as { value?: unknown }).value;
    if (typeof value === "string") {
      return value;
    }
  }

  try {
    return JSON.stringify(part);
  } catch {
    return "";
  }
}

function toOpenAiToolCall(part: vscode.LanguageModelToolCallPart): OpenAiToolCall {
  return {
    id: part.callId,
    type: "function",
    function: {
      name: part.name,
      arguments: JSON.stringify(part.input ?? {})
    }
  };
}

function isToolCallPart(part: unknown): part is vscode.LanguageModelToolCallPart {
  return (
    part instanceof vscode.LanguageModelToolCallPart ||
    Boolean(
      part &&
        typeof part === "object" &&
        "callId" in part &&
        "name" in part &&
        "input" in part &&
        !("content" in part)
    )
  );
}

function isToolResultPart(part: unknown): part is vscode.LanguageModelToolResultPart {
  return (
    part instanceof vscode.LanguageModelToolResultPart ||
    Boolean(
      part &&
        typeof part === "object" &&
        "callId" in part &&
        "content" in part &&
        Array.isArray((part as { content?: unknown }).content)
    )
  );
}

function hasImageParts(content: readonly unknown[]): boolean {
  return content.some(isImageDataPart);
}

function isImageDataPart(part: unknown): part is vscode.LanguageModelDataPart {
  return isDataPart(part) && part.mimeType.toLowerCase().startsWith("image/");
}

function isDataPart(part: unknown): part is vscode.LanguageModelDataPart {
  return (
    part instanceof vscode.LanguageModelDataPart ||
    Boolean(
      part &&
        typeof part === "object" &&
        "mimeType" in part &&
        typeof (part as { mimeType?: unknown }).mimeType === "string" &&
        "data" in part &&
        (part as { data?: unknown }).data instanceof Uint8Array
    )
  );
}

function toDataUrl(part: vscode.LanguageModelDataPart): string {
  return `data:${part.mimeType};base64,${Buffer.from(part.data).toString("base64")}`;
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
