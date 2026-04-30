import type * as vscode from "vscode";
import type { SecretProvider } from "./types";

const apiKeySecret = "ollamaCopilot.apiKey";

export class SecretStore implements SecretProvider {
  public constructor(private readonly secrets: vscode.SecretStorage) {}

  public getApiKey(): Thenable<string | undefined> {
    return this.secrets.get(apiKeySecret);
  }

  public async setApiKey(value: string): Promise<void> {
    const trimmed = value.trim();

    if (!trimmed) {
      await this.clearApiKey();
      return;
    }

    await this.secrets.store(apiKeySecret, trimmed);
  }

  public clearApiKey(): Thenable<void> {
    return this.secrets.delete(apiKeySecret);
  }
}
