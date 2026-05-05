import * as vscode from "vscode";
import type { BridgeConfig, BridgeConnectionConfig, ConnectionMode } from "./types";

const section = "ollamaCopilot";

export function getBridgeConfig(): BridgeConfig {
  const config = vscode.workspace.getConfiguration(section);
  const connectionMode = config.get<ConnectionMode>("connectionMode", "cloud");
  const baseUrl = normalizeUrl(config.get("baseUrl", "https://ollama.com"));
  const openaiCompatiblePath = normalizePath(config.get("openaiCompatiblePath", "/v1"));
  const fallbackConnection = createFallbackConnection(connectionMode, baseUrl, openaiCompatiblePath);
  const connections = normalizeConnections(config.get("connections", []), fallbackConnection);

  return {
    enabled: config.get("enabled", true),
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

function normalizeConnections(value: unknown, fallback: BridgeConnectionConfig): BridgeConnectionConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [fallback];
  }

  const connections = value
    .map((item, index) => normalizeConnection(item, index))
    .filter((connection): connection is BridgeConnectionConfig => Boolean(connection));

  if (connections.length === 0) {
    return [fallback];
  }

  if (!connections.some((connection) => connection.primary)) {
    connections[0] = { ...connections[0], primary: true };
  }

  return connections;
}

function normalizeConnection(value: unknown, index: number): BridgeConnectionConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const id = normalizeConnectionId(typeof record.id === "string" ? record.id : `connection-${index + 1}`);
  const type = normalizeConnectionMode(record.type);
  const baseUrl = normalizeUrl(typeof record.baseUrl === "string" ? record.baseUrl : defaultBaseUrl(type));
  const openaiCompatiblePath = normalizePath(
    typeof record.openaiCompatiblePath === "string" ? record.openaiCompatiblePath : "/v1"
  );

  return {
    id,
    label: typeof record.label === "string" && record.label.trim() ? record.label.trim() : defaultLabel(type, id),
    type,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    primary: typeof record.primary === "boolean" ? record.primary : index === 0,
    baseUrl,
    openaiCompatiblePath,
    openaiBaseUrl: joinUrl(baseUrl, openaiCompatiblePath),
    requiresApiKey: typeof record.requiresApiKey === "boolean" ? record.requiresApiKey : type === "cloud"
  };
}

function createFallbackConnection(
  connectionMode: ConnectionMode,
  baseUrl: string,
  openaiCompatiblePath: string
): BridgeConnectionConfig {
  return {
    id: connectionMode === "cloud" ? "cloud" : "primary",
    label: defaultLabel(connectionMode, "Primary"),
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

function normalizeConnectionId(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]/g, "-") || "connection";
}

function defaultBaseUrl(type: ConnectionMode): string {
  return type === "cloud" ? "https://ollama.com" : "http://localhost:11434";
}

function defaultLabel(type: ConnectionMode, id: string): string {
  if (type === "cloud") {
    return "Cloud";
  }

  if (type === "local") {
    return "Local";
  }

  if (type === "remote") {
    return "VPS";
  }

  return id;
}

export function joinUrl(base: string, path: string): string {
  const cleanBase = normalizeUrl(base);
  const cleanPath = normalizePath(path);
  return `${cleanBase}${cleanPath}`;
}
