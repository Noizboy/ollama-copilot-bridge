import * as vscode from "vscode";
import type { BridgeConfig } from "./types";

const section = "ollamaCopilot";

export function getBridgeConfig(): BridgeConfig {
  const config = vscode.workspace.getConfiguration(section);
  const baseUrl = normalizeUrl(config.get("baseUrl", "https://ollama.com"));
  const openaiCompatiblePath = normalizePath(config.get("openaiCompatiblePath", "/v1"));

  return {
    enabled: config.get("enabled", true),
    baseUrl,
    openaiCompatiblePath,
    openaiBaseUrl: joinUrl(baseUrl, openaiCompatiblePath),
    defaultModel: config.get("defaultModel", "gpt-oss:20b").trim(),
    maxInputTokens: config.get("maxInputTokens", 8192),
    maxOutputTokens: config.get("maxOutputTokens", 2048),
    requestTimeoutMs: config.get("requestTimeoutMs", 120000),
    retryMaxAttempts: config.get("retryMaxAttempts", 4),
    retryBaseDelayMs: config.get("retryBaseDelayMs", 1500),
    visionModels: normalizeStringList(config.get("visionModels", []))
  };
}

export function affectsBridgeConfig(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(section);
}

function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

function normalizePath(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  return `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}`;
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function joinUrl(base: string, path: string): string {
  const cleanBase = normalizeUrl(base);
  const cleanPath = normalizePath(path);
  return `${cleanBase}${cleanPath}`;
}
