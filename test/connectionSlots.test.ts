import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cloudConnectionId,
  createCloudConnection,
  createEndpointConnection,
  endpointConnectionId,
  normalizeBridgeConnections,
  removeBridgeConnection,
  toStoredConnection,
  upsertBridgeConnection
} from "../src/connectionSlots";
import type { BridgeConnectionConfig } from "../src/types";

const fallback: BridgeConnectionConfig = {
  id: cloudConnectionId,
  label: "Ollama Bridge",
  type: "cloud",
  enabled: true,
  primary: true,
  baseUrl: "https://ollama.com",
  openaiCompatiblePath: "/v1",
  openaiBaseUrl: "https://ollama.com/v1",
  requiresApiKey: true
};

describe("connection slots", () => {
  it("normalizes old multi-connection settings down to cloud plus one endpoint", () => {
    const connections = normalizeBridgeConnections(
      [
        { id: "cloud", type: "cloud", baseUrl: "https://ollama.com", primary: true },
        { id: "local", type: "local", baseUrl: "http://localhost:11434" },
        { id: "vps-a", type: "remote", baseUrl: "https://first.example.com" },
        { id: "vps-b", type: "remote", baseUrl: "https://last.example.com" }
      ],
      fallback
    );

    assert.equal(connections.length, 2);
    assert.deepEqual(connections.map((connection) => connection.id), [cloudConnectionId, endpointConnectionId]);
    assert.equal(connections[1].baseUrl, "https://last.example.com");
    assert.equal(connections.filter((connection) => connection.primary).length, 1);
  });

  it("replaces a slot instead of adding a third connection", () => {
    const cloud = createCloudConnection();
    const local = createEndpointConnection("http://localhost:11434");
    const vps = createEndpointConnection("https://ollama.example.com/api/tags");
    const first = upsertBridgeConnection([], cloud);
    const second = upsertBridgeConnection(first, local);
    const third = upsertBridgeConnection(second, vps);

    assert.equal(third.length, 2);
    assert.equal(third.find((connection) => connection.id === endpointConnectionId)?.baseUrl, "https://ollama.example.com");
  });

  it("disconnects one slot and keeps the remaining connection primary", () => {
    const connections = upsertBridgeConnection(
      [createCloudConnection()],
      createEndpointConnection("http://localhost:11434")
    );
    const remaining = removeBridgeConnection(connections, cloudConnectionId);

    assert.equal(remaining.length, 1);
    assert.equal(remaining[0].id, endpointConnectionId);
    assert.equal(remaining[0].primary, true);
  });

  it("stores normalized ids for legacy endpoint connections", () => {
    const normalized = normalizeBridgeConnections(
      [{ id: "my-vps", label: "Production", type: "remote", baseUrl: "https://llm.example.com" }],
      fallback
    );
    const stored = toStoredConnection(normalized[0]);

    assert.equal(stored.id, endpointConnectionId);
    assert.equal(stored.label, "Production");
  });
});
