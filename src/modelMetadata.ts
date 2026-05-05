import type { BridgeConfig, OllamaModel } from "./types";

export interface OllamaShowResponse {
  parameters?: string;
  capabilities?: string[];
  modified_at?: string;
  details?: {
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
  model_info?: Record<string, unknown>;
  request_multiplier?: unknown;
  requestMultiplier?: unknown;
  pricing?: {
    request_multiplier?: unknown;
    requestMultiplier?: unknown;
  };
}

export function toOllamaModel(
  id: string,
  config: BridgeConfig,
  metadata?: Partial<Pick<OllamaModel, "family" | "detail" | "tooltip">>
): OllamaModel {
  const family = metadata?.family ?? inferFamily(id);

  return {
    id,
    name: formatModelName(id),
    family,
    version: "local",
    maxInputTokens: config.maxInputTokens,
    maxOutputTokens: config.maxOutputTokens,
    requestMultiplier: 1,
    supportsTools: true,
    supportsImages: false,
    detail: metadata?.detail ?? "Ollama Bridge",
    tooltip: metadata?.tooltip ?? `${id} through ${config.baseUrl}`
  };
}

export function formatModelName(id: string): string {
  return id
    .split(/([:._-])/)
    .map((part) => {
      if (/^[:._-]$/.test(part)) {
        return part;
      }

      return capitalizeModelPart(part);
    })
    .join("");
}

export function applyModelMetadata(
  model: OllamaModel,
  metadata: OllamaShowResponse,
  config: BridgeConfig
): OllamaModel {
  const contextLength = extractContextLength(metadata.model_info) ?? parseNumCtx(metadata.parameters);
  const parameterCount = extractNumber(metadata.model_info, "general.parameter_count");
  const requestMultiplier = extractRequestMultiplier(metadata) ?? estimateRequestMultiplier(parameterCount);
  const rawCapabilities = metadata.capabilities ?? [];
  const capabilities = new Set(rawCapabilities.map((capability) => capability.toLowerCase()));
  const supportsImages =
    capabilities.has("vision") ||
    model.supportsImages ||
    matchesConfiguredVisionModel(model.id, config.visionModels) ||
    inferVisionSupport(model.id, metadata.details?.family ?? metadata.details?.families?.[0] ?? model.family);
  const supportsTools = rawCapabilities.length > 0
    ? capabilities.has("tools") || capabilities.has("tool") || capabilities.has("function_calling")
    : model.supportsTools;
  const tooltip = formatModelTooltip(
    model.id,
    config,
    metadata.modified_at,
    metadata.details?.parameter_size,
    metadata.details?.quantization_level,
    contextLength,
    requestMultiplier,
    [...capabilities]
  );

  return {
    ...model,
    family: metadata.details?.family ?? metadata.details?.families?.[0] ?? model.family,
    maxInputTokens: contextLength ?? model.maxInputTokens,
    maxOutputTokens: estimateMaxOutputTokens(contextLength ?? model.maxInputTokens, model.maxOutputTokens),
    requestMultiplier,
    supportsImages,
    supportsTools,
    detail: "Ollama Bridge",
    tooltip
  };
}

export function inferFamily(id: string): string {
  const base = id.split(":")[0] ?? id;
  const family = base.replace(/[^a-zA-Z0-9_.-]/g, "-").toLowerCase();
  return family || "ollama";
}

export function extractContextLength(modelInfo: Record<string, unknown> | undefined): number | undefined {
  if (!modelInfo) {
    return undefined;
  }

  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith(".context_length") || key === "context_length") {
      const contextLength = asPositiveNumber(value);
      if (contextLength) {
        return contextLength;
      }
    }
  }

  return undefined;
}

export function extractRequestMultiplier(metadata: OllamaShowResponse): number | undefined {
  return (
    asPositiveNumber(metadata.request_multiplier) ??
    asPositiveNumber(metadata.requestMultiplier) ??
    asPositiveNumber(metadata.pricing?.request_multiplier) ??
    asPositiveNumber(metadata.pricing?.requestMultiplier)
  );
}

export function estimateRequestMultiplier(parameterCount: number | undefined): number {
  if (!parameterCount) {
    return 1;
  }

  const billions = parameterCount / 1_000_000_000;

  if (billions >= 100) {
    return 10;
  }

  if (billions >= 60) {
    return 5;
  }

  if (billions >= 30) {
    return 3;
  }

  if (billions >= 13) {
    return 2;
  }

  return 1;
}

export function inferVisionSupport(id: string, family?: string): boolean {
  const value = `${id} ${family ?? ""}`.toLowerCase();
  const visionMarkers = [
    "bakllava",
    "gemma3",
    "kimi-k2.6",
    "llava",
    "minicpm-v",
    "moondream",
    "pixtral",
    "qwen-vl",
    "qwen2-vl",
    "qwen2.5vl",
    "qwen2.5-vl",
    "vision",
    "vlm"
  ];

  return visionMarkers.some((marker) => value.includes(marker));
}

export function matchesConfiguredVisionModel(id: string, patterns: readonly string[]): boolean {
  return matchesModelPattern(id, patterns);
}

export function matchesModelPattern(id: string, patterns: readonly string[]): boolean {
  const normalizedId = id.toLowerCase();

  return patterns.some((pattern) => {
    const normalizedPattern = pattern.trim().toLowerCase();

    if (!normalizedPattern) {
      return false;
    }

    if (!normalizedPattern.includes("*")) {
      return normalizedId === normalizedPattern;
    }

    return wildcardToRegExp(normalizedPattern).test(normalizedId);
  });
}

export function firstMatchingPatternIndex(id: string, patterns: readonly string[]): number {
  return patterns.findIndex((pattern) => matchesModelPattern(id, [pattern]));
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[|\\{}()[\]^$+?.]/g, "\\$&"))
    .join(".*");

  return new RegExp(`^${escaped}$`);
}

function capitalizeModelPart(part: string): string {
  if (!part) {
    return part;
  }

  if (/^\d/.test(part)) {
    return part;
  }

  return part.charAt(0).toUpperCase() + part.slice(1);
}

function extractNumber(
  modelInfo: Record<string, unknown> | undefined,
  key: string
): number | undefined {
  return modelInfo ? asPositiveNumber(modelInfo[key]) : undefined;
}

function parseNumCtx(parameters: string | undefined): number | undefined {
  if (!parameters) {
    return undefined;
  }

  const match = parameters.match(/(?:^|\s)num_ctx\s+(\d+)/);
  return match ? asPositiveNumber(match[1]) : undefined;
}

function asPositiveNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(numberValue) && numberValue > 0 ? numberValue : undefined;
}

function estimateMaxOutputTokens(contextLength: number, fallback: number): number {
  return Math.max(128, Math.min(fallback, Math.floor(contextLength / 4)));
}

export function formatModelTooltip(
  id: string,
  config: BridgeConfig,
  modifiedAt?: string,
  parameterSize?: string,
  quantization?: string,
  contextLength?: number,
  requestMultiplier?: number,
  capabilities?: string[]
): string {
  const parts = [`${id} through ${config.baseUrl}`];
  const modelDetail = formatModelDetail(parameterSize, quantization);

  if (modelDetail) {
    parts.push(modelDetail);
  }

  if (contextLength) {
    parts.push(`Context ${formatTokenCount(contextLength)}`);
  }

  if (requestMultiplier) {
    parts.push(`Request multiplier ${requestMultiplier}x`);
  }

  if (capabilities && capabilities.length > 0) {
    parts.push(`Capabilities ${capabilities.join(", ")}`);
  }

  if (modifiedAt) {
    parts.push(`Modified ${modifiedAt}`);
  }

  return parts.join(" | ");
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }

  return String(tokens);
}

function formatModelDetail(parameterSize?: string, quantization?: string): string | undefined {
  const parts = [parameterSize, quantization].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : undefined;
}
