export interface ContextUsageInput {
  modelId: string;
  modelName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  requestMultiplier?: number;
  inputText: string;
  outputText?: string;
}

export interface ContextUsageSnapshot {
  modelId: string;
  modelName: string;
  maxInputTokens: number;
  maxOutputTokens: number;
  requestMultiplier: number;
  inputTokens: number;
  outputTokens: number;
  inputPercent: number;
  totalTokens: number;
  updatedAt: Date;
}

export function buildContextUsageSnapshot(input: ContextUsageInput): ContextUsageSnapshot {
  const inputTokens = estimateTokenCount(input.inputText);
  const outputTokens = estimateTokenCount(input.outputText ?? "");
  const maxInputTokens = Math.max(1, input.maxInputTokens);

  return {
    modelId: input.modelId,
    modelName: input.modelName,
    maxInputTokens,
    maxOutputTokens: Math.max(1, input.maxOutputTokens),
    requestMultiplier: input.requestMultiplier ?? 1,
    inputTokens,
    outputTokens,
    inputPercent: Math.min(100, Math.round((inputTokens / maxInputTokens) * 100)),
    totalTokens: inputTokens + outputTokens,
    updatedAt: new Date()
  };
}

export function estimateTokenCount(value: string): number {
  const trimmed = value.trim();

  if (!trimmed) {
    return 0;
  }

  return Math.max(1, Math.ceil(trimmed.length / 4));
}

export function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) {
    return `${formatCompactNumber(tokens / 1_000_000)}M`;
  }

  if (tokens >= 1000) {
    return `${formatCompactNumber(tokens / 1000)}K`;
  }

  return String(tokens);
}

function formatCompactNumber(value: number): string {
  return value >= 10 ? String(Math.round(value)) : value.toFixed(1).replace(/\.0$/, "");
}
