import type * as vscode from "vscode";
import { getBridgeConfig, joinUrl } from "./config";
import {
  applyModelMetadata,
  firstMatchingPatternIndex,
  formatModelTooltip,
  matchesModelPattern,
  toOllamaModel,
  type OllamaShowResponse
} from "./modelMetadata";
import { readOpenAiStream, type OpenAiStreamPart } from "./openAiStream";
import type { BridgeConfig, BridgeConnectionConfig, ChatCompletionPayload, OllamaModel, SecretProvider } from "./types";

interface OpenAiModelsResponse {
  data?: Array<{
    id?: string;
    object?: string;
    owned_by?: string;
  }>;
}

interface OllamaTagsResponse {
  models?: Array<{
    name?: string;
    model?: string;
    modified_at?: string;
    size?: number;
    digest?: string;
    details?: {
      family?: string;
      families?: string[];
      parameter_size?: string;
      quantization_level?: string;
      format?: string;
    };
  }>;
}

interface ListModelsOptions {
  forceRefresh?: boolean;
  token?: vscode.CancellationToken;
}

interface CachedModels {
  configKey: string;
  updatedAt: number;
  models: OllamaModel[];
}

interface ModelRoute {
  connection: BridgeConnectionConfig;
  modelId: string;
}

export interface BridgeDiagnostics {
  lastModelSource?: "cache" | "network" | "fallback";
  lastModelCount?: number;
  lastModelDiscoveryMs?: number;
  lastMetadataMs?: number;
  lastMetadataSuccesses?: number;
  lastMetadataFailures?: number;
  lastChatModel?: string;
  lastChatTimeToFirstTokenMs?: number;
  lastChatDurationMs?: number;
  lastChatCharacters?: number;
  lastChatToolCalls?: number;
  lastRetryCount?: number;
  lastError?: string;
}

const modelCacheKey = "ollamaCopilot.models.v1";
const routeSeparator = "::";

export class OllamaClient {
  private diagnostics: BridgeDiagnostics = {};

  public constructor(
    private readonly secrets: SecretProvider,
    private readonly state?: vscode.Memento
  ) {}

  public async hasApiKey(): Promise<boolean> {
    return Boolean(await this.secrets.getApiKey());
  }

  public getDiagnostics(): BridgeDiagnostics {
    return { ...this.diagnostics };
  }

  public async listModels(optionsOrToken?: vscode.CancellationToken | ListModelsOptions): Promise<OllamaModel[]> {
    const options = normalizeListModelsOptions(optionsOrToken);
    const config = getBridgeConfig();
    const startedAt = Date.now();
    const connections = config.connections.filter((connection) => connection.enabled);

    if (connections.length === 0) {
      return [];
    }

    const discovered = await Promise.all(
      connections.map((connection) => this.listConnectionModels(connection, config, options))
    );
    const models = prepareModels(discovered.flat(), config);

    this.diagnostics = {
      ...this.diagnostics,
      lastModelCount: models.length,
      lastModelDiscoveryMs: Date.now() - startedAt
    };

    return models;
  }

  public async showModel(
    modelId: string,
    connection: BridgeConnectionConfig,
    config: BridgeConfig,
    token?: vscode.CancellationToken
  ): Promise<OllamaShowResponse> {
    return this.requestJson<OllamaShowResponse>(
      joinUrl(connection.baseUrl, "/api/show"),
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model: modelId
        })
      },
      config,
      connection,
      token
    );
  }

  public async streamChatCompletion(
    payload: ChatCompletionPayload,
    onPart: (part: OpenAiStreamPart) => void,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const config = getBridgeConfig();
    const route = resolveModelRoute(payload.model ?? config.defaultModel, config);
    const startedAt = Date.now();
    let firstTokenAt: number | undefined;
    let characters = 0;
    let toolCalls = 0;
    const response = await this.fetchChatCompletion(
      {
        ...payload,
        model: route.modelId,
        stream: true
      },
      config,
      route.connection,
      token
    );

    if (!response.body) {
      throw new Error("Ollama returned an empty stream.");
    }

    await readOpenAiStream(
      response.body,
      (part) => {
        firstTokenAt ??= Date.now();

        if (part.type === "text") {
          characters += part.value.length;
        } else {
          toolCalls += 1;
        }

        onPart(part);
      },
      token
    );

    this.diagnostics = {
      ...this.diagnostics,
      lastChatModel: `${route.connection.label}: ${route.modelId}`,
      lastChatTimeToFirstTokenMs: firstTokenAt ? firstTokenAt - startedAt : undefined,
      lastChatDurationMs: Date.now() - startedAt,
      lastChatCharacters: characters,
      lastChatToolCalls: toolCalls
    };
  }

  private async fetchChatCompletion(
    payload: ChatCompletionPayload,
    config: BridgeConfig,
    connection: BridgeConnectionConfig,
    token?: vscode.CancellationToken
  ): Promise<Response> {
    const model = payload.model || config.defaultModel;
    if (!model) {
      throw new Error("No Ollama model was provided. Set 'ollamaCopilot.defaultModel' or send a model in the request.");
    }

    const requestUrl = joinUrl(connection.openaiBaseUrl, "/chat/completions");
    const requestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        ...payload,
        model
      })
    } satisfies RequestInit;

    const response = await this.requestWithRetries(requestUrl, requestInit, config, connection, token);

    if (!response.ok) {
      throw new Error(await createResponseError("Ollama chat request failed", response));
    }

    return response;
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    config: BridgeConfig,
    connection: BridgeConnectionConfig,
    token?: vscode.CancellationToken
  ): Promise<T> {
    const response = await this.request(url, init, config, connection, token);

    if (!response.ok) {
      throw new Error(await createResponseError(`Request failed for ${url}`, response));
    }

    return response.json() as Promise<T>;
  }

  private async request(
    url: string,
    init: RequestInit,
    config: BridgeConfig,
    connection: BridgeConnectionConfig,
    token?: vscode.CancellationToken
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    const cancellation = token?.onCancellationRequested(() => controller.abort());

    try {
      const apiKey = connection.requiresApiKey ? await this.secrets.getApiKey(connection.id) : undefined;
      const headers = new Headers(init.headers);

      if (apiKey) {
        headers.set("authorization", `Bearer ${apiKey}`);
      }

      return await fetch(url, {
        ...init,
        headers,
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
      cancellation?.dispose();
    }
  }

  private async requestWithRetries(
    url: string,
    init: RequestInit,
    config: BridgeConfig,
    connection: BridgeConnectionConfig,
    token?: vscode.CancellationToken
  ): Promise<Response> {
    let lastError: unknown;
    const maxAttempts = Math.max(1, config.retryMaxAttempts);
    let retryCount = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (token?.isCancellationRequested) {
        throw new Error("Ollama request was cancelled.");
      }

      try {
        const response = await this.request(url, init, config, connection, token);

        if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
          this.diagnostics = {
            ...this.diagnostics,
            lastRetryCount: retryCount
          };
          return response;
        }

        retryCount += 1;
        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        const delayMs = retryAfter ?? calculateBackoffMs(config.retryBaseDelayMs, attempt);
        await response.arrayBuffer().catch(() => undefined);
        await delay(delayMs, token);
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || token?.isCancellationRequested) {
          this.diagnostics = {
            ...this.diagnostics,
            lastRetryCount: retryCount,
            lastError: formatError(error)
          };
          throw error;
        }

        retryCount += 1;
        await delay(calculateBackoffMs(config.retryBaseDelayMs, attempt), token);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async enrichModels(
    models: OllamaModel[],
    config: BridgeConfig,
    connection: BridgeConnectionConfig,
    token?: vscode.CancellationToken
  ): Promise<OllamaModel[]> {
    const startedAt = Date.now();
    const enriched: OllamaModel[] = new Array(models.length);
    let successes = 0;
    let failures = 0;
    let nextIndex = 0;
    const workerCount = Math.max(1, Math.min(config.metadataConcurrency, models.length));

    const worker = async (): Promise<void> => {
      if (token?.isCancellationRequested) {
        return;
      }

      const index = nextIndex;
      nextIndex += 1;

      if (index >= models.length) {
        return;
      }

      const model = models[index];

      try {
        const metadata = await this.showModel(model.providerModelId ?? model.id, connection, config, token);
        enriched[index] = applyModelMetadata(model, metadata, config);
        successes += 1;
      } catch (error) {
        enriched[index] = model;
        failures += 1;
        this.diagnostics = {
          ...this.diagnostics,
          lastError: formatError(error)
        };
      }

      await worker();
    };

    await Promise.all(Array.from({ length: workerCount }, () => worker()));

    this.diagnostics = {
      ...this.diagnostics,
      lastMetadataMs: Date.now() - startedAt,
      lastMetadataSuccesses: successes,
      lastMetadataFailures: failures
    };

    return enriched.filter(Boolean);
  }

  private async listConnectionModels(
    connection: BridgeConnectionConfig,
    config: BridgeConfig,
    options: ListModelsOptions
  ): Promise<OllamaModel[]> {
    const cacheKey = createCacheKey(config, connection);
    const cached = this.getCachedModels(cacheKey, config, connection);

    if (!options.forceRefresh && cached) {
      this.diagnostics = {
        ...this.diagnostics,
        lastModelSource: "cache"
      };
      return cached;
    }

    try {
      const response = await this.requestJson<OpenAiModelsResponse>(
        joinUrl(connection.openaiBaseUrl, "/models"),
        { method: "GET" },
        config,
        connection,
        options.token
      );

      const models = (response.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id))
        .map((id) => createConnectionModel(toOllamaModel(id, config), connection));

      if (models.length > 0) {
        const enriched = await this.enrichModels(sortModels(models, config), config, connection, options.token);
        const exposed = finalizeConnectionModels(enriched, connection);
        await this.setCachedModels(cacheKey, exposed, connection);
        this.diagnostics = { ...this.diagnostics, lastModelSource: "network" };
        return exposed;
      }
    } catch {
      // Some Ollama servers expose the native API but not the OpenAI-compatible model list.
    }

    try {
      const response = await this.requestJson<OllamaTagsResponse>(
        joinUrl(connection.baseUrl, "/api/tags"),
        { method: "GET" },
        config,
        connection,
        options.token
      );

      const models = (response.models ?? [])
        .map((model) => {
          const id = model.model ?? model.name;
          if (!id) {
            return undefined;
          }

          return createConnectionModel(
            toOllamaModel(id, config, {
              family: model.details?.family ?? model.details?.families?.[0],
              detail: connection.label,
              tooltip: formatModelTooltip(
                id,
                { ...config, baseUrl: connection.baseUrl },
                model.modified_at,
                model.details?.parameter_size,
                model.details?.quantization_level
              )
            }),
            connection
          );
        })
        .filter((model): model is OllamaModel => Boolean(model));

      if (models.length > 0) {
        const enriched = await this.enrichModels(sortModels(models, config), config, connection, options.token);
        const exposed = finalizeConnectionModels(enriched, connection);
        await this.setCachedModels(cacheKey, exposed, connection);
        this.diagnostics = { ...this.diagnostics, lastModelSource: "network" };
        return exposed;
      }
    } catch {
      // The fallback model can still be used when discovery is unavailable.
    }

    if (connection.primary && config.defaultModel) {
      const fallback = await this.enrichModels(
        [createConnectionModel(toOllamaModel(config.defaultModel, config, { detail: connection.label }), connection)],
        config,
        connection,
        options.token
      );
      this.diagnostics = { ...this.diagnostics, lastModelSource: "fallback" };
      return finalizeConnectionModels(fallback, connection);
    }

    return [];
  }

  private getCachedModels(
    cacheKey: string,
    config: BridgeConfig,
    connection: BridgeConnectionConfig
  ): OllamaModel[] | undefined {
    const cached = this.state?.get<CachedModels>(connectionCacheKey(connection));

    if (!cached || cached.configKey !== cacheKey) {
      return undefined;
    }

    if (Date.now() - cached.updatedAt > config.modelCacheTtlMs) {
      return undefined;
    }

    return cached.models;
  }

  private async setCachedModels(
    cacheKey: string,
    models: OllamaModel[],
    connection: BridgeConnectionConfig
  ): Promise<void> {
    await this.state?.update(connectionCacheKey(connection), {
      configKey: cacheKey,
      updatedAt: Date.now(),
      models
    } satisfies CachedModels);
  }
}

function prepareModels(models: OllamaModel[], config: BridgeConfig): OllamaModel[] {
  return sortModels(
    models.filter((model) => !matchesModelPattern(model.id, config.hiddenModels)),
    config
  );
}

function sortModels(models: OllamaModel[], config: BridgeConfig): OllamaModel[] {
  return [...models].sort((a, b) => {
    const aPinned = firstMatchingPatternIndex(a.id, config.pinnedModels);
    const bPinned = firstMatchingPatternIndex(b.id, config.pinnedModels);

    if (aPinned !== bPinned) {
      if (aPinned === -1) {
        return 1;
      }

      if (bPinned === -1) {
        return -1;
      }

      return aPinned - bPinned;
    }

    if (a.id === config.defaultModel) {
      return -1;
    }

    if (b.id === config.defaultModel) {
      return 1;
    }

    return a.id.localeCompare(b.id);
  });
}

function createConnectionModel(model: OllamaModel, connection: BridgeConnectionConfig): OllamaModel {
  return {
    ...model,
    providerModelId: model.providerModelId ?? model.id,
    connectionId: connection.id,
    connectionLabel: connection.label,
    detail: connection.label,
    tooltip: `${model.providerModelId ?? model.id} from ${connection.label} (${connection.baseUrl})`
  };
}

function finalizeConnectionModels(models: OllamaModel[], connection: BridgeConnectionConfig): OllamaModel[] {
  const prefix = connection.type === "cloud" ? "Cloud:" : "VPS:";

  return models.map((model) => {
    const providerModelId = model.providerModelId ?? model.id;

    return {
      ...model,
      id: connection.primary ? providerModelId : `${connection.id}${routeSeparator}${providerModelId}`,
      name: `${prefix}${model.name}`,
      providerModelId,
      connectionId: connection.id,
      connectionLabel: connection.label,
      detail: connection.label,
      tooltip: `${providerModelId} from ${connection.label} (${connection.baseUrl})`
    };
  });
}

function resolveModelRoute(modelId: string | undefined, config: BridgeConfig): ModelRoute {
  const fallback = config.connections.find((connection) => connection.primary) ?? config.connections[0];

  if (!fallback) {
    throw new Error("No enabled Ollama Bridge connection is configured.");
  }

  const id = modelId || config.defaultModel;
  const separatorIndex = id.indexOf(routeSeparator);

  if (separatorIndex > 0) {
    const connectionId = id.slice(0, separatorIndex);
    const providerModelId = id.slice(separatorIndex + routeSeparator.length);
    const connection = config.connections.find((candidate) => candidate.id === connectionId) ?? fallback;
    return { connection, modelId: providerModelId };
  }

  return { connection: fallback, modelId: id };
}

function connectionCacheKey(connection: BridgeConnectionConfig): string {
  return `${modelCacheKey}.${connection.id}`;
}

function createCacheKey(config: BridgeConfig, connection: BridgeConnectionConfig): string {
  return JSON.stringify({
    connectionId: connection.id,
    baseUrl: connection.baseUrl,
    openaiCompatiblePath: connection.openaiCompatiblePath,
    defaultModel: config.defaultModel,
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: config.maxOutputTokens,
    visionModels: config.visionModels
  });
}

function normalizeListModelsOptions(
  optionsOrToken?: vscode.CancellationToken | ListModelsOptions
): ListModelsOptions {
  if (!optionsOrToken) {
    return {};
  }

  if ("isCancellationRequested" in optionsOrToken) {
    return { token: optionsOrToken };
  }

  return optionsOrToken;
}

async function createResponseError(prefix: string, response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const detail = body ? `: ${body.slice(0, 1000)}` : "";
  return `${prefix} (${response.status} ${response.statusText})${detail}`;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status === 503 || status === 504;
}

function calculateBackoffMs(baseDelayMs: number, attempt: number): number {
  const exponentialDelay = Math.max(250, baseDelayMs) * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * 400);
  return Math.min(30000, exponentialDelay + jitter);
}

function parseRetryAfterMs(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1000);
  }

  const date = Date.parse(value);
  if (Number.isNaN(date)) {
    return undefined;
  }

  return Math.max(0, date - Date.now());
}

async function delay(ms: number, token?: vscode.CancellationToken): Promise<void> {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    let cancellation: vscode.Disposable | undefined;
    const finish = (): void => {
      clearTimeout(timeout);
      cancellation?.dispose();
      resolve();
    };
    const timeout = setTimeout(finish, ms);
    cancellation = token?.onCancellationRequested(finish);
  });
}
