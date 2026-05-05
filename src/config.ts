import * as vscode from "vscode";
import {
  cloudConnectionId,
  joinUrl,
  normalizeBridgeConnections,
  normalizePath,
  normalizeUrl
} from "./connectionSlots";
import type { BridgeConfig, BridgeConnectionConfig, ConnectionMode } from "./types";

const section = "ollamaCopilot";

export { joinUrl } from "./connectionSlots";

export function getBridgeConfig(): BridgeConfig {
  const config = vscode.workspace.getConfiguration(section);
  const connectionMode = config.get<ConnectionMode>("connectionMode", "cloud");
  const baseUrl = normalizeUrl(config.get("baseUrl", "https://ollama.com"));
  const openaiCompatiblePath = normalizePath(config.get("openaiCompatiblePath", "/v1"));
  const fallbackConnection = createFallbackConnection(connectionMode, baseUrl, openaiCompatiblePath);
  const rawConnections = config.get("connections", []);
  const enabled = config.get("enabled", true);
  const connections = !enabled && Array.isArray(rawConnections) && rawConnections.length === 0
    ? []
    : normalizeBridgeConnections(rawConnections, fallbackConnection);

  return {
    enabled,
    connectionMode,
    baseUrl,
    openaiCompatiblePath,
    openaiBaseUrl: joinUrl(baseUrl, openaiCompatiblePath),
    defaultModel: config.get("defaultModel", "gpt-oss:20b").trim(),
    maxInputTokens: config.get("maxInputTokens", 8192),
    maxOutputTokens: config.get("maxOutputTokens", 2048),
    requestTimeoutMs: config.get("requestTimeoutMs", 120000),
    retryMaxAttempts: config.get("retryMaxAttempts", 4),
    retryBaseDelayMs: config.get("retryBaseDelayMs", 1500),
    visionModels: normalizeStringList(config.get("visionModels", [])),
    pinnedModels: normalizeStringList(config.get("pinnedModels", [])),
    hiddenModels: normalizeStringList(config.get("hiddenModels", [])),
    modelCacheTtlMs: config.get("modelCacheTtlMs", 3600000),
    metadataConcurrency: config.get("metadataConcurrency", 6),
    connections
  };
}

export function affectsBridgeConfig(event: vscode.ConfigurationChangeEvent): boolean {
  return event.affectsConfiguration(section);
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

function createFallbackConnection(
  connectionMode: ConnectionMode,
  baseUrl: string,
  openaiCompatiblePath: string
): BridgeConnectionConfig {
  return {
    id: connectionMode === "cloud" ? cloudConnectionId : "endpoint",
    label: defaultLabel(connectionMode),
    type: connectionMode,
    enabled: true,
    primary: true,
    baseUrl,
    openaiCompatiblePath,
    openaiBaseUrl: joinUrl(baseUrl, openaiCompatiblePath),
    requiresApiKey: connectionMode === "cloud"
  };
}

function normalizeConnectionMode(value: unknown): ConnectionMode {
  return value === "local" || value === "remote" || value === "custom" || value === "cloud" ? value : "custom";
}

function defaultBaseUrl(type: ConnectionMode): string {
  return type === "cloud" ? "https://ollama.com" : "http://localhost:11434";
}

function defaultLabel(type: ConnectionMode): string {
  if (type === "cloud") {
    return "Ollama Bridge";
  }

  if (type === "local") {
    return "Localhost";
  }

  return "VPS";
}
