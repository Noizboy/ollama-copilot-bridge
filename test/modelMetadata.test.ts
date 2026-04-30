import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyModelMetadata,
  estimateRequestMultiplier,
  extractContextLength,
  extractRequestMultiplier,
  formatModelName,
  inferFamily,
  toOllamaModel
} from "../src/modelMetadata";
import type { BridgeConfig } from "../src/types";

const config: BridgeConfig = {
  enabled: true,
  baseUrl: "https://ollama.com",
  openaiCompatiblePath: "/v1",
  openaiBaseUrl: "https://ollama.com/v1",
  defaultModel: "gpt-oss:20b",
  maxInputTokens: 8192,
  maxOutputTokens: 2048,
  requestTimeoutMs: 120000,
  retryMaxAttempts: 4,
  retryBaseDelayMs: 1500
};

describe("model metadata helpers", () => {
  it("capitalizes visible model names without changing separators", () => {
    assert.equal(formatModelName("deepseek-v4-pro"), "Deepseek-V4-Pro");
    assert.equal(formatModelName("gpt-oss:20b"), "Gpt-Oss:20b");
    assert.equal(formatModelName("kimi-k2.6"), "Kimi-K2.6");
  });

  it("creates a model with a formatted name while preserving the real id", () => {
    const model = toOllamaModel("deepseek-v4-pro", config);

    assert.equal(model.id, "deepseek-v4-pro");
    assert.equal(model.name, "Deepseek-V4-Pro");
    assert.equal(model.detail, "Ollama Bridge");
    assert.equal(model.supportsTools, true);
  });

  it("infers model families from ids", () => {
    assert.equal(inferFamily("gpt-oss:20b"), "gpt-oss");
    assert.equal(inferFamily("@bad/name"), "-bad-name");
  });

  it("extracts context length from model_info", () => {
    assert.equal(extractContextLength({ "llama.context_length": 131072 }), 131072);
    assert.equal(extractContextLength({ context_length: "32768" }), 32768);
    assert.equal(extractContextLength({ context_length: 0 }), undefined);
  });

  it("uses explicit request multiplier fields when present", () => {
    assert.equal(extractRequestMultiplier({ request_multiplier: 3 }), 3);
    assert.equal(extractRequestMultiplier({ requestMultiplier: "4" }), 4);
    assert.equal(extractRequestMultiplier({ pricing: { request_multiplier: 5 } }), 5);
  });

  it("estimates request multiplier from parameter count", () => {
    assert.equal(estimateRequestMultiplier(undefined), 1);
    assert.equal(estimateRequestMultiplier(12_000_000_000), 1);
    assert.equal(estimateRequestMultiplier(13_000_000_000), 2);
    assert.equal(estimateRequestMultiplier(30_000_000_000), 3);
    assert.equal(estimateRequestMultiplier(60_000_000_000), 5);
    assert.equal(estimateRequestMultiplier(100_000_000_000), 10);
  });

  it("applies metadata from Ollama /api/show", () => {
    const base = toOllamaModel("llava:13b", config);
    const enriched = applyModelMetadata(
      base,
      {
        capabilities: ["completion", "tools", "vision"],
        modified_at: "2026-04-30T00:00:00Z",
        details: {
          family: "llava",
          parameter_size: "13B",
          quantization_level: "Q4_K_M"
        },
        model_info: {
          "llama.context_length": 32768,
          "general.parameter_count": 13_000_000_000
        }
      },
      config
    );

    assert.equal(enriched.family, "llava");
    assert.equal(enriched.maxInputTokens, 32768);
    assert.equal(enriched.maxOutputTokens, 2048);
    assert.equal(enriched.requestMultiplier, 2);
    assert.equal(enriched.supportsTools, true);
    assert.equal(enriched.supportsImages, true);
    assert.match(enriched.tooltip ?? "", /Context 33K/);
  });

  it("falls back to num_ctx and preserves capabilities when /api/show omits them", () => {
    const base = toOllamaModel("custom-model", config);
    const enriched = applyModelMetadata(
      base,
      {
        parameters: "temperature 0.7\nnum_ctx 16384"
      },
      config
    );

    assert.equal(enriched.maxInputTokens, 16384);
    assert.equal(enriched.supportsTools, true);
    assert.equal(enriched.supportsImages, false);
  });
});
