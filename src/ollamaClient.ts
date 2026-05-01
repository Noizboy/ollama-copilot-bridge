import type * as vscode from "vscode";
import { getBridgeConfig, joinUrl } from "./config";
import { applyModelMetadata, formatModelTooltip, toOllamaModel, type OllamaShowResponse } from "./modelMetadata";
import { readOpenAiStream, type OpenAiStreamPart } from "./openAiStream";
import type { BridgeConfig, ChatCompletionPayload, OllamaModel, SecretProvider } from "./types";

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

export class OllamaClient {
  public constructor(private readonly secrets: SecretProvider) {}

  public async hasApiKey(): Promise<boolean> {
    return Boolean(await this.secrets.getApiKey());
  }

  public async listModels(token?: vscode.CancellationToken): Promise<OllamaModel[]> {
    const config = getBridgeConfig();

    try {
      const response = await this.requestJson<OpenAiModelsResponse>(
        joinUrl(config.openaiBaseUrl, "/models"),
        { method: "GET" },
        config,
        token
      );

      const models = (response.data ?? [])
        .map((model) => model.id)
        .filter((id): id is string => Boolean(id))
        .map((id) => toOllamaModel(id, config));

      if (models.length > 0) {
        return this.enrichModels(sortModels(models, config.defaultModel), config, token);
      }
    } catch {
      // Older Ollama installations may expose only the native API.
    }

    try {
      const response = await this.requestJson<OllamaTagsResponse>(
        joinUrl(config.baseUrl, "/api/tags"),
        { method: "GET" },
        config,
        token
      );

      const models = (response.models ?? [])
        .map((model) => {
          const id = model.model ?? model.name;
          if (!id) {
            return undefined;
          }

          return toOllamaModel(id, config, {
            family: model.details?.family ?? model.details?.families?.[0],
            detail: "Ollama Bridge",
            tooltip: formatModelTooltip(
              id,
              config,
              model.modified_at,
              model.details?.parameter_size,
              model.details?.quantization_level
            )
          });
        })
        .filter((model): model is OllamaModel => Boolean(model));

      if (models.length > 0) {
        return this.enrichModels(sortModels(models, config.defaultModel), config, token);
      }
    } catch {
      // Cloud accounts can still use a manually configured model even if listing is unavailable.
    }

    if (config.defaultModel) {
      return this.enrichModels(
        [toOllamaModel(config.defaultModel, config, { detail: "Ollama Bridge" })],
        config,
        token
      );
    }

    return [];
  }

  public async showModel(modelId: string, token?: vscode.CancellationToken): Promise<OllamaShowResponse> {
    const config = getBridgeConfig();
    return this.requestJson<OllamaShowResponse>(
      joinUrl(config.baseUrl, "/api/show"),
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
      token
    );
  }

  public async streamChatCompletion(
    payload: ChatCompletionPayload,
    onPart: (part: OpenAiStreamPart) => void,
    token?: vscode.CancellationToken
  ): Promise<void> {
    const config = getBridgeConfig();
    const response = await this.fetchChatCompletion(
      {
        ...payload,
        stream: true
      },
      config,
      token
    );

    if (!response.body) {
      throw new Error("Ollama returned an empty stream.");
    }

    await readOpenAiStream(response.body, onPart, token);
  }

  private async fetchChatCompletion(
    payload: ChatCompletionPayload,
    config = getBridgeConfig(),
    token?: vscode.CancellationToken
  ): Promise<Response> {
    const model = payload.model || config.defaultModel;
    if (!model) {
      throw new Error("No Ollama model was provided. Set 'ollamaCopilot.defaultModel' or send a model in the request.");
    }

    const requestUrl = joinUrl(config.openaiBaseUrl, "/chat/completions");
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

    const response = await this.requestWithRetries(requestUrl, requestInit, config, token);

    if (!response.ok) {
      throw new Error(await createResponseError("Ollama chat request failed", response));
    }

    return response;
  }

  private async requestJson<T>(
    url: string,
    init: RequestInit,
    config: BridgeConfig,
    token?: vscode.CancellationToken
  ): Promise<T> {
    const response = await this.request(url, init, config, token);

    if (!response.ok) {
      throw new Error(await createResponseError(`Request failed for ${url}`, response));
    }

    return response.json() as Promise<T>;
  }

  private async request(
    url: string,
    init: RequestInit,
    config: BridgeConfig,
    token?: vscode.CancellationToken
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);
    const cancellation = token?.onCancellationRequested(() => controller.abort());

    try {
      const apiKey = await this.secrets.getApiKey();
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
    token?: vscode.CancellationToken
  ): Promise<Response> {
    let lastError: unknown;
    const maxAttempts = Math.max(1, config.retryMaxAttempts);

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      if (token?.isCancellationRequested) {
        throw new Error("Ollama request was cancelled.");
      }

      try {
        const response = await this.request(url, init, config, token);

        if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
          return response;
        }

        const retryAfter = parseRetryAfterMs(response.headers.get("retry-after"));
        const delayMs = retryAfter ?? calculateBackoffMs(config.retryBaseDelayMs, attempt);
        await response.arrayBuffer().catch(() => undefined);
        await delay(delayMs, token);
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts || token?.isCancellationRequested) {
          throw error;
        }

        await delay(calculateBackoffMs(config.retryBaseDelayMs, attempt), token);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async enrichModels(
    models: OllamaModel[],
    config: BridgeConfig,
    token?: vscode.CancellationToken
  ): Promise<OllamaModel[]> {
    const enriched: OllamaModel[] = [];

    for (const model of models) {
      if (token?.isCancellationRequested) {
        return enriched;
      }

      try {
        const metadata = await this.showModel(model.id, token);
        enriched.push(applyModelMetadata(model, metadata, config));
      } catch {
        enriched.push(model);
      }
    }

    return enriched;
  }
}

function sortModels(models: OllamaModel[], preferredModel: string): OllamaModel[] {
  return [...models].sort((a, b) => {
    if (a.id === preferredModel) {
      return -1;
    }

    if (b.id === preferredModel) {
      return 1;
    }

    return a.id.localeCompare(b.id);
  });
}

async function createResponseError(prefix: string, response: Response): Promise<string> {
  const body = await response.text().catch(() => "");
  const detail = body ? `: ${body.slice(0, 1000)}` : "";
  return `${prefix} (${response.status} ${response.statusText})${detail}`;
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
