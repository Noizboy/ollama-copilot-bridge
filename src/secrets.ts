import type * as vscode from "vscode";
import type { SecretProvider } from "./types";

const apiKeySecret = "ollamaCopilot.apiKey";

export class SecretStore implements SecretProvider {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getApiKey(connectionId?: string): Promise<string | undefined> {
    if (!connectionId || connectionId === "primary" || connectionId === "cloud") {
      return this.secrets.get(apiKeySecret);
    }

    return (await this.secrets.get(connectionSecretKey(connectionId))) ?? this.secrets.get(apiKeySecret);
  }

  public async setApiKey(value: string, connectionId?: string): Promise<void> {
    const trimmed = value.trim();

    if (!trimmed) {
      await this.clearApiKey(connectionId);
      return;
    }

    await this.secrets.store(connectionId ? connectionSecretKey(connectionId) : apiKeySecret, trimmed);
  }

  public clearApiKey(connectionId?: string): Thenable<void> {
    return this.secrets.delete(connectionId ? connectionSecretKey(connectionId) : apiKeySecret);
  }
}

function connectionSecretKey(connectionId: string): string {
  return `${apiKeySecret}.${connectionId}`;
}
