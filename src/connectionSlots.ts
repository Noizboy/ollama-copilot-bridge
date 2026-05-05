import type { BridgeConnectionConfig, ConnectionMode } from "./types";

export const cloudConnectionId = "cloud";
export const endpointConnectionId = "endpoint";

export type ConnectionSlot = typeof cloudConnectionId | typeof endpointConnectionId;

export interface StoredBridgeConnectionConfig {
  id: string;
  label: string;
  type: ConnectionMode;
  enabled: boolean;
  primary: boolean;
  baseUrl: string;
  openaiCompatiblePath: string;
  requiresApiKey: boolean;
}

export function normalizeBridgeConnections(
  value: unknown,
  fallback: BridgeConnectionConfig
): BridgeConnectionConfig[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [fallback];
  }

  const bySlot = new Map<ConnectionSlot, BridgeConnectionConfig>();

  for (const item of value) {
    const connection = normalizeConnection(item);
    if (!connection) {
      continue;
    }

    bySlot.set(getConnectionSlot(connection), connection);
  }

  const connections = [bySlot.get(cloudConnectionId), bySlot.get(endpointConnectionId)]
    .filter((connection): connection is BridgeConnectionConfig => Boolean(connection));

  if (connections.length === 0) {
    return [fallback];
  }

  return withSinglePrimaryConnection(connections);
}

export function createCloudConnection(): StoredBridgeConnectionConfig {
  return {
    id: cloudConnectionId,
    label: "Ollama Bridge",
    type: "cloud",
    enabled: true,
    primary: true,
    baseUrl: "https://ollama.com",
    openaiCompatiblePath: "/v1",
    requiresApiKey: true
  };
}

export function createEndpointConnection(baseUrl: string): StoredBridgeConnectionConfig {
  const normalizedBaseUrl = normalizeEndpointBaseUrl(baseUrl);
  const isLocal = isLocalBaseUrl(normalizedBaseUrl);

  return {
    id: endpointConnectionId,
    label: isLocal ? "Localhost" : "VPS",
    type: isLocal ? "local" : "remote",
    enabled: true,
    primary: false,
    baseUrl: normalizedBaseUrl,
    openaiCompatiblePath: "/v1",
    requiresApiKey: false
  };
}

export function upsertBridgeConnection(
  connections: readonly StoredBridgeConnectionConfig[],
  connection: StoredBridgeConnectionConfig
): StoredBridgeConnectionConfig[] {
  const slot = getConnectionSlot(connection);
  const existing = connections.filter((candidate) => getConnectionSlot(candidate) !== slot);
  const normalized = normalizeStoredConnection(connection);
  const next = slot === cloudConnectionId ? [normalized, ...existing] : [...existing, normalized];

  return withSinglePrimaryStoredConnection(next.slice(0, 2));
}

export function removeBridgeConnection(
  connections: readonly StoredBridgeConnectionConfig[],
  slot: ConnectionSlot
): StoredBridgeConnectionConfig[] {
  return withSinglePrimaryStoredConnection(
    connections.filter((connection) => getConnectionSlot(connection) !== slot)
  );
}

export function getConnectionSlot(connection: Pick<BridgeConnectionConfig, "id" | "type" | "baseUrl">): ConnectionSlot {
  return connection.id === cloudConnectionId || connection.type === "cloud" || isOllamaCloudUrl(connection.baseUrl)
    ? cloudConnectionId
    : endpointConnectionId;
}

export function toStoredConnection(connection: BridgeConnectionConfig): StoredBridgeConnectionConfig {
  return {
    id: getConnectionSlot(connection),
    label: connection.label,
    type: connection.type,
    enabled: connection.enabled,
    primary: connection.primary,
    baseUrl: connection.baseUrl,
    openaiCompatiblePath: connection.openaiCompatiblePath,
    requiresApiKey: connection.requiresApiKey
  };
}

export function normalizeUrl(value: string): string {
  return value.trim().replace(/\/+$/, "");
}

export function normalizePath(value: string): string {
  const trimmed = value.trim();
  return trimmed ? `/${trimmed.replace(/^\/+/, "").replace(/\/+$/, "")}` : "";
}

export function normalizeEndpointBaseUrl(value: string): string {
  const trimmed = normalizeUrl(value);
  const knownSuffixes = ["/api/tags", "/api/show", "/api/chat", "/v1/models", "/v1/chat/completions"];

  for (const suffix of knownSuffixes) {
    if (trimmed.toLowerCase().endsWith(suffix)) {
      return trimmed.slice(0, -suffix.length).replace(/\/+$/, "");
    }
  }

  return trimmed;
}

export function joinUrl(base: string, path: string): string {
  return `${normalizeUrl(base)}${normalizePath(path)}`;
}

function normalizeConnection(value: unknown): BridgeConnectionConfig | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const type = normalizeConnectionMode(record.type);
  const baseUrl = normalizeUrl(typeof record.baseUrl === "string" ? record.baseUrl : defaultBaseUrl(type));
  const slot = type === "cloud" || isOllamaCloudUrl(baseUrl) ? cloudConnectionId : endpointConnectionId;
  const resolvedType = slot === cloudConnectionId ? "cloud" : isLocalBaseUrl(baseUrl) ? "local" : "remote";
  const openaiCompatiblePath = normalizePath(
    typeof record.openaiCompatiblePath === "string" ? record.openaiCompatiblePath : "/v1"
  );

  return {
    id: slot,
    label: typeof record.label === "string" && record.label.trim()
      ? record.label.trim()
      : defaultLabel(resolvedType),
    type: resolvedType,
    enabled: typeof record.enabled === "boolean" ? record.enabled : true,
    primary: typeof record.primary === "boolean" ? record.primary : slot === cloudConnectionId,
    baseUrl: slot === cloudConnectionId ? "https://ollama.com" : baseUrl,
    openaiCompatiblePath,
    openaiBaseUrl: joinUrl(slot === cloudConnectionId ? "https://ollama.com" : baseUrl, openaiCompatiblePath),
    requiresApiKey: slot === cloudConnectionId || Boolean(record.requiresApiKey)
  };
}

function normalizeStoredConnection(connection: StoredBridgeConnectionConfig): StoredBridgeConnectionConfig {
  const slot = getConnectionSlot({ ...connection, baseUrl: connection.baseUrl });

  if (slot === cloudConnectionId) {
    return createCloudConnection();
  }

  return {
    ...createEndpointConnection(connection.baseUrl),
    primary: connection.primary
  };
}

function withSinglePrimaryConnection(connections: BridgeConnectionConfig[]): BridgeConnectionConfig[] {
  const primaryIndex = connections.findIndex((connection) => connection.primary);
  const selectedPrimaryIndex = primaryIndex === -1 ? 0 : primaryIndex;

  return connections.map((connection, index) => ({
    ...connection,
    primary: index === selectedPrimaryIndex
  }));
}

function withSinglePrimaryStoredConnection(
  connections: readonly StoredBridgeConnectionConfig[]
): StoredBridgeConnectionConfig[] {
  if (connections.length === 0) {
    return [];
  }

  const primaryIndex = connections.findIndex((connection) => connection.primary);
  const selectedPrimaryIndex = primaryIndex === -1 ? 0 : primaryIndex;

  return connections.map((connection, index) => ({
    ...connection,
    primary: index === selectedPrimaryIndex
  }));
}

function normalizeConnectionMode(value: unknown): ConnectionMode {
  return value === "local" || value === "remote" || value === "custom" || value === "cloud" ? value : "remote";
}

function defaultBaseUrl(type: ConnectionMode): string {
  return type === "cloud" ? "https://ollama.com" : "http://localhost:11434";
}

function defaultLabel(type: ConnectionMode): string {
  if (type === "cloud") {
    return "Ollama Bridge";
  }

  return type === "local" ? "Localhost" : "VPS";
}

function isOllamaCloudUrl(value: string): boolean {
  return /^https:\/\/ollama\.com\/?$/i.test(normalizeUrl(value));
}

function isLocalBaseUrl(value: string): boolean {
  return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(normalizeUrl(value));
}
