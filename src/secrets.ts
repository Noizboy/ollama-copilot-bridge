import type * as vscode from "vscode";
import type { SecretProvider } from "./types";

const apiKeySecret = "ollamaCopilot.apiKey";

export class SecretStore implements SecretProvider {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public async getApiKey(connectionId?: string): Promise<string | undefined> {
    if (!connectionId || connectionId === "primary" || connectionId === "cloud") {
      return (await this.secrets.get(connectionSecretKey("cloud"))) ?? this.secrets.get(apiKeySecret);
    }

    return this.secrets.get(connectionSecretKey(connectionId));
  }

  public async setApiKey(value: string, connectionId?: string): Promise<void> {
    const trimmed = value.trim();

    if (!trimmed) {
      await this.clearApiKey(connectionId);
      return;
    }

    await this.secrets.store(connectionId ? connectionSecretKey(connectionId) : apiKeySecret, trimmed);
  }

  public async clearApiKey(connectionId?: string): Promise<void> {
    if (connectionId) {
      await this.secrets.delete(connectionSecretKey(connectionId));
      if (connectionId === "cloud") {
        await this.secrets.delete(apiKeySecret);
      }
      return;
    }

    await this.secrets.delete(apiKeySecret);
    await this.secrets.delete(connectionSecretKey("cloud"));
  }
}

function connectionSecretKey(connectionId: string): string {
  return `${apiKeySecret}.${connectionId}`;
}
